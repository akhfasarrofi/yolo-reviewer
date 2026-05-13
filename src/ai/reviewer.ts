import { callAI } from '@/ai/chat';
import { getConfig } from '@/config.ts';
import type { PlatformProvider, ReviewComment } from '@/types';

interface SkillsCacheEntry {
  sha: string;
  content: string;
}

const skillsCache = new Map<string, SkillsCacheEntry>();

/**
 * Loads markdown skill rule files from the TARGET branch of the repository.
 * Using the target branch (e.g. main) ensures that .skills/ conventions are always
 * applied from the established base, even when the source branch doesn't have them.
 *
 * @param provider - The Git platform provider interface used to interact with the repository.
 * @param projectId - The unique identifier of the target repository/project.
 * @param targetBranch - The target branch name (e.g. "main") used to fetch skill files.
 * @returns A single concatenated string containing all parsed markdown skill rules.
 */
async function loadSkillRules(
  provider: PlatformProvider,
  projectId: number | string,
  targetBranch: string,
): Promise<string> {
  const cacheKey = `${projectId}:${targetBranch}:skills`;
  const { skillsPath } = getConfig(); // e.g. ".skills"

  // Fetch the latest commit SHA that touched the skills folder (lightweight check)
  const currentSha = await provider.getLatestCommitShaForPath(projectId, skillsPath, targetBranch);

  const cached = skillsCache.get(cacheKey);
  if (cached && cached.sha === currentSha) {
    console.info(`[Yolo] 📦 Skills cache HIT (SHA: ${currentSha?.slice(0, 7)}) — skipping fetch.`);
    return cached.content;
  }

  console.info(`[Yolo] 🔄 Skills cache MISS — fetching .skills/ (SHA changed or first load).`);

  // Fetch list of .md files from TARGET branch — not from head_sha
  const filePaths = await provider.getSkillFiles(projectId, skillsPath, targetBranch);

  if (filePaths.length === 0) {
    skillsCache.set(cacheKey, { content: '', sha: currentSha ?? '' });
    return '';
  }

  const contents = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const content = await provider.getFileContent(projectId, filePath, targetBranch);
        const skillName = filePath.split('/').pop()?.replace('.md', '') ?? filePath;
        return `### ${skillName.toUpperCase()}\n${content}`;
      } catch (err) {
        console.warn(`[Yolo] Gagal memuat skill file ${filePath}:`, err);
        return '';
      }
    }),
  );

  const combined = contents.filter(Boolean).join('\n\n---\n\n');
  skillsCache.set(cacheKey, { content: combined, sha: currentSha ?? '' });
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
  const excludeKeys = ['skillsPath', 'features', 'notifications'];

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
 * @param targetBranch - The target branch name (e.g. "main") used to fetch .skills/ rules.
 * @returns An array of parsed ReviewComment objects, or an empty array if no issues are found or an error occurs.
 */
export async function reviewFile(
  provider: PlatformProvider,
  fileContent: string,
  filePath: string,
  projectId: number | string,
  targetBranch: string,
): Promise<ReviewComment[]> {
  const skillRules = await loadSkillRules(provider, projectId, targetBranch);
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
    throw err;
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
    throw new Error(`JSON parse failed for ${filePath}`);
  }
}
