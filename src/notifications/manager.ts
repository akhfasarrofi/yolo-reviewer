import type {
  ErrorNotificationContext,
  LgtmNotificationContext,
  NotificationProvider,
  ReviewNotificationContext,
} from './types';

export class NotificationManager {
  private providers: NotificationProvider[] = [];

  register(provider: NotificationProvider) {
    this.providers.push(provider);
  }

  async sendReviewSummary(ctx: ReviewNotificationContext) {
    await Promise.all(this.providers.map((p) => p.sendReviewSummary(ctx)));
  }

  async sendLgtm(ctx: LgtmNotificationContext) {
    await Promise.all(this.providers.map((p) => p.sendLgtm(ctx)));
  }

  async sendError(ctx: ErrorNotificationContext) {
    await Promise.all(this.providers.map((p) => p.sendError(ctx)));
  }
}
