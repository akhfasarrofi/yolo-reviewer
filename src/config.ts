import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { AppConfig } from '@/types';

const IS_CI =
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.GITLAB_CI === 'true' ||
  process.env.YOLO_CI === 'true';

const CONFIG_PATH = resolve(process.cwd(), 'config.yml');

let _config: AppConfig | null = null;

const EnvSchema = z
  .object({
    AI_API_KEY: z.string().min(1, 'AI_API_KEY cannot be empty'),
    AI_BASE_URL: z.url('AI_BASE_URL must be a valid URL'),
    AI_MODEL: z.string().min(1, 'AI_MODEL cannot be empty').default('gemini-3-flash'),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
    AI_TOP_P: z.coerce.number().min(0).max(1).default(1.0),
    GITHUB_API_URL: z.url().optional(),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_PRIVATE_KEY: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    GITLAB_TOKEN: z.string().optional(),
    GITLAB_URL: z.url().optional(),
    PORT: z.coerce.number().default(3000),
  })
  .superRefine((data, ctx) => {
    const hasGitLab = !!(data.GITLAB_TOKEN && data.GITLAB_URL);
    const hasGitHubPAT = !!data.GITHUB_TOKEN;
    const hasGitHubApp = !!(data.GITHUB_APP_ID && data.GITHUB_PRIVATE_KEY);
    const hasGitHub = hasGitHubPAT || hasGitHubApp;

    if (!hasGitLab && !hasGitHub) {
      ctx.addIssue({
        code: 'custom',
        message:
          'You must provide either GitLab credentials, a GitHub PAT (GITHUB_TOKEN), or GitHub App credentials (APP_ID, PRIVATE_KEY).',
        path: ['platform'],
      });
    }
  });

const TelegramTemplatesSchema = z.object({
  error: z.string().optional(),
  lgtm: z.string().optional(),
  review_summary: z.string().optional(),
});

const ConfigSchema = z.object({
  features: z.object({
    autoResolve: z.boolean(),
    lgtm: z
      .object({
        enabled: z.boolean().default(true),
        message: z.string().default('✅ **LGTM!** No issues found. This PR/MR looks good to go 🚀'),
      })
      .default({
        enabled: true,
        message: '✅ **LGTM!** No issues found. This PR/MR looks good to go 🚀',
      }),
    summaryComment: z.boolean(),
  }),
  instructions: z.array(z.string()),
  notifications: z
    .object({
      telegram: z
        .object({
          bot_token: z.coerce.string().min(1),
          chat_id: z.coerce.string().min(1),
          error_topic_id: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
          templates: TelegramTemplatesSchema.optional(),
          topic_id: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
          trigger_categories: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  output: z.object({
    format: z.string(),
    schema: z.record(z.string(), z.any()),
  }),
  responseLanguage: z.string().min(1),
  skillsPath: z.string().min(1),
});

async function initConfig(): Promise<AppConfig> {
  try {
    const envResult = EnvSchema.safeParse(process.env);
    if (!envResult.success) {
      console.error(
        '\n\x1b[31m❌ Yolo AI Reviewer Failed to Start (Environment Variables not complete)\x1b[0m',
      );
      console.error(
        '\x1b[33m💡 Solution: Check your .env file or run "bun run src/cli/index.ts" for automatic setup.\x1b[0m\n',
      );
      console.error('Detail Error:');
      for (const issue of envResult.error.issues) {
        console.error(`  - \x1b[31m${issue.path.join('.')}\x1b[0m: ${issue.message}`);
      }
      process.exit(1);
    }

    // Assign back defaults to process.env
    process.env.AI_MODEL = envResult.data.AI_MODEL;
    process.env.AI_TEMPERATURE = envResult.data.AI_TEMPERATURE.toString();
    process.env.AI_TOP_P = envResult.data.AI_TOP_P.toString();
    process.env.PORT = envResult.data.PORT.toString();

    // 2. Validate config.yml
    const text = await Bun.file(CONFIG_PATH).text();
    const replacedText = text.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
    const raw = load(replacedText);

    const configResult = ConfigSchema.safeParse(raw);
    if (!configResult.success) {
      console.error(
        '\n\x1b[31m❌ Yolo AI Reviewer failed to read config.yml file because the format is incorrect\x1b[0m',
      );
      console.error(
        '\x1b[33m💡 Solution: You can recreate the default configuration by running the command "bun run src/cli/index.ts"\x1b[0m\n',
      );
      console.error('Detail Error (Schema Mismatch):');
      for (const issue of configResult.error.issues) {
        console.error(`  - \x1b[31m${issue.path.join('.')}\x1b[0m: ${issue.message}`);
      }
      process.exit(1);
    }

    return configResult.data as AppConfig;
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (err?.code === 'ENOENT') {
      // In CI mode, config.yml is not expected — build a default config from env vars
      if (IS_CI) {
        return buildCiConfig();
      }
      console.error('\n\x1b[31m❌ config.yml file not found!\x1b[0m');
      console.error(
        '\x1b[33m💡 Solution: Run the command "npx yolo-reviewer init" to create the initial configuration automatically.\x1b[0m\n',
      );
    } else {
      console.error(`\n\x1b[31m❌ Failed to load configuration: ${message}\x1b[0m\n`);
    }
    process.exit(1);
  }
}

/**
 * Builds a minimal AppConfig from environment variables for CI/CD mode.
 * Telegram is optional — only included if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
 */
function buildCiConfig(): AppConfig {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const telegramCategories = process.env.TELEGRAM_TRIGGER_CATEGORIES?.split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const hasTelegram = !!(telegramBotToken && telegramChatId && telegramCategories?.length);

  return {
    features: {
      autoResolve: false,
      lgtm: {
        enabled: true,
        message: '✅ **LGTM!** No issues found. This PR/MR looks good to go 🚀',
      },
      summaryComment: true,
    },
    instructions: [
      'Only review changed code',
      'Do not repeat issues already commented',
      'Do not force finding issues',
      'If no issues found, return empty array',
    ],
    notifications: hasTelegram
      ? {
          telegram: {
            bot_token: telegramBotToken!,
            chat_id: telegramChatId!,
            trigger_categories: telegramCategories,
          },
        }
      : undefined,
    output: { format: 'json', schema: {} },
    responseLanguage: process.env.YOLO_RESPONSE_LANGUAGE || 'English',
    skillsPath: '.skills',
  };
}

_config = await initConfig();

watch(CONFIG_PATH, () => {
  Bun.file(CONFIG_PATH)
    .text()
    .then((text) => {
      // Apply env substitution on reload too
      const replacedText = text.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
      const raw = load(replacedText);
      const configResult = ConfigSchema.safeParse(raw);

      if (configResult.success) {
        _config = configResult.data as AppConfig;
      } else {
        console.warn(
          '\x1b[33m[Yolo] WARN: Failed to reload config.yml because it is invalid:\x1b[0m',
        );
        for (const issue of configResult.error.issues) {
          console.warn(`  - \x1b[31m${issue.path.join('.')}\x1b[0m: ${issue.message}`);
        }
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `\x1b[33m[Yolo] WARN: Failed to reload config.yml — ${message}. Using the old config.\x1b[0m`,
      );
    });
});

export function getConfig(): AppConfig {
  if (!_config) {
    console.error('\x1b[31m[Yolo] ERROR: Config not initialized.\x1b[0m');
    process.exit(1);
  }
  return _config;
}
