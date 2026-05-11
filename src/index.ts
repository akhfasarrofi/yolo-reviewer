import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { GitHubProvider } from './platforms/github/api.ts';
import { handlePullRequestEvent, verifyGitHubSignature } from './platforms/github/webhook.ts';
import { GitLabProvider } from './platforms/gitlab/api.ts';
import { handleMergeRequestEvent } from './platforms/gitlab/webhook.ts';
import type { GitHubPRWebhook, GitLabMRWebhook } from './types/index.ts';

const app = new Hono();

app.use(logger());

app.onError((err, c) => {
  console.error('[Yolo] Unhandled exception in Hono:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.get('/', (c) => c.json({ name: 'AI Reviewer', status: 'ok' }));

// --- GitLab Webhook Handler ---
app.post('/webhook/gitlab', async (c) => {
  const secretToken = process.env.GITLAB_WEBHOOK_SECRET;

  if (secretToken && c.req.header('X-Gitlab-Token') !== secretToken) {
    console.error('[Yolo] ✗ Unauthorized — token mismatch');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: GitLabMRWebhook;
  try {
    payload = await c.req.json<GitLabMRWebhook>();
  } catch {
    console.error('[Yolo] ✗ Invalid JSON payload');
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const kind = payload.object_kind;
  const action = payload.object_attributes?.action;
  const state = payload.object_attributes?.state;
  const mrIid = payload.object_attributes?.iid;

  if (kind !== 'merge_request') return c.json({ reason: 'Not a merge_request', skipped: true });
  if (!['open', 'reopen', 'update'].includes(action))
    return c.json({ reason: `Action '${action}' ignored`, skipped: true });
  if (state !== 'opened') return c.json({ reason: `MR state '${state}'`, skipped: true });

  console.info(`[Yolo] ✓ Proses review MR !${mrIid}...`);
  const provider = new GitLabProvider();

  Promise.resolve()
    .then(() => handleMergeRequestEvent(payload, provider))
    .catch((err) => console.error('[Yolo] Unhandled error:', err));

  return c.json({ mr_iid: mrIid, received: true });
});

// --- GitHub Webhook Handler ---
app.post('/webhook/github', async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signature = c.req.header('X-Hub-Signature-256');
  const rawBody = await c.req.text();

  if (secret && !verifyGitHubSignature(signature, rawBody, secret)) {
    console.error('[Yolo] ✗ Unauthorized — GitHub signature mismatch');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: GitHubPRWebhook;
  try {
    payload = JSON.parse(rawBody) as GitHubPRWebhook;
  } catch {
    console.error('[Yolo] ✗ Invalid JSON payload');
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const eventType = c.req.header('X-GitHub-Event');
  if (eventType !== 'pull_request')
    return c.json({ reason: `Not a PR event: ${eventType}`, skipped: true });

  if (!['opened', 'reopened', 'synchronize'].includes(payload.action)) {
    return c.json({ reason: `Action '${payload.action}' ignored`, skipped: true });
  }

  console.info(`[Yolo] ✓ Proses review PR #${payload.number}...`);
  const provider = new GitHubProvider();

  Promise.resolve()
    .then(() => handlePullRequestEvent(payload, provider))
    .catch((err) => console.error('[Yolo] Unhandled error:', err));

  return c.json({ pr_number: payload.number, received: true });
});

const port = parseInt(process.env.PORT ?? '3000', 10);
const hostname = '0.0.0.0';

export default {
  fetch: app.fetch,
  hostname,
  port,
};
