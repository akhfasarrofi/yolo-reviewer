export * from '../platforms/types.ts';

export interface StandardReviewPayload {
  projectId: string | number;
  mrIid: string | number;
  repoName: string; // owner/repo
  projectName: string; // just repo name
  repoUrl: string; // full repo url
  projectHomepage: string; // homepage url
  mrUrl: string;
  base_sha: string;
  head_sha: string;
  start_sha: string;
  /** The branch this PR/MR is targeting (e.g. "main", "develop") */
  target_branch: string;
  assignees: string[]; // array of names
  reviewers: string[]; // array of names
}

/** Per-repository configuration loaded from `.yolo/config.yml` inside the target repo. */
export interface RepoConfig {
  filters?: {
    /** If set, Yolo will only review PRs/MRs targeting these branches. */
    target_branches?: string[];
  };
  lgtm?: {
    message?: string;
  };
  telegram_templates?: TelegramTemplates;
}

export interface TelegramTemplates {
  review_summary?: string;
  lgtm?: string;
  error?: string;
}

export interface GitHubPRWebhook {
  action: string;
  number: number;
  pull_request: {
    number: number;
    state: string;
    assignees?: { login: string }[];
    requested_reviewers?: { login: string }[];
    head: {
      sha: string;
    };
    base: {
      sha: string;
      ref: string;
    };
  };
  repository: {
    name: string; // just repo name
    full_name: string; // owner/repo
    html_url: string;
    homepage?: string;
  };
}

export interface GitLabMRWebhook {
  object_kind: 'merge_request';
  project: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
    homepage: string;
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
  assignees?: { name: string }[];
  reviewers?: { name: string }[];
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

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  topic_id?: number;
  error_topic_id?: number;
  trigger_categories?: string[];
  templates?: TelegramTemplates;
}

export interface AppConfig {
  skillsPath: string;
  responseLanguage: string;
  features: {
    autoResolve: boolean;
    summaryComment: boolean;
    lgtm: {
      enabled: boolean;
      message: string;
    };
  };
  output: {
    format: string;
    schema: any;
  };
  instructions: string[];
  notifications?: {
    telegram?: TelegramConfig;
  };
}
