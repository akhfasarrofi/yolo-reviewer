#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prompts from 'prompts';

// ─────────────────────────────────────────────────────────
// File Templates
// ─────────────────────────────────────────────────────────

const SERVER_CONFIG_TEMPLATE = `skillsPath: ".skills"
responseLanguage: "{{responseLanguage}}"
features:
  autoResolve: true
  summaryComment: true

behavior:
  diff_only: true
  no_hallucination: true
  no_repeat_issue: true
  avoid_nitpick: true
  confidence_threshold: 0.7

output:
  format: json
  schema:
    comments:
      type: array
      items:
        line:
          type: integer
          description: >
            Nomor baris pada diff yang memiliki issue.
        category:
          type: string
          description: >
            Kategori isu. Gunakan nama yang sesuai dengan file di .skills/
            (misal: security, performance, clean-code, bug, style).
        issue:
          type: string
          description: >
            Deskripsi masalah berdasarkan skill rules yang aktif.
        suggestion:
          type: string
          description: >
            Solusi teknis yang actionable, singkat, dan jelas.
        replacementCode:
          type: string
          required: false
          description: >
            Opsional.
            Berisi kode pengganti secara langsung tanpa markdown code block
            atau triple backticks.

# Telegram Notifications (Optional)
# Uncomment and fill in to enable Telegram alerts for specific issue categories.
# notifications:
#   telegram:
#     bot_token: "YOUR_BOT_TOKEN"
#     chat_id: "YOUR_CHAT_ID"
#     trigger_categories:
#       - security
#       - critical

instructions:
  - Hanya review code yang berubah
  - Jangan review unchanged code
  - Jangan mengulang issue yang sudah diperbaiki
  - Jangan memindahkan issue lama ke nearby line
  - Jangan memaksa menemukan issue
  - Jika tidak ada issue, return empty issues array
`;

const REPO_CONFIG_TEMPLATE = `# Yolo AI Reviewer — Per-Repository Configuration
# Place this file at .yolo/config.yml in the root of each repository you want to review.
# If this file is missing, Yolo will fall back to the server defaults.

filters:
  # Only review PRs/MRs that target these branches.
  # Remove or leave empty to review all target branches.
  target_branches:
    - main
    - develop
`;

// ─────────────────────────────────────────────────────────
// Prompts — organized by group for easy maintenance
// ─────────────────────────────────────────────────────────

const PLATFORM_QUESTION: prompts.PromptObject = {
  choices: [
    { title: 'GitLab', value: 'gitlab' },
    { title: 'GitHub', value: 'github' },
  ],
  initial: 0,
  message: 'Select your Git Platform',
  name: 'platform',
  type: 'select',
};

/** Questions shown only when the user selects GitLab */
const GITLAB_QUESTIONS: prompts.PromptObject[] = [
  {
    initial: 'glpat-xxxx',
    message: 'Enter GitLab Token (PRIVATE-TOKEN)',
    name: 'gitlabToken',
    type: (_prev, values) => (values.platform === 'gitlab' ? 'text' : null),
  },
  {
    initial: 'https://gitlab.com',
    message: 'Enter GitLab URL',
    name: 'gitlabUrl',
    type: (_prev, values) => (values.platform === 'gitlab' ? 'text' : null),
  },
  {
    message: 'Enter GitLab Secret Webhook Token (Optional, press enter to skip)',
    name: 'gitlabWebhookSecret',
    type: (_prev, values) => (values.platform === 'gitlab' ? 'text' : null),
  },
];

/** Questions shown only when the user selects GitHub */
const GITHUB_QUESTIONS: prompts.PromptObject[] = [
  {
    initial: 'ghp_xxxx',
    message: 'Enter GitHub Personal Access Token',
    name: 'githubToken',
    type: (_prev, values) => (values.platform === 'github' ? 'text' : null),
  },
  {
    message: 'Enter GitHub Webhook Secret (Recommended for security)',
    name: 'githubWebhookSecret',
    type: (_prev, values) => (values.platform === 'github' ? 'text' : null),
  },
];

/** AI provider questions — shared between all platforms */
const AI_QUESTIONS: prompts.PromptObject[] = [
  {
    choices: [
      { title: 'OpenAI', value: 'openai' },
      { title: 'Anthropic', value: 'anthropic' },
      { title: 'Gemini', value: 'gemini' },
      { title: 'Custom / Self-Hosted LLM', value: 'custom' },
    ],
    message: 'Select AI Provider',
    name: 'aiProvider',
    type: 'select',
  },
  {
    initial: (_prev: any, values: any) => {
      const defaults: Record<string, string> = {
        anthropic: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com',
        openai: 'https://api.openai.com',
      };
      return defaults[values.aiProvider] ?? 'http://localhost:11434';
    },
    message: 'Enter AI Base URL',
    name: 'aiBaseUrl',
    type: 'text',
  },
  {
    initial: 'sk-xxxx',
    message: 'Enter AI API Key',
    name: 'aiApiKey',
    type: 'text',
  },
  {
    initial: 'gpt-4o-mini',
    message: 'Enter AI Model Name',
    name: 'aiModel',
    type: 'text',
  },
  {
    float: true,
    initial: 0.1,
    max: 2,
    message: 'Enter AI Temperature (0.0 - 2.0)',
    min: 0,
    name: 'aiTemperature',
    type: 'number',
  },
  {
    float: true,
    initial: 1.0,
    max: 1,
    message: 'Enter AI Top-P (0.0 - 1.0)',
    min: 0,
    name: 'aiTopP',
    type: 'number',
  },
  {
    choices: [
      { title: 'Indonesian', value: 'Indonesian' },
      { title: 'English', value: 'English' },
    ],
    initial: 0,
    message: 'Select AI Response Language',
    name: 'responseLanguage',
    type: 'select',
  },
];

