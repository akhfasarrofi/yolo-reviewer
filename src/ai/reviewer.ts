import { callAI } from '@/ai/chat';
import { getConfig } from '@/config.ts';
import type { PlatformProvider, ReviewComment } from '@/types';

const skillsCache = new Map<string, string>();

/**
 * Loads markdown skill rule files from the target repository's configured skills directory (.skills/{language}/*.md).
 * Caches the combined rules based on the project ID and commit SHA to prevent redundant API calls.
 *
 * @param provider - The Git platform provider interface used to interact with the repository.
 * @param projectId - The unique identifier of the target repository/project.
 * @param headSha - The commit SHA used to fetch the correct version of the skill files.
 * @returns A single concatenated string containing all parsed markdown skill rules.
 */
async function loadSkillRules(
  provider: PlatformProvider,
  projectId: number | string,
  headSha: string,
): Promise<string> {
  const cacheKey = `${projectId}:${headSha}:skills`;
  const cached = skillsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { skillsPath } = getConfig(); // e.g. ".skills"

  // Fetch list of .md files langsung from .skills/
  const filePaths = await provider.getSkillFiles(projectId, skillsPath, headSha);

  if (filePaths.length === 0) {
    skillsCache.set(cacheKey, '');
    return '';
  }

  const contents = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const content = await provider.getFileContent(projectId, filePath, headSha);
        const skillName = filePath.split('/').pop()?.replace('.md', '') ?? filePath;
        return `### ${skillName.toUpperCase()}\n${content}`;
      } catch (err) {
        console.warn(`[Yolo] Gagal memuat skill file ${filePath}:`, err);
        return '';
      }
    }),
  );

  const combined = contents.filter(Boolean).join('\n\n---\n\n');
  skillsCache.set(cacheKey, combined);
  return combined;
}

/**
 * Constructs the main system instruction prompt for the AI reviewer.
 * It compiles configurations dynamically from config.yml and injects the downloaded skill rules.
 *
 * @param skillRules - The concatenated markdown string of the project's specific review rules.
 * @returns The fully formatted system prompt ready to be sent to the AI.
 */
function buildSystemInstruction(skillRules: string): string {
  const config = getConfig();
  const rules = skillRules.trim() || 'Gunakan standar review umum.';

  // List of keys to exclude from system prompt (engine only)
  const excludeKeys = ['skillsPath', 'features'];

  const lines = Object.entries(config)
    .filter(([key]) => !excludeKeys.includes(key))
    .map(([key, value]) => {
      const header = `## ${key.toUpperCase()}`;

      if (Array.isArray(value)) {
        return `${header}\n${value.map((v) => `- ${v}`).join('\n')}`;
      }

      if (typeof value === 'object' && value !== null) {
        return `${header}\n${JSON.stringify(value, null, 2)}`;
      }

      return `${header}\n${value}`;
    });

  // Inject skill rules manually as it's not in AppConfig
  lines.push(`## SKILL RULES\n${rules}`);

  return lines.join('\n\n');
}

/**
 * Triggers the AI review process for a specific file diff.
 * Coordinates fetching rules, building prompts, communicating with the AI, and parsing the JSON response.
 *
 * @param provider - The Git platform provider interface.
 * @param fileContent - The extracted contextual diff block containing numbered lines.
 * @param filePath - The full path of the file being reviewed.
 * @param projectId - The unique identifier of the repository.
 * @param headSha - The commit SHA of the current merge request head.
 * @returns An array of parsed ReviewComment objects, or an empty array if no issues are found or an error occurs.
 */
export async function reviewFile(
  provider: PlatformProvider,
  fileContent: string,
  filePath: string,
  projectId: number | string,
  headSha: string,
): Promise<ReviewComment[]> {
  const skillRules = await loadSkillRules(provider, projectId, headSha);
  const systemInstruction = buildSystemInstruction(skillRules);

  const userContent = `File: ${filePath}

\`\`\`
${fileContent}
\`\`\``;

  let rawResponse: string;
  try {
    rawResponse = await callAI(systemInstruction, userContent);
  } catch (err) {
    console.error(`[Yolo] AI call gagal untuk ${filePath}:`, err);
    return [];
  }

  // Parse JSON output
  try {
    const cleaned = rawResponse
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();

    const parsed = JSON.parse(cleaned) as { comments: ReviewComment[] };
    return parsed.comments ?? [];
  } catch {
    console.error(`[Yolo] JSON parse gagal untuk ${filePath}. Raw:`, rawResponse.slice(0, 500));
    return [];
  }
}
