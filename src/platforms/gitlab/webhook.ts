import { reviewFile } from '@/ai/reviewer';
import { embedHash, extractExistingHashes, generateHash } from '@/anti-spam/hash';
import { getConfig } from '@/config';
import { addLinePrefix, buildParsedDiff, extractDiffContext } from '@/processor/line-prefix';
import { extractScriptWithLinePreserve } from '@/processor/script-extract';
import { isTrivialChange, isWhitespaceOnlyChange } from '@/processor/trivial';
import type { GitLabMRWebhook, PlatformProvider, ReviewComment } from '@/types';

/**
 * Main handler for processing GitLab Merge Request webhook events.
 * Executes the entire AI review pipeline: fetching diffs, filtering relevant files,
 * extracting code context, requesting AI feedback, and posting inline comments.
 *
 * @param payload - The parsed JSON payload from the GitLab webhook event.
 * @param provider - The instantiated PlatformProvider (e.g., GitLabProvider) to interact with the API.
 * @returns An object detailing the total number of files processed and comments successfully posted.
 */
export async function handleMergeRequestEvent(
  payload: GitLabMRWebhook,
  provider: PlatformProvider,
): Promise<{ processed: number; posted: number }> {
  const { object_attributes, project } = payload;
  const projectId = project.id;
  const repoName = project.path_with_namespace;
  const repoUrl = project.web_url;
  const mrIid = object_attributes.iid;
  const mrUrl = `${repoUrl}/-/merge_requests/${mrIid}`;
  let { base_sha, head_sha, start_sha } = object_attributes.diff_refs ?? {};

  console.info(`\n[Yolo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.info(`[Yolo] 🚀 Starting background worker for MR !${mrIid}`);
  console.info(`[Yolo] 📦 Repository: ${repoName}`);
  console.info(`[Yolo] 🔗 MR Link:    ${mrUrl}`);
  console.info(`[Yolo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const { diffs, diff_refs: fetchedDiffRefs } = await provider.getMRDiffs(projectId, mrIid);

  if (!head_sha && fetchedDiffRefs) {
    base_sha = fetchedDiffRefs.base_sha;
    head_sha = fetchedDiffRefs.head_sha;
    start_sha = fetchedDiffRefs.start_sha;
    console.info(`[Yolo] 🔄 Fetched diff_refs from GitLab API (head: ${head_sha})`);
  }

  if (!head_sha) {
    console.warn(`[Yolo] WARNING: Missing head_sha for MR !${mrIid}. Comments cannot be posted.`);
    return { posted: 0, processed: 0 };
  }

  // ──────────────────────────────────────────────────────────
  // 2. Filter relevant files (skip deleted)
  // ──────────────────────────────────────────────────────────
  const relevantDiffs = diffs.filter((d) => !d.deleted_file);

  if (relevantDiffs.length === 0) {
    console.info(`[Yolo] ℹ️ No relevant files found. Review skipped.`);
    return { posted: 0, processed: 0 };
  }

  console.info(`[Yolo] 📂 Found ${relevantDiffs.length} relevant files to process.`);

  // ──────────────────────────────────────────────────────────
  // 3. Fetch existing discussions (untuk anti-spam)
  // ──────────────────────────────────────────────────────────
  const existingDiscussions = await provider.getMRDiscussions(projectId, mrIid);
  const existingHashes = extractExistingHashes(existingDiscussions as any);
  console.info(`[Yolo] 🔍 Found ${existingHashes.size} existing comments for anti-spam check.`);

  let processedFiles = 0;
  let totalPosted = 0;
  const currentIssuesHashes = new Set<string>();
  const allValidComments: { file: string; comment: ReviewComment }[] = [];

  // ──────────────────────────────────────────────────────────
  // 4. Process each file
  // ──────────────────────────────────────────────────────────
  for (const diff of relevantDiffs) {
    const filePath = diff.new_path;
    const extension = filePath.split('.').pop()?.toLowerCase();

    // ── 4a. Trivial check ──
    const trivial = isTrivialChange(diff.diff) || isWhitespaceOnlyChange(diff.diff);
    if (trivial) {
      console.info(`[Yolo] ⏭️ Skip '${filePath}' — Changes are trivial or whitespace-only.`);
      continue;
    }

    // ── 4b. Parse changed lines dari diff ──
    const parsedDiff = buildParsedDiff(filePath, diff.diff);
    if (parsedDiff.changedLines.size === 0) {
      console.info(`[Yolo] ⏭️ Skip '${filePath}' — No actual lines changed.`);
      continue;
    }

    // ── 4c. Fetch full file content ──
    let rawContent: string;
    try {
      rawContent = await provider.getFileContent(projectId, filePath, head_sha);
    } catch (err) {
      console.error(`[Yolo] Failed to fetch ${filePath}:`, err);
      continue;
    }

    // ── 4d. Extract script block untuk Vue & Svelte ──
    let processedContent = rawContent;
    if (extension === 'vue' || extension === 'svelte') {
      console.info(`[Yolo] ⚡ Extracting script block for UI file '${filePath}'`);
      processedContent = extractScriptWithLinePreserve(rawContent, extension as 'vue' | 'svelte');
    }

    // ── 4e. Add line prefix + extract only diff context ──
    const allNumberedLines = addLinePrefix(processedContent).split('\n');
    const diffContext = extractDiffContext(allNumberedLines, parsedDiff.changedLines);

    // ── 4f. AI Review ──
    console.info(
      `[Yolo] 🧠 Sending diff of '${filePath}' to AI for analysis... (${parsedDiff.changedLines.size} changed lines)`,
    );
    const comments = await reviewFile(provider, diffContext, filePath, projectId, head_sha);

    if (comments.length === 0) {
      processedFiles++;
      continue;
    }

    // ── 4g. Filter: hanya baris yang ada di diff ──
    const validComments = comments.filter((c) => parsedDiff.changedLines.has(c.line));

    for (const c of validComments) {
      allValidComments.push({ comment: c, file: filePath });
    }

    // ── 4h. Post komentar satu per satu ──
    const fileLines = rawContent.split('\n');

    for (const comment of validComments) {
      const lineIndex = comment.line - 1;
      const lineContent = fileLines[lineIndex] ?? '';

      // Anti-spam: cek hash
      const hash = await generateHash(filePath, comment.line, lineContent);
      currentIssuesHashes.add(hash); // Simpan hash dari issue yang masih ada saat ini

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
    } // end for validComments

    processedFiles++;
  } // end for relevantDiffs

  // ──────────────────────────────────────────────────────────
  // 5. Feature: Auto-Resolve & Summary
  // ──────────────────────────────────────────────────────────
  const config = getConfig();

  // 5a. Auto-Resolve
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

  // 5b. Summary Comment
  if (config.features.summaryComment && allValidComments.length > 0) {
    const totalIssues = allValidComments.length;
    const fileCount = new Set(allValidComments.map((c) => c.file)).size;

    let summaryBody = `🤖 **Yolo Review Summary**\n\n`;
    summaryBody += `Menemukan **${totalIssues} issue** di **${fileCount} file** yang melanggar standar (berdasarkan \`.skills/\`).\n`;
    summaryBody += `Silakan cek inline comment untuk detail dan rekomendasi perbaikannya.`;

    await provider.postMRNote(projectId, mrIid, summaryBody);
    console.info(`[Yolo] 📝 Posting summary review: ${totalIssues} issues found.`);
  }

  console.info(
    `[Yolo] 🎉 Done! Total files processed: ${processedFiles}, Comments posted: ${totalPosted}\n`,
  );
  return { posted: totalPosted, processed: processedFiles };
}

// ============================================================
// Format komentar Yolo — ringkas, profesional, bahasa Indonesia
// ============================================================
/**
 * Formats a raw AI review comment object into a readable markdown string.
 * Appends a code suggestion block if a replacement code snippet is provided by the AI.
 *
 * @param comment - The ReviewComment object containing the issue description, suggestion, and optional code.
 * @returns The formatted markdown string ready to be posted as a thread comment.
 */
function formatComment(comment: ReviewComment): string {
  let text = `${comment.issue}\n\n${comment.suggestion}`;

  if (comment.replacementCode) {
    text += `\n\n\`\`\`suggestion\n${comment.replacementCode}\n\`\`\``;
  }

  return text;
}

// ============================================================
// Logic Helper: Auto-Resolve Discussions
// ============================================================
/**
 * Handles the automatic resolution of outdated AI review discussions.
 * Iterates through existing merge request discussions, validates if the originally
 * reported issue has been fixed in the current diff, and resolves the thread on the platform.
 *
 * @param provider - The PlatformProvider instance.
 * @param projectId - The unique identifier of the target repository.
 * @param mrIid - The internal ID of the Merge Request.
 * @param existingDiscussions - An array of all current discussions/threads in the Merge Request.
 * @param diffs - An array of all file changes in the current Merge Request iteration.
 * @param currentIssuesHashes - A Set of cryptographic hashes representing the active issues found in the current review run.
 */
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

    // 1. Cek apakah diskusi bisa dan belum di-resolve, serta merupakan buatan Yolo
    if (!note?.resolvable || note?.resolved || !note?.body.includes('Yolo')) {
      continue;
    }

    // 2. Ekstrak hash dari komentar
    const match = note.body.match(/<!--\s*hash:(.+?)\s*-->/);
    if (!match) continue;

    const oldHash = match[1];
    const filePath = note.position?.new_path;

    // 3. Pastikan filePath ada
    if (!filePath) {
      console.info(`[Yolo] ⏭️ Skip auto-resolve [${d.id}]: File path not found in payload.`);
      continue;
    }

    // 4. Pastikan file masih ada dalam perubahan (diffs)
    const fileInChanges = diffs.find(
      (c: any) => c.new_path === filePath || c.old_path === filePath,
    );
    if (!fileInChanges) {
      console.info(
        `[Yolo] ⏭️ Skip auto-resolve [${d.id}]: File '${filePath}' not in current diffs.`,
      );
      continue;
    }

    // 5. Cek apakah issue masih eksis di kode yang baru
    if (currentIssuesHashes.has(oldHash as string)) {
      console.info(
        `[Yolo] ⏭️ Skip auto-resolve [${d.id}]: Issue in '${filePath}' is not fixed (hash still detected).`,
      );
      continue;
    }

    // 6. Jika lolos semua cek, resolve diskusi!
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
