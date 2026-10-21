/**
 * Classify one delete operand: where does this path actually land?
 *
 * Only catastrophic shapes are named. A target that merely sits outside the
 * workspace is a policy question this plugin refuses to answer — the operator
 * chose `danger-full-access`, and a guard that quietly narrowed it would be a
 * different product with a different consent story. What it does refuse is the
 * set of targets whose meaning is "everywhere": a filesystem root, a drive
 * root, a bare drive letter, a separator relative to the current drive's root,
 * a path that normalizes to the directory it started in, or an empty operand.
 */

/** Categories that name a target bigger than any directory a caller meant. */
const FATAL = new Set(['empty', 'root', 'drive', 'drive-relative', 'relative-root'])

/**
 * @param {string} word - one already-unquoted delete operand.
 * @param {{ windows?: boolean }} [options] - whether to read Windows path syntax.
 * @returns {'empty'|'root'|'drive'|'drive-relative'|'relative-root'|'scoped-glob'|'safe'}
 *   the shape of the target.
 */
export function classifyTarget(word, options = {}) {
  const windows = options.windows === true
  const text = typeof word === 'string' ? word.trim() : ''
  if (text === '') return 'empty'

  // One or more separators and nothing else: the root of wherever we are.
  if (/^[\\/]+$/u.test(text)) return 'root'
  // A bare drive letter means "the current directory on that drive".
  if (/^[A-Za-z]:$/u.test(text)) return 'drive'
  // A drive root, with or without a trailing separator.
  if (/^[A-Za-z]:[\\/]+$/u.test(text)) return 'root'
  // A glob rooted at a drive: `C:\*`, `C:/*`, `C:\*\*`.
  if (/^[A-Za-z]:[\\/]+\*([\\/]+\*)*$/u.test(text)) return 'root'
  // A glob rooted at a separator: `/*`.
  if (/^[\\/]+\*([\\/]+\*)*$/u.test(text)) return 'root'

  // Everything in the current directory is scoped to the shell's own cwd.
  if (text === '*' || text === '*.*' || text === './*' || text === '.\\*') return 'scoped-glob'

  if (windows) {
    // A UNC share names a place; it is not a root.
    if (/^[\\/]{2}[^\\/]/u.test(text)) return 'safe'
    // A single leading separator is relative to the current drive's root, so the
    // same text deletes a different tree depending on where the shell started.
    if (/^[\\/]/u.test(text)) return 'drive-relative'
  }

  // Normalize `.` and `..` and see where the path lands.
  const parts = []
  for (const part of text.split(/[\\/]+/u)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  // `.`, `..`, `a/..` and `./` all collapse to the starting directory.
  if (parts.length === 0) return 'relative-root'
  return 'safe'
}

/**
 * Whether a category is one this plugin refuses.
 * @param {string} category - a {@link classifyTarget} result.
 * @returns {boolean} true when the target is bigger than any directory meant.
 */
export function isFatal(category) {
  return FATAL.has(category)
}

/**
 * The operator-facing explanation of one refusal.
 * @param {string} category - a {@link classifyTarget} result.
 * @param {string} target - the operand as the shell would hand it over.
 * @returns {string} one English sentence naming what the operand means.
 */
export function explain(category, target) {
  const shown = JSON.stringify(target)
  switch (category) {
    case 'empty':
      return `the delete program would receive no path at all`
    case 'root':
      return `the operand ${shown} is a filesystem root`
    case 'drive':
      return `the operand ${shown} is a bare drive letter, which deletes the current directory on that drive`
    case 'drive-relative':
      return `the operand ${shown} is relative to the current drive's root, so it deletes a different tree depending on where the shell started`
    case 'relative-root':
      return `the operand ${shown} normalizes to the directory the command started in`
    default:
      return `the operand ${shown} is not a path this plugin recognizes`
  }
}