/** Optional Telegram notification setup */
const TELEGRAM_QUESTIONS: prompts.PromptObject[] = [
  {
    initial: false,
    message: 'Do you want to set up Telegram notifications? (optional)',
    name: 'enableTelegram',
    type: 'confirm',
  },
  {
    message: 'Enter Telegram Bot Token',
    name: 'telegramBotToken',
    type: (_prev, values) => (values.enableTelegram ? 'text' : null),
  },
  {
    message: 'Enter Telegram Chat ID',
    name: 'telegramChatId',
    type: (_prev, values) => (values.enableTelegram ? 'text' : null),
  },
  {
    initial: 'security',
    message: 'Enter trigger categories (comma-separated, e.g. security,critical)',
    name: 'telegramCategories',
    type: (_prev, values) => (values.enableTelegram ? 'text' : null),
  },
];

// ─────────────────────────────────────────────────────────
// .env Builder
// ─────────────────────────────────────────────────────────

function buildEnvContent(response: Record<string, any>): string {
  const platformBlock =
    response.platform === 'gitlab'
      ? `# GitLab Platform\nGITLAB_URL=${response.gitlabUrl}\nGITLAB_TOKEN=${response.gitlabToken}\nGITLAB_WEBHOOK_SECRET=${response.gitlabWebhookSecret || ''}`
      : `# GitHub Platform\nGITHUB_TOKEN=${response.githubToken}\nGITHUB_WEBHOOK_SECRET=${response.githubWebhookSecret || ''}\nGITHUB_API_URL=https://api.github.com`;

  const aiBlock = `# AI Provider
AI_BASE_URL=${response.aiBaseUrl}
AI_API_KEY=${response.aiApiKey}
AI_MODEL=${response.aiModel}
AI_TEMPERATURE=${response.aiTemperature}
AI_TOP_P=${response.aiTopP}`;

  return [platformBlock, aiBlock, '# Server\nPORT=3000'].join('\n\n');
}

/**
 * Builds the Telegram notifications block for config.yml if the user opted in.
 * Returns an empty string if Telegram was skipped.
 */
function buildTelegramConfigBlock(response: Record<string, any>): string {
  if (!response.enableTelegram) return '';

  const categories = (response.telegramCategories as string)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `      - ${c}`)
    .join('\n');

  return `
notifications:
  telegram:
    bot_token: "${response.telegramBotToken}"
    chat_id: "${response.telegramChatId}"
    trigger_categories:
${categories}`;
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

async function main() {
  console.info('\n🤖 Welcome to YOLO AI Reviewer CLI!');
  console.info("Let's set up your initial configuration.\n");

  const response = await prompts([
    PLATFORM_QUESTION,
    ...GITLAB_QUESTIONS,
    ...GITHUB_QUESTIONS,
    ...AI_QUESTIONS,
    ...TELEGRAM_QUESTIONS,
  ]);

  if (!response.platform) {
    console.info('❌ Setup cancelled by user.');
    process.exit(1);
  }

  // Write .env
  writeFileSync(resolve(process.cwd(), '.env'), buildEnvContent(response));

  // Write config.yml with optional Telegram block appended
  const telegramBlock = buildTelegramConfigBlock(response);
  const configContent = SERVER_CONFIG_TEMPLATE.replace(
    '{{responseLanguage}}',
    response.responseLanguage,
  ).replace(
    '# Telegram Notifications (Optional)\n# Uncomment and fill in to enable Telegram alerts for specific issue categories.\n# notifications:\n#   telegram:\n#     bot_token: "YOUR_BOT_TOKEN"\n#     chat_id: "YOUR_CHAT_ID"\n#     trigger_categories:\n#       - security\n#       - critical',
    telegramBlock ||
      '# Telegram Notifications (Optional)\n# Uncomment and fill in to enable Telegram alerts for specific issue categories.\n# notifications:\n#   telegram:\n#     bot_token: "YOUR_BOT_TOKEN"\n#     chat_id: "YOUR_CHAT_ID"\n#     trigger_categories:\n#       - security\n#       - critical',
  );
  writeFileSync(resolve(process.cwd(), 'config.yml'), configContent);

  // Write per-repo config template into .yolo/config.yml
  const yoloDir = resolve(process.cwd(), '.yolo');
  mkdirSync(yoloDir, { recursive: true });
  writeFileSync(resolve(yoloDir, 'config.yml'), REPO_CONFIG_TEMPLATE);

  console.info('\n✅ Setup completed successfully!');
  console.info('📝 Files generated:');
  console.info('   - .env              (server credentials & AI config)');
  console.info('   - config.yml        (server-level AI behavior)');
  console.info(
    '   - .yolo/config.yml  (per-repo branch filters — commit this to your target repos)',
  );
  if (response.enableTelegram) {
    console.info('   📨 Telegram notifications configured in config.yml');
  }
  console.info("\n🚀 Run 'bun dev' or 'bun start' to start the server.");
}

main().catch(console.error);
