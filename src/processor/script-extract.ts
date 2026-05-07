type ScriptLanguage = 'vue' | 'svelte';

/**
 * Detects <script> block ranges in a Vue or Svelte file.
 * Used internally to isolate logic blocks from UI templates.
 *
 * @param lines - An array containing all lines of the file.
 * @returns An array of [startLine, endLine] tuples representing the 0-indexed line ranges of script blocks.
 */
function detectScriptRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const scriptOpenPattern = /^\s*<script(\s[^>]*)?\s*>/i;
  const scriptClosePattern = /^\s*<\/script>/i;

  let openLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (openLine === null && scriptOpenPattern.test(line)) {
      openLine = i; // inclusive start
    } else if (openLine !== null && scriptClosePattern.test(line)) {
      ranges.push([openLine, i]); // inclusive end
      openLine = null;
    }
  }

  return ranges;
}

/**
 * Extracts <script> blocks from a Vue or Svelte file while maintaining the original line numbers.
 * Lines outside <script> blocks are replaced with empty strings. This ensures that the AI's
 * line number references perfectly map back to the original source file.
 *
 * @param content - The full raw text content of the file.
 * @param _language - The framework language (e.g., 'vue' or 'svelte').
 * @returns The transformed file content containing only script logic.
 */
export function extractScriptWithLinePreserve(content: string, _language: ScriptLanguage): string {
  const lines = content.split('\n');
  const scriptRanges = detectScriptRanges(lines);

  // If no <script> block found, return all blank lines
  // (nothing to review logic-wise)
  if (scriptRanges.length === 0) {
    return lines.map(() => '').join('\n');
  }

  return lines
    .map((line, i) => {
      const inScript = scriptRanges.some(([start, end]) => i >= start && i <= end);
      return inScript ? line : '';
    })
    .join('\n');
}
