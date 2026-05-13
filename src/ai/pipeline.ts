import { load } from 'js-yaml';
import { reviewFile } from '@/ai/reviewer';
import { embedHash, extractExistingHashes, generateHash } from '@/anti-spam/hash';
import { getConfig } from '@/config';
import { NotificationManager } from '@/notifications/manager';
import { TelegramNotificationProvider } from '@/notifications/telegram';
import { resolveTemplates } from '@/notifications/template';
import { addLinePrefix, buildParsedDiff, extractDiffContext } from '@/processor/line-prefix';
import { extractScriptWithLinePreserve } from '@/processor/script-extract';
import { isTrivialChange, isWhitespaceOnlyChange } from '@/processor/trivial';
import type { PlatformProvider, RepoConfig, ReviewComment, StandardReviewPayload } from '@/types';

const REPO_CONFIG_PATH = '.yolo/config.yml';

/**
 * Attempts to fetch and parse the per-repository `.yolo/config.yml` file.
 * Returns null if the file doesn't exist or cannot be parsed, falling back to server defaults.
 */
async function loadRepoConfig(
  provider: PlatformProvider,
  projectId: string | number,
  ref: string,
): Promise<RepoConfig | null> {
  try {
    const raw = await provider.getFileContent(projectId, REPO_CONFIG_PATH, ref);
    const replacedRaw = raw.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
    return load(replacedRaw) as RepoConfig;
  } catch {
    return null; // File not found or parse error — use server defaults
  }
}

/**
 * Core AI review pipeline abstracted to handle standard payloads from any provider.
 */
