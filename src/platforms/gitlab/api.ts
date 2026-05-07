import type {
  DiffFile,
  DiffRefs,
  Discussion,
  PlatformProvider,
  PostDiscussionPayload,
} from '@/platforms/types';

export class GitLabProvider implements PlatformProvider {
  private url: string;
  private token: string;

  constructor() {
    this.url = process.env.GITLAB_URL!;
    this.token = process.env.GITLAB_TOKEN!;
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': this.token,
    };
  }

  private baseUrl(projectId: number | string) {
    return `${this.url}/api/v4/projects/${projectId}`;
  }

  /**
   * Fetches the changes (diffs) and git references for a specific Merge Request.
   * @param projectId - The unique identifier of the target repository.
   * @param mrIid - The internal ID of the Merge Request.
   * @returns An object containing an array of file diffs and the commit SHA references.
   */
  public async getMRDiffs(
    projectId: number | string,
    mrIid: number | string,
  ): Promise<{ diffs: DiffFile[]; diff_refs?: DiffRefs }> {
    const url = `${this.baseUrl(projectId)}/merge_requests/${mrIid}/changes`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(
        `[GitLab] getMRDiffs failed for URL ${url}: ${res.status} ${await res.text()}`,
      );
    }

    const body = (await res.json()) as {
      changes?: DiffFile[];
      diff_refs?: DiffRefs;
    };
    return {
      diff_refs: body.diff_refs,
      diffs: body.changes ?? [],
    };
  }

  /**
   * Retrieves the raw text content of a specific file from the repository at a given commit.
   * @param projectId - The unique identifier of the target repository.
   * @param filePath - The full path of the target file.
   * @param ref - The commit SHA or branch name to read the file from.
   * @returns The raw string content of the file.
   */
  public async getFileContent(
    projectId: number | string,
    filePath: string,
    ref: string,
  ): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const url = `${this.baseUrl(projectId)}/repository/files/${encodedPath}/raw?ref=${ref}`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(`[GitLab] getFileContent failed for ${filePath}@${ref}: ${res.status}`);
    }

    return res.text();
  }

  /**
   * Fetches all existing discussions/threads attached to a specific Merge Request.
   * Useful for checking previously posted comments to avoid spamming duplicates.
   * @param projectId - The unique identifier of the target repository.
   * @param mrIid - The internal ID of the Merge Request.
   * @returns An array of Discussion objects representing all comment threads.
   */
  public async getMRDiscussions(
    projectId: number | string,
    mrIid: number | string,
  ): Promise<Discussion[]> {
    const url = `${this.baseUrl(projectId)}/merge_requests/${mrIid}/discussions?per_page=100`;
    const res = await fetch(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(`[GitLab] getMRDiscussions failed: ${res.status} ${await res.text()}`);
    }

    return res.json() as Promise<Discussion[]>;
  }

  /**
   * Posts a new inline review comment (discussion thread) on a specific line of code in the Merge Request.
   * @param projectId - The unique identifier of the target repository.
   * @param mrIid - The internal ID of the Merge Request.
   * @param payload - Data containing the comment body and the precise file/line position.
   * @returns True if the discussion was successfully posted, false otherwise.
   */
  public async postDiscussion(
    projectId: number | string,
    mrIid: number | string,
    payload: PostDiscussionPayload,
  ): Promise<boolean> {
    const url = `${this.baseUrl(projectId)}/merge_requests/${mrIid}/discussions`;
    const res = await fetch(url, {
      body: JSON.stringify(payload),
      headers: this.headers(),
      method: 'POST',
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `[GitLab] postDiscussion failed at line ${payload.position.new_line}: ${res.status} ${errBody}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Scans the repository's specified folder for markdown (.md) skill configuration files.
   * @param projectId - The unique identifier of the target repository.
   * @param skillsFolderPath - The directory path containing the .md skill files (e.g., '.skills').
   * @param ref - The commit SHA to scan.
   * @returns An array of file paths to the discovered markdown files.
   */
  public async getSkillFiles(
    projectId: number | string,
    skillsFolderPath: string,
    ref: string,
  ): Promise<string[]> {
    const encodedPath = encodeURIComponent(skillsFolderPath);
    const url = `${this.baseUrl(projectId)}/repository/tree?path=${encodedPath}&ref=${ref}&per_page=100`;
    const res = await fetch(url, { headers: this.headers() });

    if (res.status === 404) {
      return [];
    }

    if (!res.ok) {
      console.warn(`[GitLab] getSkillFiles failed for ${skillsFolderPath}@${ref}: ${res.status}`);
      return [];
    }

    const items = (await res.json()) as Array<{
      name: string;
      type: string;
      path: string;
    }>;

    return items
      .filter((item) => item.type === 'blob' && item.name.endsWith('.md'))
      .map((item) => item.path);
  }

  /**
   * Resolves or unresolves an existing discussion thread on a Merge Request.
   * Used to automatically resolve outdated AI feedback if the issue has been fixed in a newer commit.
   * @param projectId - The unique identifier of the target repository.
   * @param mrIid - The internal ID of the Merge Request.
   * @param discussionId - The unique ID of the discussion thread to resolve.
   * @param resolved - Boolean indicating whether to resolve (true) or unresolve (false). Defaults to true.
   */
  public async resolveDiscussion(
    projectId: number | string,
    mrIid: number | string,
    discussionId: string,
    resolved: boolean = true,
  ): Promise<void> {
    const url = `${this.baseUrl(projectId)}/merge_requests/${mrIid}/discussions/${discussionId}`;
    const res = await fetch(url, {
      body: JSON.stringify({ resolved }),
      headers: this.headers(),
      method: 'PUT',
    });

    if (!res.ok) {
      console.warn(`[GitLab] Failed to resolve discussion ${discussionId}: ${res.status}`);
    }
  }

  /**
   * Posts a general note/comment directly to the Merge Request timeline (not tied to a specific line of code).
   * Typically used for posting the summary of the AI review run.
   * @param projectId - The unique identifier of the target repository.
   * @param mrIid - The internal ID of the Merge Request.
   * @param body - The markdown content of the summary note.
   */
  public async postMRNote(
    projectId: number | string,
    mrIid: number | string,
    body: string,
  ): Promise<void> {
    const url = `${this.baseUrl(projectId)}/merge_requests/${mrIid}/notes`;
    const res = await fetch(url, {
      body: JSON.stringify({ body }),
      headers: this.headers(),
      method: 'POST',
    });

    if (!res.ok) {
      console.error(`[GitLab] Failed to post MR note: ${res.status}`);
    }
  }
}
