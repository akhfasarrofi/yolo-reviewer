export * from '../platforms/types.ts';

export interface StandardReviewPayload {
  projectId: string | number;
  mrIid: string | number;
  repoName: string;
  repoUrl: string;
  mrUrl: string;
  base_sha: string;
  head_sha: string;
  start_sha: string;
  /** The branch this PR/MR is targeting (e.g. "main", "develop") */
  target_branch: string;
}

/** Per-repository configuration loaded from `.yolo/config.yml` inside the target repo. */
export interface RepoConfig {
  filters?: {
    /** If set, Yolo will only review PRs/MRs targeting these branches. */
    target_branches?: string[];
  };
}

export interface GitHubPRWebhook {
  action: string;
  number: number;
  pull_request: {
    number: number;
    state: string;
    head: {
      sha: string;
    };
    base: {
      sha: string;
      ref: string;
    };
  };
  repository: {
    full_name: string; // owner/repo
    html_url: string;
  };
}

export interface GitLabMRWebhook {
  object_kind: 'merge_request';
  project: {
    id: number;
    path_with_namespace: string;
    web_url: string;
  };
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    state: string;
    action: string;
    last_commit?: {
      id: string;
    };
    diff_refs?: {
      base_sha: string;
      head_sha: string;
      start_sha: string;
    };
    target_branch: string;
  };
}

export interface DiffLine {
  lineNumber: number; // line number in new file
  content: string;
}

export interface ParsedDiff {
  filePath: string;
  changedLines: Set<number>; // line numbers that changed (additions only)
}

export interface ReviewComment {
  line: number;
  category: string;
  issue: string;
  suggestion: string;
  replacementCode?: string;
}

export interface ReviewOutput {
  comments: ReviewComment[];
}

export interface ExistingComment {
  hash: string;
  discussionId: string;
}

export interface AppConfig {
  skillsPath: string;
  responseLanguage: string;
  features: {
    autoResolve: boolean;
    summaryComment: boolean;
  };
  behavior: {
    diff_only: boolean;
    no_hallucination: boolean;
    no_repeat_issue: boolean;
    avoid_nitpick: boolean;
    confidence_threshold: number;
  };
  output: {
    format: string;
    schema: any;
  };
  instructions: string[];
  notifications?: {
    telegram?: {
      bot_token: string;
      chat_id: string;
      /** Categories that trigger a Telegram notification (e.g. ["security", "critical"]) */
      trigger_categories: string[];
    };
  };
}