export async function runReviewPipeline(
  payload: StandardReviewPayload,
  provider: PlatformProvider,
): Promise<{ processed: number; posted: number }> {
  const {
    projectId,
    mrIid,
    repoName,
    projectName,
    repoUrl,
    projectHomepage,
    mrUrl,
    target_branch,
    assignees,
    reviewers,
  } = payload;
  let { base_sha, head_sha, start_sha } = payload;

  console.info(`\n[Yolo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.info(`[Yolo] 🚀 Starting background worker for PR/MR !${mrIid}`);
  console.info(`[Yolo] 📦 Repository: ${repoName}`);
  console.info(`[Yolo] 🔗 Link:       ${mrUrl}`);
  console.info(`[Yolo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const config = getConfig();

  const { diffs, diff_refs: fetchedDiffRefs } = await provider.getMRDiffs(projectId, mrIid);

  if (!head_sha && fetchedDiffRefs) {
    base_sha = fetchedDiffRefs.base_sha;
    head_sha = fetchedDiffRefs.head_sha;
    start_sha = fetchedDiffRefs.start_sha;
    console.info(`[Yolo] 🔄 Fetched diff_refs from API (head: ${head_sha})`);
  }

  if (!head_sha) {
    console.warn(`[Yolo] WARNING: Missing head_sha for !${mrIid}. Comments cannot be posted.`);
    return { posted: 0, processed: 0 };
  }

  // Load per-repo config now that head_sha is confirmed.
  const repoConfig = await loadRepoConfig(provider, projectId, head_sha);

  // Initialize Notification Manager with merged templates (per-repo > global)
  const notificationManager = new NotificationManager();

  if (config.notifications?.telegram) {
    const telegramTemplates = resolveTemplates(
      {},
      config.notifications.telegram.templates,
      repoConfig?.telegram_templates,
    );
    notificationManager.register(
      new TelegramNotificationProvider(config.notifications.telegram, telegramTemplates),
    );
  }

  // Branch filter: skip review if target_branch is not in the allowed list.
  const allowedBranches = repoConfig?.filters?.target_branches;
  if (allowedBranches && allowedBranches.length > 0 && !allowedBranches.includes(target_branch)) {
    console.info(
      `[Yolo] ⏭️ Skipping review — target branch '${target_branch}' is not in .yolo/config.yml filters.target_branches.`,
    );
    return { posted: 0, processed: 0 };
  }

  const relevantDiffs = diffs.filter((d) => !d.deleted_file);

  if (relevantDiffs.length === 0) {
    console.info(`[Yolo] ℹ️ No relevant files found. Review skipped.`);
    return { posted: 0, processed: 0 };
  }

  console.info(`[Yolo] 📂 Found ${relevantDiffs.length} relevant files to process.`);

  const existingDiscussions = await provider.getMRDiscussions(projectId, mrIid);
  const existingHashes = extractExistingHashes(existingDiscussions as any);
  console.info(`[Yolo] 🔍 Found ${existingHashes.size} existing comments for anti-spam check.`);

  let processedFiles = 0;
  let totalPosted = 0;
  const currentIssuesHashes = new Set<string>();
  const allValidComments: { file: string; comment: ReviewComment }[] = [];

  for (const diff of relevantDiffs) {
    const filePath = diff.new_path;
    const extension = filePath.split('.').pop()?.toLowerCase();

    const trivial = isTrivialChange(diff.diff) || isWhitespaceOnlyChange(diff.diff);
    if (trivial) {
      console.info(`[Yolo] ⏭️ Skip '${filePath}' — Changes are trivial or whitespace-only.`);
      continue;
    }

    const parsedDiff = buildParsedDiff(filePath, diff.diff);
    if (parsedDiff.changedLines.size === 0) {
      console.info(`[Yolo] ⏭️ Skip '${filePath}' — No actual lines changed.`);
      continue;
    }

    let rawContent: string;
    try {
      rawContent = await provider.getFileContent(projectId, filePath, head_sha);
    } catch (err) {
      console.error(`[Yolo] Failed to fetch ${filePath}:`, err);
      continue;
    }

    let processedContent = rawContent;
    if (extension === 'vue' || extension === 'svelte') {
      console.info(`[Yolo] ⚡ Extracting script block for UI file '${filePath}'`);
      processedContent = extractScriptWithLinePreserve(rawContent, extension as 'vue' | 'svelte');
    }

    const allNumberedLines = addLinePrefix(processedContent).split('\n');
    const diffContext = extractDiffContext(allNumberedLines, parsedDiff.changedLines);

    let comments: ReviewComment[] = [];
    try {
      console.info(
        `[Yolo] 🧠 Sending diff of '${filePath}' to AI for analysis... (${parsedDiff.changedLines.size} changed lines)`,
      );
      comments = await reviewFile(provider, diffContext, filePath, projectId, target_branch);
    } catch (err) {
      console.error(`[Yolo] AI Review failed for file ${filePath}`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      await notificationManager.sendError({
        assignees,
        errorMessage,
        mrIid,
        mrUrl,
        projectHomepage,
        projectName,
        repoName,
        repoUrl,
        reviewers,
      });
      break; // stop processing further files on fatal AI error
    }

    if (comments.length === 0) {
      processedFiles++;
      continue;
    }

    const validComments = comments.filter((c) => parsedDiff.changedLines.has(c.line));

    for (const c of validComments) {
      allValidComments.push({ comment: c, file: filePath });
    }

    const fileLines = rawContent.split('\n');

    for (const comment of validComments) {
      const lineIndex = comment.line - 1;
      const lineContent = fileLines[lineIndex] ?? '';

      const hash = await generateHash(filePath, comment.line, lineContent);
      currentIssuesHashes.add(hash);

      if (existingHashes.has(hash)) {
        continue;
      }

      const body = formatComment(comment);
      const bodyWithHash = embedHash(body, hash);

      try {
        const posted = await provider.postDiscussion(projectId, mrIid, {
          body: bodyWithHash,
          position: {
            base_sha: base_sha!,
            head_sha: head_sha!,
            new_line: comment.line,
            new_path: filePath,
            position_type: 'text',
            start_sha: start_sha!,
          },
        });

        if (posted) {
          existingHashes.add(hash);
          totalPosted++;
          console.info(
            `[Yolo] 💬 Successfully posted comment on '${filePath}' line ${comment.line}`,
          );
        }
      } catch (err) {
        console.error(`[Yolo] ❌ Error posting comment on line ${comment.line}:`, err);
      }
    }

    processedFiles++;
  }

  if (config.features.autoResolve) {
    await processAutoResolve(
      provider,
      projectId,
      mrIid,
      existingDiscussions,
      diffs,
      currentIssuesHashes,
    );
  }

  const lgtmConfig = config.features.lgtm;
  if (lgtmConfig.enabled && totalPosted === 0 && processedFiles > 0) {
    const lgtmMessage = repoConfig?.lgtm?.message ?? lgtmConfig.message;
    await provider.postMRNote(projectId, mrIid, lgtmMessage);
    console.info(`[Yolo] ✅ LGTM! Posting clean review note.`);

    await notificationManager.sendLgtm({
      assignees,
      mrIid,
      mrUrl,
      projectHomepage,
      projectName,
      repoName,
      repoUrl,
      reviewers,
    });
  }

  if (allValidComments.length > 0) {
    if (config.features.summaryComment) {
      const totalIssues = allValidComments.length;
      const fileCount = new Set(allValidComments.map((c) => c.file)).size;

      let summaryBody = `🤖 **Yolo Review Summary**\n\n`;
      summaryBody += `Menemukan **${totalIssues} issue** di **${fileCount} file** yang melanggar standar (berdasarkan \`.skills/\`).\n`;
      summaryBody += `Silakan cek inline comment untuk detail dan rekomendasi perbaikannya.`;

      await provider.postMRNote(projectId, mrIid, summaryBody);
      console.info(`[Yolo] 📝 Posting summary review: ${totalIssues} issues found.`);
    }

    // Build category summary
    const categorySummary: Record<string, number> = {};
    for (const { comment } of allValidComments) {
      const cat = comment.category.toLowerCase();
      categorySummary[cat] = (categorySummary[cat] || 0) + 1;
    }

    const triggerCategories = config.notifications?.telegram?.trigger_categories?.map((c) =>
      c.toLowerCase(),
    );

    await notificationManager.sendReviewSummary({
      assignees,
      categorySummary,
      fileCount: new Set(allValidComments.map((c) => c.file)).size,
      highlightedCategories: triggerCategories,
      mrIid,
      mrUrl,
      projectHomepage,
      projectName,
      repoName,
      repoUrl,
      reviewers,
      totalIssues: allValidComments.length,
    });
  }

  console.info(
    `[Yolo] 🎉 Done! Total files processed: ${processedFiles}, Comments posted: ${totalPosted}\n`,
  );
  return { posted: totalPosted, processed: processedFiles };
}

function formatComment(comment: ReviewComment): string {
  let text = `${comment.issue}\n\n${comment.suggestion}`;

  if (comment.replacementCode) {
    text += `\n\n\`\`\`suggestion\n${comment.replacementCode}\n\`\`\``;
  }

  return text;
}

async function processAutoResolve(
  provider: PlatformProvider,
  projectId: number | string,
  mrIid: number | string,
  existingDiscussions: any[],
  diffs: any[],
  currentIssuesHashes: Set<string>,
) {
  let resolvedCount = 0;
  for (const d of existingDiscussions) {
    if (!d.notes || d.notes.length === 0) continue;

    const note = d.notes[0];

    if (!note?.resolvable || note?.resolved || !note?.body.includes('Yolo')) {
      continue;
    }

    const match = note.body.match(/<!--\s*hash:(.+?)\s*-->/);
    if (!match) continue;

    const oldHash = match[1];
    const filePath = note.position?.new_path;

    if (!filePath) continue;

    const fileInChanges = diffs.find(
      (c: any) => c.new_path === filePath || c.old_path === filePath,
    );
    if (!fileInChanges) continue;

    if (currentIssuesHashes.has(oldHash as string)) continue;

    try {
      await provider.resolveDiscussion(projectId, mrIid, d.id, true);
      resolvedCount++;
      console.info(`[Yolo] ✅ Auto-resolve successful [${d.id}]: Issue in '${filePath}' is fixed.`);
    } catch (err) {
      console.error(`[Yolo] ❌ Failed to auto-resolve [${d.id}] in '${filePath}':`, err);
    }
  }

  if (resolvedCount > 0) {
    console.info(`[Yolo] ✨ Done: Auto-resolved ${resolvedCount} old discussions.`);
  }
}
