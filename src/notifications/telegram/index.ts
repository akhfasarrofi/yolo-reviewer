import type { TelegramConfig, TelegramTemplates } from '@/types';
import { renderTemplate } from '../template';
import type {
  ErrorNotificationContext,
  LgtmNotificationContext,
  NotificationProvider,
  ReviewNotificationContext,
} from '../types';
import { escapeMd } from './formatter';

const TELEGRAM_API = 'https://api.telegram.org';

const BUILT_IN_TEMPLATES: TelegramTemplates = {
  error: `❌ *AI Review Gagal*
*Repo:* {{repo}}
*PR/MR:* [\\#{{mr_id}}]({{mr_url}})
*Error:* {{error}}`,
  lgtm: `✅ *LGTM\\!*
*Repo:* {{repo}}
*PR/MR:* [\\#{{mr_id}}]({{mr_url}})
Tidak ada issue yang ditemukan 🚀`,
  review_summary: `🔴 *Review Finished* — {{repo}}
*PR/MR:* [\\#{{mr_id}}]({{mr_url}})

Found *{{total_issues}} issue* in *{{file_count}} file*:
{{category_details}}`,
};

export class TelegramNotificationProvider implements NotificationProvider {
  private config: TelegramConfig;
  private templates: TelegramTemplates;

  constructor(config: TelegramConfig, templates: TelegramTemplates) {
    this.config = config;
    this.templates = { ...BUILT_IN_TEMPLATES, ...templates };
  }

  private async sendMessage(text: string, topicId?: number): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.config.bot_token}/sendMessage`;

    const body: any = {
      chat_id: this.config.chat_id,
      disable_web_page_preview: true,
      parse_mode: 'MarkdownV2',
      text,
    };

    if (topicId) {
      body.message_thread_id = topicId;
    }

    const res = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Yolo] ❌ Telegram notification failed: ${res.status} ${err}`);
    }
  }

  async sendReviewSummary(ctx: ReviewNotificationContext): Promise<void> {
    let categoryDetails = '';

    // Sort categories, highlighted first
    const categories = Object.keys(ctx.categorySummary).sort((a, b) => {
      const aHighlight = ctx.highlightedCategories?.includes(a) ? 1 : 0;
      const bHighlight = ctx.highlightedCategories?.includes(b) ? 1 : 0;
      if (aHighlight !== bHighlight) return bHighlight - aHighlight;
      return a.localeCompare(b);
    });

    for (const cat of categories) {
      const count = ctx.categorySummary[cat];
      const isHighlighted = ctx.highlightedCategories?.includes(cat);
      const icon = isHighlighted ? '⚠️' : '•';
      // Format:   ⚠️ security: 2 issue
      categoryDetails += `  ${icon} ${escapeMd(cat)}: ${count} issue\n`;
    }

    const assigneeNames = ctx.assignees.length > 0 ? ctx.assignees.join(', ') : 'None';
    const reviewerNames = ctx.reviewers.length > 0 ? ctx.reviewers.join(', ') : 'None';
    const template = this.templates.review_summary!;
    const message = renderTemplate(template, {
      assignee: escapeMd(ctx.assignees[0] || 'None'),
      assignees: escapeMd(assigneeNames),
      file_count: ctx.fileCount,
      mr_id: escapeMd(String(ctx.mrIid)),
      mr_url: ctx.mrUrl,
      project_homepage: ctx.projectHomepage,
      project_name: escapeMd(ctx.projectName),
      project_url: ctx.repoUrl,
      repo: escapeMd(ctx.repoName),
      reviewer: escapeMd(ctx.reviewers[0] || 'None'),
      reviewers: escapeMd(reviewerNames),
      total_issues: ctx.totalIssues,
    }).replace('{{category_details}}', categoryDetails.trimEnd());

    await this.sendMessage(message, this.config.topic_id);
    console.info(`[Yolo] 📨 Telegram review summary sent.`);
  }

  async sendLgtm(ctx: LgtmNotificationContext): Promise<void> {
    const assigneeNames = ctx.assignees.length > 0 ? ctx.assignees.join(', ') : 'None';
    const reviewerNames = ctx.reviewers.length > 0 ? ctx.reviewers.join(', ') : 'None';
    const template = this.templates.lgtm!;
    const message = renderTemplate(template, {
      assignee: escapeMd(ctx.assignees[0] || 'None'),
      assignees: escapeMd(assigneeNames),
      mr_id: escapeMd(String(ctx.mrIid)),
      mr_url: ctx.mrUrl,
      project_homepage: ctx.projectHomepage,
      project_name: escapeMd(ctx.projectName),
      project_url: ctx.repoUrl,
      repo: escapeMd(ctx.repoName),
      reviewer: escapeMd(ctx.reviewers[0] || 'None'),
      reviewers: escapeMd(reviewerNames),
    });

    await this.sendMessage(message, this.config.topic_id);
    console.info(`[Yolo] 📨 Telegram LGTM notification sent.`);
  }

  async sendError(ctx: ErrorNotificationContext): Promise<void> {
    const assigneeNames = ctx.assignees.length > 0 ? ctx.assignees.join(', ') : 'None';
    const reviewerNames = ctx.reviewers.length > 0 ? ctx.reviewers.join(', ') : 'None';
    const template = this.templates.error!;
    const message = renderTemplate(template, {
      assignee: escapeMd(ctx.assignees[0] || 'None'),
      assignees: escapeMd(assigneeNames),
      error: escapeMd(ctx.errorMessage),
      mr_id: escapeMd(String(ctx.mrIid)),
      mr_url: ctx.mrUrl,
      project_homepage: ctx.projectHomepage,
      project_name: escapeMd(ctx.projectName),
      project_url: ctx.repoUrl,
      repo: escapeMd(ctx.repoName),
      reviewer: escapeMd(ctx.reviewers[0] || 'None'),
      reviewers: escapeMd(reviewerNames),
    });

    const topicId = this.config.error_topic_id ?? this.config.topic_id;
    await this.sendMessage(message, topicId);
    console.info(`[Yolo] 📨 Telegram error notification sent.`);
  }
}
