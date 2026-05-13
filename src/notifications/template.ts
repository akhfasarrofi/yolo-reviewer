import type { TelegramTemplates } from '@/types';

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

/** Merge templates: per-repo > global config > built-in default */
export function resolveTemplates(
  builtIn: TelegramTemplates,
  globalConfig?: TelegramTemplates,
  repoOverride?: TelegramTemplates,
): TelegramTemplates {
  return { ...builtIn, ...globalConfig, ...repoOverride };
}
