export interface ReviewNotificationContext {
  repoName: string;
  projectName: string;
  repoUrl: string;
  projectHomepage: string;
  mrUrl: string;
  mrIid: string | number;
  totalIssues: number;
  fileCount: number;
  /** category → jumlah issue */
  categorySummary: Record<string, number>;
  /** categories dari trigger_categories — ditampilkan dengan highlight ⚠️ */
  highlightedCategories?: string[];
  assignees: string[];
  reviewers: string[];
}

export interface LgtmNotificationContext {
  repoName: string;
  projectName: string;
  repoUrl: string;
  projectHomepage: string;
  mrUrl: string;
  mrIid: string | number;
  assignees: string[];
  reviewers: string[];
}

export interface ErrorNotificationContext {
  repoName: string;
  projectName: string;
  repoUrl: string;
  projectHomepage: string;
  mrUrl: string;
  mrIid: string | number;
  assignees: string[];
  reviewers: string[];
  errorMessage: string;
}

export interface NotificationProvider {
  sendReviewSummary(ctx: ReviewNotificationContext): Promise<void>;
  sendLgtm(ctx: LgtmNotificationContext): Promise<void>;
  sendError(ctx: ErrorNotificationContext): Promise<void>;
}
