#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prompts from 'prompts';

const CONFIG_TEMPLATE = `skillsPath: ".skills"
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

instructions:
  - Hanya review code yang berubah
  - Jangan review unchanged code
  - Jangan mengulang issue yang sudah diperbaiki
  - Jangan memindahkan issue lama ke nearby line
  - Jangan memaksa menemukan issue
  - Jika tidak ada issue, return empty issues array
`;

async function main() {
  console.info('\n🤖 Welcome to YOLO AI Reviewer CLI!');
  console.info("Let's set up your initial configuration.\n");

  const response = await prompts([
    {
      choices: [
        { title: 'GitLab', value: 'gitlab' },
        { disabled: true, title: 'GitHub', value: 'github' },
      ],
      initial: 0,
      message: 'Select your Git Platform',
      name: 'platform',
      type: 'select',
    },
    {
      initial: 'glpat-xxxx',
      message: 'Enter GitLab Token (PRIVATE-TOKEN)',
      name: 'gitlabToken',
      type: 'text',
    },
    {
      initial: 'https://gitlab.com',
      message: 'Enter GitLab URL',
      name: 'gitlabUrl',
      type: 'text',
    },
    {
      message: 'Enter Secret Webhook Token (Optional, press enter to skip)',
      name: 'webhookSecret',
      type: 'text',
    },
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
      initial: (_prev, values) => {
        if (values.aiProvider === 'openai') return 'https://api.openai.com';
        if (values.aiProvider === 'anthropic') return 'https://api.anthropic.com';
        if (values.aiProvider === 'gemini') return 'https://generativelanguage.googleapis.com';
        return 'http://localhost:11434';
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
  ]);

  if (!response.platform) {
    console.info('❌ Setup cancelled by user.');
    process.exit(1);
  }

  const envContent = `
# Platform
GITLAB_URL=${response.gitlabUrl}
GITLAB_TOKEN=${response.gitlabToken}
GITLAB_WEBHOOK_SECRET=${response.webhookSecret}

# AI Provider
AI_BASE_URL=${response.aiBaseUrl}
AI_API_KEY=${response.aiApiKey}
AI_MODEL=${response.aiModel}
AI_TEMPERATURE=${response.aiTemperature}
AI_TOP_P=${response.aiTopP}

# Server
PORT=3000
`.trim();

  const configContent = CONFIG_TEMPLATE.replace('{{responseLanguage}}', response.responseLanguage);

  const envPath = resolve(process.cwd(), '.env');
  const configPath = resolve(process.cwd(), 'config.yml');

  writeFileSync(envPath, envContent);
  writeFileSync(configPath, configContent);

  console.info('\n✅ Setup completed successfully!');
  console.info(`📝 Files generated: .env, config.yml`);
  console.info(`🚀 Run 'bun dev' or 'bun start' to start the server.`);
}

main().catch(console.error);
