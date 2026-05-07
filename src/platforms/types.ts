export interface DiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface DiffFile {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

export interface DiscussionNote {
  id: number | string;
  body: string;
  author: { id: number | string; username: string };
  resolvable?: boolean;
  resolved?: boolean;
  position?: {
    new_path?: string;
  };
}

export interface Discussion {
  id: string;
  notes: DiscussionNote[];
}

export interface PostDiscussionPayload {
  body: string;
  position: {
    position_type: 'text';
    base_sha: string;
    start_sha: string;
    head_sha: string;
    new_path: string;
    new_line: number;
  };
}

export interface PlatformProvider {
  getMRDiffs(
    projectId: number | string,
    mrIid: number | string,
  ): Promise<{ diffs: DiffFile[]; diff_refs?: DiffRefs }>;

  getFileContent(projectId: number | string, filePath: string, ref: string): Promise<string>;

  getMRDiscussions(projectId: number | string, mrIid: number | string): Promise<Discussion[]>;

  postDiscussion(
    projectId: number | string,
    mrIid: number | string,
    payload: PostDiscussionPayload,
  ): Promise<boolean>;

  getSkillFiles(
    projectId: number | string,
    skillsFolderPath: string,
    ref: string,
  ): Promise<string[]>;

  resolveDiscussion(
    projectId: number | string,
    mrIid: number | string,
    discussionId: string,
    resolved?: boolean,
  ): Promise<void>;

  postMRNote(projectId: number | string, mrIid: number | string, body: string): Promise<void>;
}
