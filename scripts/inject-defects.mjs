/**
 * Mutation harness for the guard's own rules.
 *
 * Every arm breaks one rule in the shipped source, runs the real suite, and
 * expects it to go red. Two readings matter and both are counted separately:
 *
 *   CAUGHT    the suite failed — the tests really do exercise that rule
 *   SURVIVED  the suite stayed green — the rule is untested, and the arm says so
 *   NO-OP     the anchor was not found — the arm never ran, which is not a pass
 *
 * Before any arm runs, the unmutated tree is put through the same suite and must
 * come back green. Without that control a detector that always reports "caught"
 * would look perfect; with it, the control is the thing that has to go red first.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUITE = ['--test', 'test/tokenize.spec.mjs', 'test/target.spec.mjs', 'test/guard.spec.mjs', 'test/plugin.spec.mjs', 'test/packaging.spec.mjs']
const NODE = process.execPath

/** Run the suite; true when every test passed. */
function suitePasses() {
  try {
    execFileSync(NODE, SUITE, { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * One arm: a precise edit of one shipped rule, plus what it should break.
 * `find` must appear exactly once, or the arm is a NO-OP and says so.
 */
const ARMS = [
  {
    id: 'powershell: a bare $ does not start a new argument',
    file: 'lib/tokenize.js',
    find: "    if (ch === '$') {\n      // A variable reference is its own argument, next to a quoted string too.\n      out.endWord()\n      out.char(ch)",
    replace: "    if (ch === '$') {\n      out.char(ch)",
  },
  {
    id: 'powershell: the backtick stops escaping inside a quoted string',
    file: 'lib/tokenize.js',
    find: "        if (c === '`' && i + 1 < command.length) {\n          out.char(command[i + 1])\n          i += 2\n          continue\n        }",
    replace: "        if (c === '\\u0000') {\n          out.char(command[i + 1])\n          i += 2\n          continue\n        }",
  },
  {
    id: 'posix: a backslash stops escaping outside quotes',
    file: 'lib/tokenize.js',
    find: "    if (ch === '\\\\') {\n      if (i + 1 < command.length) {\n        out.char(command[i + 1])\n        i += 2",
    replace: "    if (ch === '\\u0000') {\n      if (i + 1 < command.length) {\n        out.char(command[i + 1])\n        i += 2",
  },
  {
    id: 'posix: single quotes stop being literal',
    file: 'lib/tokenize.js',
    find: "    if (ch === \"'\") {\n      i += 1\n      const start = i",
    replace: "    if (ch === '\\u0000') {\n      i += 1\n      const start = i",
  },
  {
    id: 'cmd: the caret stops escaping',
    file: 'lib/tokenize.js',
    find: "    if (!quoted && ch === '^' && i + 1 < command.length) {",
    replace: "    if (!quoted && ch === '\\u0000' && i + 1 < command.length) {",
  },
  {
    id: 'target: a bare separator stops reading as a root',
    file: 'lib/target.js',
    find: "  if (/^[\\\\/]+$/u.test(text)) return 'root'",
    replace: "  if (/^\\u0000$/u.test(text)) return 'root'",
  },
  {
    id: 'target: a drive root stops reading as a root',
    file: 'lib/target.js',
    find: "  if (/^[A-Za-z]:[\\\\/]+$/u.test(text)) return 'root'",
    replace: "  if (/^\\u0000$/u.test(text)) return 'root'",
  },
  {
    id: 'target: a bare drive letter stops reading as a drive',
    file: 'lib/target.js',
    find: "  if (/^[A-Za-z]:$/u.test(text)) return 'drive'",
    replace: "  if (/^\\u0000$/u.test(text)) return 'drive'",
  },
  {
    id: 'target: a root glob stops reading as a root',
    file: 'lib/target.js',
    find: "  if (/^[\\\\/]+\\*([\\\\/]+\\*)*$/u.test(text)) return 'root'",
    replace: "  if (/^\\u0000$/u.test(text)) return 'root'",
  },
  {
    id: 'target: a leading separator stops reading as drive-relative',
    file: 'lib/target.js',
    find: "    if (/^[\\\\/]/u.test(text)) return 'drive-relative'",
    replace: "    if (/^\\u0000/u.test(text)) return 'drive-relative'",
  },
  {
    id: 'target: a UNC path stops being exempt',
    file: 'lib/target.js',
    find: "    if (/^[\\\\/]{2}[^\\\\/]/u.test(text)) return 'safe'",
    replace: "    if (/^\\u0000/u.test(text)) return 'safe'",
  },
  {
    id: 'target: everything in the working directory stops being scoped',
    file: 'lib/target.js',
    find: "  if (text === '*' || text === '*.*' || text === './*' || text === '.\\\\*') return 'scoped-glob'",
    replace: "  if (text === '\\u0000') return 'scoped-glob'",
  },
  {
    id: 'target: an empty operand stops reading as empty',
    file: 'lib/target.js',
    find: "  if (text === '') return 'empty'",
    replace: "  if (text === '\\u0000') return 'empty'",
  },
  {
    id: 'target: a path that normalizes to its own start stops being fatal',
    file: 'lib/target.js',
    find: "  if (parts.length === 0) return 'relative-root'",
    replace: "  if (parts.length === 0) return 'safe'",
  },
  {
    id: 'target: the Windows reading is inverted',
    file: 'lib/target.js',
    find: "  const windows = options.windows === true",
    replace: "  const windows = options.windows !== true",
  },
  {
    id: 'target: the fatal set stops containing roots',
    file: 'lib/target.js',
    find: "const FATAL = new Set(['empty', 'root', 'drive', 'drive-relative', 'relative-root'])",
    replace: "const FATAL = new Set(['empty'])",
  },
  {
    id: 'verbs: a non-recursive rm stops being non-recursive',
    file: 'lib/verbs.js',
    find: "  const recursive = switchesHere.some((word) => word === '--recursive' || /^-[^-]*[rR]/u.test(word))",
    replace: "  const recursive = switchesHere.length >= 0",
  },
  {
    id: 'verbs: a recursive rm stops being detected',
    file: 'lib/verbs.js',
    find: "  const recursive = switchesHere.some((word) => word === '--recursive' || /^-[^-]*[rR]/u.test(word))",
    replace: "  const recursive = false",
  },
  {
    id: 'verbs: cmd /s stops being required',
    file: 'lib/verbs.js',
    find: "    const recursive = switchesHere.includes('/s') || program === 'deltree'",
    replace: "    const recursive = true",
  },
  {
    id: 'verbs: PowerShell -Recurse stops being read',
    file: 'lib/verbs.js',
    find: "    const recursive = switchesHere.includes('-recurse') || switchesHere.includes('-r') || switchesHere.includes('/s')",
    replace: "    const recursive = switchesHere.includes('/s')",
  },
  {
    id: 'verbs: switches stop being filtered out of the operands',
    file: 'lib/verbs.js',
    find: "    if (!literal && (word.startsWith('-') || /^\\/[A-Za-z]$/u.test(word))) continue",
    replace: "    if (!literal && word === '\\u0000') continue",
  },
  {
    id: 'verbs: wrappers stop being unwrapped',
    file: 'lib/verbs.js',
    find: "    if (WRAPPERS.has(programName(word))) {",
    replace: "    if (programName(word) === '\\u0000') {",
  },
  {
    id: 'guard: a recursive delete with no operand stops being refused',
    file: 'lib/guard.js',
    find: "  if (record.targets.length === 0) {",
    replace: "  if (record.targets.length === -1) {",
  },
  {
    id: 'guard: a cmd /c wrapper stops being followed',
    file: 'lib/guard.js',
    find: "    if (at >= 0) return findViolationIn('cmd', args.slice(at + 1).join(' '), depth + 1)",
    replace: "    if (at < 0) return findViolationIn('cmd', args.slice(at + 1).join(' '), depth + 1)",
  },
  {
    id: 'guard: a sh -c wrapper stops being followed',
    file: 'lib/guard.js',
    find: "    if (at >= 0) return findViolationIn('posix', args.slice(at + 1).join(' '), depth + 1)",
    replace: "    if (at < 0) return findViolationIn('posix', args.slice(at + 1).join(' '), depth + 1)",
  },
  {
    id: 'guard: the reason stops naming the escaping hazard',
    file: 'lib/guard.js',
    find: "    + 'In PowerShell the escape character is a backtick, not a backslash, so a cmd-style \\\\\" inside a '",
    replace: "    + 'A guard stopped this. '",
  },
  {
    id: 'index: the listener stops being prepended',
    file: 'lib/index.js',
    find: "    { prepend: true },",
    replace: "    { prepend: false },",
  },
  {
    id: 'index: mode off stops being honoured',
    file: 'lib/index.js',
    find: "  if (settings.mode === 'off') return () => {}",
    replace: "  if (settings.mode === 'never') return () => {}",
  },
  {
    id: 'index: an unknown mode stops throwing',
    file: 'lib/index.js',
    find: "  if (typeof mode !== 'string' || !MODES.has(mode)) {",
    replace: "  if (typeof mode === 'number') {",
  },
  {
    id: 'index: the configured tool list stops being honoured',
    file: 'lib/index.js',
    find: "  if (!settings.tools.includes(exec.name)) return null",
    replace: "  if (settings.tools.length < 0) return null",
  },
]

/** Apply one arm, run the suite, restore, and report what happened. */
function runArm(arm) {
  const path = join(ROOT, arm.file)
  const original = readFileSync(path, 'utf8')
  const occurrences = original.split(arm.find).length - 1
  if (occurrences !== 1) {
    return { status: 'NO-OP', detail: `anchor found ${occurrences} times` }
  }
  writeFileSync(path, original.replace(arm.find, arm.replace))
  try {
    return suitePasses() ? { status: 'SURVIVED' } : { status: 'CAUGHT' }
  } finally {
    writeFileSync(path, original)
  }
}

console.log('control: running the suite unmutated…')
if (!suitePasses()) {
  console.error('control: the unmutated suite is already red — no arm below would mean anything.')
  process.exit(1)
}
console.log('control: green, zero captures. Arms mean something from here.\n')

const tally = { CAUGHT: 0, SURVIVED: 0, 'NO-OP': 0 }
const failures = []

for (const arm of ARMS) {
  const { status, detail } = runArm(arm)
  tally[status] += 1
  const note = detail === undefined ? '' : `  (${detail})`
  console.log(`${status.padEnd(8)} ${arm.id}${note}`)
  if (status !== 'CAUGHT') failures.push(`${status}: ${arm.id}${note}`)
}

console.log(`\n${ARMS.length} arms — ${tally.CAUGHT} CAUGHT, ${tally.SURVIVED} SURVIVED, ${tally['NO-OP']} NO-OP`)
if (failures.length > 0) {
  console.error('\nEvery arm must be CAUGHT:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
