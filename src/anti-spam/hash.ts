import type { Discussion } from '@/types';

/**
 * Generates a SHA-1 cryptographic hash representing a unique line of code in a specific file.
 * Used for anti-spam: if the file path, line number, and content are the same, the hash remains the same.
 *
 * @param filePath - The path of the file.
 * @param line - The line number in the new file.
 * @param lineContent - The exact string content of the line.
 * @returns The SHA-1 hash as a hex string.
 */
export async function generateHash(
  filePath: string,
  line: number,
  lineContent: string,
): Promise<string> {
  const raw = `${filePath}::${line}::${lineContent.trim()}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const HASH_PREFIX = '<!-- hash:';
export const HASH_SUFFIX = '-->';

/**
 * Embeds the generated cryptographic hash into the AI's review comment body as an invisible HTML comment.
 *
 * @param body - The markdown body of the comment.
 * @param hash - The generated SHA-1 hash string.
 * @returns The comment body with the hidden hash suffix appended.
 */
export function embedHash(body: string, hash: string): string {
  return `${body}\n\n${HASH_PREFIX} ${hash} ${HASH_SUFFIX}`;
}

/**
 * Extracts all previously embedded cryptographic hashes from existing merge request discussions.
 * This allows the system to build a cache of issues already reported, preventing duplicate comments.
 *
 * @param discussions - An array of existing discussion objects from the Git platform.
 * @returns A Set of extracted hash strings.
 */
export function extractExistingHashes(discussions: Discussion[]): Set<string> {
  const existingHashes = new Set<string>();

  for (const discussion of discussions) {
    for (const note of discussion.notes) {
      const match = note.body.match(/<!-- hash: ([a-f0-9]+) -->/);
      if (match?.[1]) {
        existingHashes.add(match[1]);
      }
    }
  }

  return existingHashes;
}
