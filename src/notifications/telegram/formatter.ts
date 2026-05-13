/**
 * Escapes special characters required by Telegram's MarkdownV2 format.
 */
export function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
}
