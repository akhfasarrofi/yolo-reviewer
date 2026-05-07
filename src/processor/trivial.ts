/**
 * Parses the diff string and evaluates whether the changes made are trivial.
 * Trivial changes include empty lines, pure comments, or formatting changes that do not affect logic.
 *
 * @param diffContent - The raw git diff patch string.
 * @returns True if the changes are deemed trivial and should be ignored, false otherwise.
 */
export function isTrivialChange(diffContent: string): boolean {
  const lines = diffContent.split('\n');

  // get only added/removed lines (+ or -)
  const changedLines = lines.filter(
    (line) =>
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---'),
  );

  if (changedLines.length === 0) return true;

  for (const line of changedLines) {
    // Strip prefix + or -
    const content = line.slice(1);

    // Normalize whitespace
    const normalized = content.trim();

    if (normalized === '') continue;

    if (normalized.startsWith('//') || normalized.startsWith('*') || normalized.startsWith('/*')) {
      continue;
    }

    if (normalized.length > 0) {
      return false;
    }
  }

  return true;
}

/**
 * An aggressive comparison that evaluates if a diff consists entirely of whitespace modifications.
 * It compares added lines and removed lines after stripping all whitespaces.
 *
 * @param diffContent - The raw git diff patch string.
 * @returns True if the substantive content remains exactly the same (only spacing changed), false otherwise.
 */
export function isWhitespaceOnlyChange(diffContent: string): boolean {
  const lines = diffContent.split('\n');

  const added = lines
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).replace(/\s/g, ''));

  const removed = lines
    .filter((l) => l.startsWith('-') && !l.startsWith('---'))
    .map((l) => l.slice(1).replace(/\s/g, ''));

  const addedStr = added.join('');
  const removedStr = removed.join('');

  return addedStr === removedStr;
}
