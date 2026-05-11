import crypto from 'node:crypto';
import { runReviewPipeline } from '@/ai/pipeline';
import type { GitHubPRWebhook, PlatformProvider, StandardReviewPayload } from '@/types';

/**
 * Validates the GitHub webhook payload using HMAC SHA-256.
 */
export function verifyGitHubSignature(
  signature: string | undefined,
  body: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = `sha256=${hmac.update(body).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Main handler for processing GitHub Pull Request webhook events.
 */
export async function handlePullRequestEvent(
  payload: GitHubPRWebhook,
  provider: PlatformProvider,
): Promise<{ processed: number; posted: number }> {
  const standardPayload: StandardReviewPayload = {
    base_sha: payload.pull_request.base.sha,
    head_sha: payload.pull_request.head.sha,
    mrIid: payload.number,
    mrUrl: `${payload.repository.html_url}/pull/${payload.number}`,
    projectId: payload.repository.full_name,
    repoName: payload.repository.full_name,
    repoUrl: payload.repository.html_url,
    start_sha: payload.pull_request.base.sha,
    target_branch: payload.pull_request.base.ref,
  };

  return runReviewPipeline(standardPayload, provider);
}
