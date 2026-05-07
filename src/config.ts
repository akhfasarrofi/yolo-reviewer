import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { AppConfig } from '@/types';

const CONFIG_PATH = resolve(process.cwd(), 'config.yml');

let _config: AppConfig | null = null;

const EnvSchema = z.object({
  AI_API_KEY: z.string().min(1, 'AI_API_KEY cannot be empty'),
  AI_BASE_URL: z.url('AI_BASE_URL must be a valid URL'),
  AI_MODEL: z.string().min(1, 'AI_MODEL cannot be empty').default('gemini-3-flash'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  AI_TOP_P: z.coerce.number().min(0).max(1).default(1.0),
  GITLAB_TOKEN: z.string().min(1, 'GITLAB_TOKEN cannot be empty'),
  GITLAB_URL: z.url('GITLAB_URL must be a valid URL'),
  PORT: z.coerce.number().default(3000),
});

const ConfigSchema = z.object({
  behavior: z.object({
    avoid_nitpick: z.boolean(),
    confidence_threshold: z.number().min(0).max(1),
    diff_only: z.boolean(),
    no_hallucination: z.boolean(),
    no_repeat_issue: z.boolean(),
  }),
  features: z.object({
    autoResolve: z.boolean(),
    summaryComment: z.boolean(),
  }),
  instructions: z.array(z.string()),
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
    const raw = load(text);

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
      console.error('\n\x1b[31m❌ config.yml file not found!\x1b[0m');
      console.error(
        '\x1b[33m💡 Solution: Run the command "bun run src/cli/index.ts" to create the initial configuration automatically.\x1b[0m\n',
      );
    } else {
      console.error(`\n\x1b[31m❌ Failed to load configuration: ${message}\x1b[0m\n`);
    }
    process.exit(1);
  }
}

_config = await initConfig();

watch(CONFIG_PATH, () => {
  Bun.file(CONFIG_PATH)
    .text()
    .then((text) => {
      const raw = load(text);
      const configResult = ConfigSchema.safeParse(raw);
      if (configResult.success) {
        _config = configResult.data as AppConfig;
      } else {
        console.warn(
          '\x1b[33m[Yolo] WARN: Failed to reload config.yml because it is invalid. Using the old config.\x1b[0m',
        );
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
