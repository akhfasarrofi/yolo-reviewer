import { runReviewPipeline } from '@/ai/pipeline';
import type { GitLabMRWebhook, PlatformProvider, StandardReviewPayload } from '@/types';

/**
 * Main handler for processing GitLab Merge Request webhook events.
 */
export async function handleMergeRequestEvent(
  payload: GitLabMRWebhook,
  provider: PlatformProvider,
): Promise<{ processed: number; posted: number }> {
  const { object_attributes, project } = payload;

  const standardPayload: StandardReviewPayload = {
    assignees: payload.assignees?.map((a) => a.name) ?? [],
    base_sha: object_attributes.diff_refs?.base_sha ?? '',
    head_sha: object_attributes.diff_refs?.head_sha ?? '',
    mrIid: object_attributes.iid,
    mrUrl: `${project.web_url}/-/merge_requests/${object_attributes.iid}`,
    projectHomepage: project.homepage,
    projectId: project.id,
    projectName: project.name,
    repoName: project.path_with_namespace,
    repoUrl: project.web_url,
    reviewers: payload.reviewers?.map((r) => r.name) ?? [],
    start_sha: object_attributes.diff_refs?.start_sha ?? '',
    target_branch: object_attributes.target_branch,
  };

  return runReviewPipeline(standardPayload, provider);
}
