import type { ReviewComment } from '@/types';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Escapes special characters required by Telegram's MarkdownV2 format.
 */
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
}

/**
 * Formats a list of filtered review comments into a Telegram MarkdownV2 message.
 */
function buildMessage(
  repoName: string,
  mrUrl: string,
  mrIid: string | number,
  comments: { file: string; comment: ReviewComment }[],
): string {
  if (comments.length === 0) return '';
  const categoryLabel = comments[0]?.comment.category.toUpperCase() ?? 'ISSUE';
  const header = [
    `🔴 *Yolo Alert \\— ${escapeMd(categoryLabel)}*`,
    `*Repo:* \`${escapeMd(repoName)}\``,
    `*PR/MR:* [\\#${mrIid}](${mrUrl})`,
    '',
  ].join('\n');

  const body = comments
    .map(({ file, comment }) => {
      const lines = [`⚠️ *Line ${comment.line}* in \`${escapeMd(file)}\``, escapeMd(comment.issue)];
      return lines.join('\n');
    })
    .join('\n\n');

  return `${header}${body}`;
}

/**
 * Sends a message to a Telegram chat via Bot API.
 */
async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

  const res = await fetch(url, {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      parse_mode: 'MarkdownV2',
      text,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Yolo] ❌ Telegram notification failed: ${res.status} ${err}`);
  }
}

/**
 * Sends Telegram alerts for review comments whose category matches the trigger list.
 * Groups comments by category and sends one message per category.
 */
export async function sendTelegramAlerts(
  botToken: string,
  chatId: string,
  triggerCategories: string[],
  repoName: string,
  mrUrl: string,
  mrIid: string | number,
  allComments: { file: string; comment: ReviewComment }[],
): Promise<void> {
  // Normalize to lowercase for case-insensitive matching
  const triggers = new Set(triggerCategories.map((c) => c.toLowerCase()));

  const matched = allComments.filter(({ comment }) => triggers.has(comment.category.toLowerCase()));

  if (matched.length === 0) return;

  // Group by category to send one clean message per category type
  const byCategory = Map.groupBy(matched, ({ comment }) => comment.category.toLowerCase());

  for (const [, comments] of byCategory) {
    if (!comments || comments.length === 0) continue;
    const message = buildMessage(repoName, mrUrl, mrIid, comments);
    await sendMessage(botToken, chatId, message);
    const category = comments[0]?.comment.category ?? 'unknown';
    console.info(
      `[Yolo] 📨 Telegram alert sent for category '${category}' (${comments.length} issue${comments.length > 1 ? 's' : ''}).`,
    );
  }
}
