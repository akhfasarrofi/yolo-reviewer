#!/usr/bin/env node
/**
 * `yolo run` — CI/CD Mode Entry Point
 *
 * Runs a one-shot AI review triggered from a CI pipeline (GitHub Actions or GitLab CI).
 * Reads all required context (repo, PR/MR number, SHAs, branch) from CI environment variables.
 * No webhook server required.
 *
 * Usage:
 *   npx yolo run                  # auto-detect platform from env
 *   YOLO_PLATFORM=github npx yolo run  # force platform
 */

import { runReviewPipeline } from '@/ai/pipeline';
import { GitHubProvider } from '@/platforms/github/api';
import { GitLabProvider } from '@/platforms/gitlab/api';
import type { PlatformProvider, StandardReviewPayload } from '@/types';

// ─────────────────────────────────────────────────────────
// Platform Context Resolvers
// ─────────────────────────────────────────────────────────

/**
 * Builds a StandardReviewPayload from GitHub Actions environment variables.
 * Requires: GITHUB_REPOSITORY, GITHUB_SHA, PR_NUMBER, GITHUB_BASE_REF
 */
function resolveGitHubPayload(): StandardReviewPayload {
  const repo = process.env.GITHUB_REPOSITORY;
  const headSha = process.env.GITHUB_SHA;
  const prNumber = process.env.PR_NUMBER;
  const targetBranch = process.env.GITHUB_BASE_REF;

  const missing: string[] = [];
  if (!repo) missing.push('GITHUB_REPOSITORY');
  if (!headSha) missing.push('GITHUB_SHA');
  if (!prNumber) missing.push('PR_NUMBER');
  if (!targetBranch) missing.push('GITHUB_BASE_REF');

  if (missing.length > 0) {
    console.error(`[Yolo] ❌ Missing GitHub CI environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const mrIid = parseInt(prNumber!, 10);
  const repoUrl = `https://github.com/${repo}`;

  return {
    base_sha: '', // will be fetched by pipeline via getMRDiffs
    head_sha: headSha!,
    mrIid,
    mrUrl: `${repoUrl}/pull/${mrIid}`,
    projectId: repo!,
    repoName: repo!,
    repoUrl,
    start_sha: '',
    target_branch: targetBranch!,
  };
}

/**
 * Builds a StandardReviewPayload from GitLab CI environment variables.
 * Requires: CI_PROJECT_PATH, CI_COMMIT_SHA, CI_MERGE_REQUEST_IID, CI_MERGE_REQUEST_TARGET_BRANCH_NAME
 */
function resolveGitLabPayload(): StandardReviewPayload {
  const repo = process.env.CI_PROJECT_PATH;
  const headSha = process.env.CI_COMMIT_SHA;
  const mrIid = process.env.CI_MERGE_REQUEST_IID;
  const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
  const gitlabUrl = process.env.GITLAB_URL || 'https://gitlab.com';

  const missing: string[] = [];
  if (!repo) missing.push('CI_PROJECT_PATH');
  if (!headSha) missing.push('CI_COMMIT_SHA');
  if (!mrIid) missing.push('CI_MERGE_REQUEST_IID');
  if (!targetBranch) missing.push('CI_MERGE_REQUEST_TARGET_BRANCH_NAME');

  if (missing.length > 0) {
    console.error(`[Yolo] ❌ Missing GitLab CI environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const iid = parseInt(mrIid!, 10);
  const projectUrl = `${gitlabUrl}/${repo}`;

  return {
    base_sha: '',
    head_sha: headSha!,
    mrIid: iid,
    mrUrl: `${projectUrl}/-/merge_requests/${iid}`,
    projectId: repo!,
    repoName: repo!,
    repoUrl: projectUrl,
    start_sha: '',
    target_branch: targetBranch!,
  };
}

// ─────────────────────────────────────────────────────────
// Platform Auto-Detection
// ─────────────────────────────────────────────────────────

function detectPlatform(): 'github' | 'gitlab' {
  // Allow manual override via env
  const forced = process.env.YOLO_PLATFORM?.toLowerCase();
  if (forced === 'github') return 'github';
  if (forced === 'gitlab') return 'gitlab';

  // Auto-detect based on runner env variables
  if (process.env.GITHUB_ACTIONS === 'true') return 'github';
  if (process.env.GITLAB_CI === 'true') return 'gitlab';

  console.error(
    '[Yolo] ❌ Could not detect CI platform. Set YOLO_PLATFORM=github or YOLO_PLATFORM=gitlab.',
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

async function main() {
  console.info('\n🤖 Yolo AI Reviewer — CI Mode\n');

  const platform = detectPlatform();
  console.info(`[Yolo] 🔍 Detected platform: ${platform}`);

  let payload: StandardReviewPayload;
  let provider: PlatformProvider;

  if (platform === 'github') {
    payload = resolveGitHubPayload();
    provider = new GitHubProvider();
  } else {
    payload = resolveGitLabPayload();
    provider = new GitLabProvider();
  }

  const result = await runReviewPipeline(payload, provider);

  console.info(
    `[Yolo] ✅ CI review complete. Processed: ${result.processed}, Posted: ${result.posted}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[Yolo] ❌ Unhandled error in CI mode:', err);
  process.exit(1);
});
