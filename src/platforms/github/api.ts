import { App } from 'octokit';
import type {
  DiffFile,
  DiffRefs,
  Discussion,
  PlatformProvider,
  PostDiscussionPayload,
} from '@/platforms/types';

export class GitHubProvider implements PlatformProvider {
  private url: string;
  private fallbackToken?: string;
  private app?: App;

  // Cache installation tokens to avoid fetching every time
  private tokenCache: Map<string, string> = new Map();

  constructor() {
    this.url = process.env.GITHUB_API_URL || 'https://api.github.com';

    if (process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY) {
      this.app = new App({
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      this.fallbackToken = process.env.GITHUB_TOKEN;
      if (!this.fallbackToken) {
        console.warn('[Yolo] ⚠️ No GITHUB_TOKEN or GitHub App credentials provided!');
      }
    }
  }

  private async getToken(projectId: string | number): Promise<string> {
    if (this.app && typeof projectId === 'string') {
      const cacheKey = String(projectId);
      if (this.tokenCache.has(cacheKey)) {
        return this.tokenCache.get(cacheKey)!;
      }

      try {
        const [owner, repo] = projectId.split('/');

        if (!owner || !repo)
          throw new Error('Invalid GitHub projectId format, expected owner/repo');

        // Fetch installation ID dynamically for this repo
        const { data } = await this.app.octokit.request('GET /repos/{owner}/{repo}/installation', {
          owner,
          repo,
        });

        // Get an authenticated octokit instance for this installation
        const installationOctokit = await this.app.getInstallationOctokit(data.id);

        // Extract the token using the internal auth interface
        const auth = (await installationOctokit.auth({ type: 'installation' })) as {
          token: string;
        };

        this.tokenCache.set(cacheKey, auth.token);
        return auth.token;
      } catch (err) {
        console.error(`[Yolo] ❌ Failed to generate GitHub App token for ${projectId}:`, err);
        throw err;
      }
    }
    return this.fallbackToken || '';
  }

  private async headers(projectId: string | number, customAccept?: string) {
    const token = await this.getToken(projectId);
    return {
      Accept: customAccept || 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /**
   * For GitHub, projectId is "owner/repo" and mrIid is the pull request number.
   */
  private baseUrl(projectId: number | string) {
    return `${this.url}/repos/${projectId}`;
  }

  public async getMRDiffs(
    projectId: number | string,
    mrIid: number | string,
  ): Promise<{ diffs: DiffFile[]; diff_refs?: DiffRefs }> {
    // 1. Get PR metadata to extract SHAs (base_sha, head_sha)
    const prUrl = `${this.baseUrl(projectId)}/pulls/${mrIid}`;
    const prRes = await fetch(prUrl, { headers: await this.headers(projectId) });
    if (!prRes.ok) {
      throw new Error(`[GitHub] getMRDiffs (PR info) failed: ${prRes.status}`);
    }
    const prData = (await prRes.json()) as any;

    const diff_refs: DiffRefs = {
      base_sha: prData.base.sha,
      head_sha: prData.head.sha,
      start_sha: prData.base.sha, // GitHub API doesn't strictly separate start_sha from base_sha for this
    };

    // 2. Get PR files with patches
    const filesUrl = `${this.baseUrl(projectId)}/pulls/${mrIid}/files?per_page=100`;
    const filesRes = await fetch(filesUrl, { headers: await this.headers(projectId) });
    if (!filesRes.ok) {
      throw new Error(`[GitHub] getMRDiffs (files) failed: ${filesRes.status}`);
    }
    const filesData = (await filesRes.json()) as any[];

    const diffs: DiffFile[] = filesData.map((file: any) => ({
      deleted_file: file.status === 'removed',
      diff: file.patch || '',
      new_file: file.status === 'added',
      new_path: file.filename,
      old_path: file.previous_filename || file.filename,
      renamed_file: file.status === 'renamed',
    }));

    return { diff_refs, diffs };
  }

  public async getFileContent(
    projectId: number | string,
    filePath: string,
    ref: string,
  ): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const url = `${this.baseUrl(projectId)}/contents/${encodedPath}?ref=${ref}`;
    const res = await fetch(url, { headers: await this.headers(projectId) });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `[GitHub] getFileContent failed for ${filePath}@${ref}: ${res.status} - ${errBody}`,
      );
    }

    const data = (await res.json()) as any;
    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    // In case it's another format or missing encoding
    return data.content || '';
  }

  public async getMRDiscussions(
    projectId: number | string,
    mrIid: number | string,
  ): Promise<Discussion[]> {
    // GitHub handles PR review comments (line-specific) via this endpoint
    const url = `${this.baseUrl(projectId)}/pulls/${mrIid}/comments?per_page=100`;
    const res = await fetch(url, { headers: await this.headers(projectId) });

    if (!res.ok) {
      throw new Error(`[GitHub] getMRDiscussions failed: ${res.status}`);
    }

    const comments = (await res.json()) as any[];

    // We try to map GitHub comments to GitLab's Discussion/Note structure
    // GitHub has in_reply_to_id for threads, but to keep it simple we group by pull_request_review_id or treat each top-level comment as a discussion.
    // For auto-resolving, we actually need the GraphQL node_id, which we map to `id` here.

    return comments.map((comment: any) => ({
      id: comment.node_id, // Store GraphQL node ID for resolution later
      notes: [
        {
          author: { id: comment.user.id, username: comment.user.login },
          body: comment.body,
          id: comment.id,
          position: { new_path: comment.path },
          resolvable: true, // we assume PR review comments are resolvable
        },
      ],
    }));
  }

  public async postDiscussion(
    projectId: number | string,
    mrIid: number | string,
    payload: PostDiscussionPayload,
  ): Promise<boolean> {
    const url = `${this.baseUrl(projectId)}/pulls/${mrIid}/comments`;

    // GitHub's payload structure is different from GitLab
    const githubPayload = {
      body: payload.body,
      commit_id: payload.position.head_sha,
      line: payload.position.new_line,
      path: payload.position.new_path,
    };

    const res = await fetch(url, {
      body: JSON.stringify(githubPayload),
      headers: await this.headers(projectId),
      method: 'POST',
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `[GitHub] postDiscussion failed at line ${payload.position.new_line}: ${res.status} ${errBody}`,
      );
      return false;
    }

    return true;
  }

  public async getSkillFiles(
    projectId: number | string,
    skillsFolderPath: string,
    ref: string,
  ): Promise<string[]> {
    // We use /contents/ API which returns directory listing
    const encodedPath = encodeURIComponent(skillsFolderPath);
    const url = `${this.baseUrl(projectId)}/contents/${encodedPath}?ref=${ref}`;
    const res = await fetch(url, { headers: await this.headers(projectId) });

    if (res.status === 404) {
      return [];
    }

    if (!res.ok) {
      console.warn(`[GitHub] getSkillFiles failed: ${res.status}`);
      return [];
    }

    const items = (await res.json()) as any[];

    if (!Array.isArray(items)) {
      return []; // not a directory
    }

    return items
      .filter((item) => item.type === 'file' && item.name.endsWith('.md'))
      .map((item) => item.path);
  }

  public async resolveDiscussion(
    projectId: number | string,
    _mrIid: number | string,
    discussionId: string, // this is the GraphQL node_id
    resolved: boolean = true,
  ): Promise<void> {
    if (!resolved) {
      console.warn(`[GitHub] Unresolve is not directly supported via simple mutation yet.`);
      return;
    }

    // GitHub requires GraphQL to resolve a PR review thread
    const graphqlUrl = `${this.url}/graphql`;
    const query = `
      mutation ResolveReviewThread($threadId: ID!) {
        resolveReviewThread(input: {threadId: $threadId}) {
          thread {
            isResolved
          }
        }
      }
    `;

    const res = await fetch(graphqlUrl, {
      body: JSON.stringify({
        query,
        variables: { threadId: discussionId },
      }),
      headers: await this.headers(projectId),
      method: 'POST',
    });

    if (!res.ok) {
      console.warn(`[GitHub] Failed to resolve discussion ${discussionId}: ${res.status}`);
    }
  }

  public async postMRNote(
    projectId: number | string,
    mrIid: number | string,
    body: string,
  ): Promise<void> {
    const url = `${this.baseUrl(projectId)}/issues/${mrIid}/comments`;
    const res = await fetch(url, {
      body: JSON.stringify({ body }),
      headers: await this.headers(projectId),
      method: 'POST',
    });

    if (!res.ok) {
      console.error(`[GitHub] Failed to post MR note: ${res.status}`);
    }
  }

  public async getLatestCommitShaForPath(
    projectId: number | string,
    path: string,
    branch: string,
  ): Promise<string | null> {
    const url = `${this.baseUrl(projectId)}/commits?sha=${branch}&path=${encodeURIComponent(path)}&per_page=1`;
    const res = await fetch(url, { headers: await this.headers(projectId) });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    return data[0]?.sha ?? null;
  }
}
