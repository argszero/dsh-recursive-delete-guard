/**
 * The analysis pipeline: a command string plus the tool that will run it, in;
 * the first catastrophic delete, out.
 *
 * The three steps are separated on purpose, because each is a different claim
 * and each is tested on its own:
 *
 *   tokenize.js  how the shell splits this text (dialect-faithful)
 *   verbs.js     whether one resulting segment is a recursive delete
 *   target.js    whether its operand names a root rather than a directory
 *
 * Every step fails open. A command this module cannot split confidently is a
 * command it does not judge, because a guard that guessed would turn its own
 * parse errors into refusals on working commands.
 */

import { classifyTarget, explain, isFatal } from './target.js'
import { splitSegments } from './tokenize.js'
import { deleteTargets, programName, unwrap } from './verbs.js'

/** The dialect each shell tool's command string is written in. */
const DIALECT_BY_TOOL = { bash: 'posix', pwsh: 'powershell' }

/** Dialects that read Windows path syntax, where a leading `\` means the drive root. */
const WINDOWS_DIALECT = new Set(['cmd', 'powershell'])

/** Shells whose `-c` argument is itself a command line. */
const SHELL_WITH_C = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])

/** Nested wrappers we are willing to descend through before giving up. */
const MAX_DEPTH = 4

/**
 * The dialect a tool's `command` argument is written in.
 * @param {string} toolName - the tool that would run the command.
 * @returns {'posix'|'powershell'|undefined} the dialect, or `undefined` if this
 *   tool does not take a shell command string at all.
 */
export function dialectFor(toolName) {
  return DIALECT_BY_TOOL[toolName]
}

/**
 * Walk one shell command line for a catastrophic recursive delete.
 * @param {'posix'|'powershell'|'cmd'} dialect - the shell that parses the text.
 * @param {string} command - the command line.
 * @param {number} depth - how many wrapper levels deep this call is.
 * @returns {{ program: string, target: string, category: string } | null} the first
 *   refusal, or `null` when nothing in the line qualifies.
 */
export function findViolationIn(dialect, command, depth = 0) {
  if (depth > MAX_DEPTH) return null
  const segments = splitSegments(command, dialect)
  if (segments === null) return null
  for (const words of segments) {
    const violation = checkSegment(words, dialect, depth)
    if (violation !== null) return violation
  }
  return null
}

/**
 * Walk a tool call for a catastrophic recursive delete.
 * @param {string} toolName - the tool about to run.
 * @param {string} command - the command text the model wrote.
 * @returns {{ program: string, target: string, category: string } | null} the first
 *   refusal, or `null`.
 */
export function findViolation(toolName, command) {
  const dialect = dialectFor(toolName)
  if (dialect === undefined) return null
  return findViolationIn(dialect, command)
}

/**
 * Judge one simple-command segment, then follow a `cmd /c` or `sh -c` wrapper
 * into the command line it carries.
 * @param {readonly string[]} words - the segment's words.
 * @param {'posix'|'powershell'|'cmd'} dialect - the shell parsing this segment.
 * @param {number} depth - how many wrapper levels deep this segment is.
 * @returns {{ program: string, target: string, category: string } | null} a refusal
 *   or `null`.
 */
function checkSegment(words, dialect, depth) {
  const direct = deleteTargets(words, dialect)
  if (direct !== null) {
    const violation = checkTargets(direct, dialect)
    if (violation !== null) return violation
  }

  const segment = unwrap(words)
  if (segment.length === 0) return null
  const program = programName(segment[0])
  const args = segment.slice(1)

  if (program === 'cmd') {
    const at = args.findIndex((word) => word.toLowerCase() === '/c' || word.toLowerCase() === '/k')
    if (at >= 0) return findViolationIn('cmd', args.slice(at + 1).join(' '), depth + 1)
    return null
  }

  if (SHELL_WITH_C.has(program)) {
    const at = args.findIndex((word) => /^-[a-z]*c$/iu.test(word))
    if (at >= 0) return findViolationIn('posix', args.slice(at + 1).join(' '), depth + 1)
  }

  return null
}

/**
 * Judge the targets of one recognized recursive delete.
 * @param {{ program: string, targets: readonly string[] }} record - the delete and
 *   the operands the shell would hand it.
 * @param {'posix'|'powershell'|'cmd'} dialect - the shell parsing them.
 * @returns {{ program: string, target: string, category: string } | null} a refusal
 *   or `null`.
 */
function checkTargets(record, dialect) {
  const windows = WINDOWS_DIALECT.has(dialect)
  // A recursive delete with nothing to delete is itself a shape to refuse: the
  // operand the shell finally substitutes is not visible, and an empty one is the
  // most dangerous value it can take.
  if (record.targets.length === 0) {
    return { program: record.program, target: '', category: 'empty' }
  }
  for (const target of record.targets) {
    const category = classifyTarget(target, { windows })
    if (isFatal(category)) return { program: record.program, target, category }
  }
  return null
}

/**
 * The model-facing refusal text.
 * @param {{ program: string, target: string, category: string }} violation - one
 *   {@link findViolation} result.
 * @returns {string} the reason handed to the model with the denial.
 */
export function refusalReason(violation) {
  return `Refusing this recursive delete: "${violation.program}" would receive ${explain(violation.category, violation.target)}. `
    + 'A shell does not always hand a delete program the path the command text appears to name. '
    + 'In PowerShell the escape character is a backtick, not a backslash, so a cmd-style \\" inside a '
    + 'PowerShell string ends the string early and the delete program receives a bare "\\" instead — '
    + 'the root of the current drive. Pass the target as a single quoted argument '
    + '(in PowerShell: cmd /c "rd /s /q `"$d`""), verify it first, or delete through a file API instead.'
}
