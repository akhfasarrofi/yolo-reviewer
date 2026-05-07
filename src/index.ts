import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { GitLabProvider } from './platforms/gitlab/api.ts';
import { handleMergeRequestEvent } from './platforms/gitlab/webhook.ts';
import type { GitLabMRWebhook, PlatformProvider } from './types/index.ts';

const app = new Hono();

app.use(logger());

app.onError((err, c) => {
  console.error('[Yolo] Unhandled exception in Hono:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.get('/', (c) => c.json({ name: 'AI Reviewer', status: 'ok' }));

app.post('/webhook/:provider', async (c) => {
  const providerName = c.req.param('provider');

  if (providerName === 'gitlab') {
    const secretToken = process.env.GITLAB_WEBHOOK_SECRET;

    if (secretToken) {
      const tokenHeader = c.req.header('X-Gitlab-Token');
      if (tokenHeader !== secretToken) {
        console.error('[Yolo] ✗ Unauthorized — token mismatch');
        return c.json({ error: 'Unauthorized' }, 401);
      }
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

    if (kind !== 'merge_request') {
      return c.json({ reason: 'Not a merge_request event', skipped: true });
    }

    const allowedActions = ['open', 'reopen', 'update'];
    if (!allowedActions.includes(action)) {
      return c.json({ reason: `Action '${action}' ignored`, skipped: true });
    }

    if (state !== 'opened') {
      return c.json({ reason: `MR state is '${state}'`, skipped: true });
    }

    console.info(`[Yolo] ✓ Mulai proses review MR !${mrIid}...`);

    const provider: PlatformProvider = new GitLabProvider();

    Promise.resolve()
      .then(() => {
        return handleMergeRequestEvent(payload, provider);
      })
      .catch((err) => {
        console.error('[Yolo] Unhandled error in handler:', err);
      });

    return c.json({ mr_iid: mrIid, received: true });
  }

  return c.json({ error: `Provider '${providerName}' not supported yet` }, 400);
});

const port = parseInt(process.env.PORT ?? '3000', 10);
const hostname = '0.0.0.0';

export default {
  fetch: app.fetch,
  hostname,
  port,
};
