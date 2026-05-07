import type { ParsedDiff } from '@/types';

/**
 * Prepends a 1-based line number to every line of a given text block.
 * This ensures the AI can accurately reference specific line numbers in its review comments.
 *
 * @param content - The raw string content of a file.
 * @returns The transformed string where each line starts with its line number (e.g., "1: const x = 1;").
 */
export function addLinePrefix(content: string): string {
  return content
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

/**
 * Parses a raw git diff patch string to identify which specific line numbers were added or modified.
 * It ignores removed lines and context lines, tracking only the lines in the new file version.
 *
 * @param diffContent - The raw git diff patch string.
 * @returns A Set containing the 1-based line numbers of all modified or added lines.
 */
export function parseDiffChangedLines(diffContent: string): Set<number> {
  const changedLines = new Set<number>();
  const lines = diffContent.split('\n');

  let currentNewLine = 0;

  for (const line of lines) {
    // Hunk header, example: @@ -10,7 +10,9 @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1]!, 10) - 1;
      continue;
    }

    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentNewLine++;
      changedLines.add(currentNewLine);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed lines don't increment new file line counter
    } else if (!line.startsWith('---') && !line.startsWith('+++')) {
      // Context line
      currentNewLine++;
    }
  }

  return changedLines;
}

/**
 * A convenience wrapper that combines a file path with its parsed changed lines.
 *
 * @param filePath - The path of the file being processed.
 * @param diffContent - The raw git diff patch string.
 * @returns A ParsedDiff object containing the file path and the Set of changed line numbers.
 */
export function buildParsedDiff(filePath: string, diffContent: string): ParsedDiff {
  return {
    changedLines: parseDiffChangedLines(diffContent),
    filePath,
  };
}

/**
 * Extracts a condensed version of the file content, including only the modified lines and a specified number
 * of surrounding context lines. Non-relevant lines are replaced with "..." separators.
 * This significantly reduces the token payload sent to the AI while preserving semantic context.
 *
 * @param numberedLines - An array of file lines that have already been prefixed with line numbers.
 * @param changedLines - A Set of line numbers representing the modified lines.
 * @param contextSize - The number of unmodified lines to include above and below each modified line. Defaults to 5.
 * @returns The condensed file content string ready for AI analysis.
 */
export function extractDiffContext(
  numberedLines: string[],
  changedLines: Set<number>,
  contextSize = 5,
): string {
  if (changedLines.size === 0) return numberedLines.join('\n');

  const included = new Set<number>();
  for (const line of changedLines) {
    for (let i = line - contextSize; i <= line + contextSize; i++) {
      if (i >= 1 && i <= numberedLines.length) {
        included.add(i);
      }
    }
  }

  const sortedLines = [...included].sort((a, b) => a - b);
  const result: string[] = [];
  let prev = -1;

  for (const lineNum of sortedLines) {
    if (prev !== -1 && lineNum > prev + 1) {
      result.push('...');
    }
    result.push(numberedLines[lineNum - 1]!);
    prev = lineNum;
  }

  return result.join('\n');
}
