/**
 * Which invocations in a segment are destructive deletes, and what they target.
 *
 * The set is deliberately small and verb-explicit: a guard that tried to know
 * every destructive program would be a blocklist that is wrong the moment a new
 * one ships. These are the three families the reported incident and the ordinary
 * cleanup command belong to, split by the dialect that will parse them:
 *
 *   POSIX       rm -r / -R / --recursive
 *   cmd.exe     rd|rmdir /s, del|erase /s, deltree
 *   PowerShell  Remove-Item and its aliases (ri, rm, del, erase, rd, rmdir) with
 *               -Recurse, plus cmd-style /s, because a user who writes `/s` in
 *               PowerShell means a recursive delete and PowerShell will pass it
 *               through as a path operand instead.
 *
 * Anything else — `find -delete`, `git clean`, `shred`, a language runtime's own
 * delete — is out of scope by design and the README says so.
 */

/** POSIX programs whose recursion flag makes them destructive. */
const POSIX_DELETE = new Set(['rm'])

/** `cmd.exe` built-ins that delete. */
const CMD_DELETE = new Set(['rd', 'rmdir', 'del', 'erase', 'deltree'])

/** PowerShell's `Remove-Item` and every alias that reaches it. */
const PWSH_DELETE = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'])

/** Prefix programs that do not change which program actually runs. */
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'exec', 'nohup', 'time', 'busybox', 'xargs'])

/**
 * The program name a word invokes, without its directory or a Windows suffix.
 * @param {string} word - one shell word.
 * @returns {string} the lower-cased basename.
 */
export function programName(word) {
  const tail = word.split(/[\\/]/).at(-1) ?? ''
  return tail.replace(/\.(exe|com|cmd|bat)$/iu, '').toLowerCase()
}

/**
 * Drop leading wrappers and `NAME=value` assignments so the real program is first.
 * @param {readonly string[]} words - one segment's words.
 * @returns {readonly string[]} the segment from its real program onward.
 */
export function unwrap(words) {
  let i = 0
  while (i < words.length) {
    const word = words[i]
    if (WRAPPERS.has(programName(word))) {
      i += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) {
      i += 1
      continue
    }
    break
  }
  return words.slice(i)
}

/**
 * The switch-shaped words of one segment.
 * @param {readonly string[]} args - the words after the program name.
 * @returns {readonly string[]} words that are switches, not operands.
 */
function switches(args) {
  return args.filter((word) => word.startsWith('-') || /^\/[A-Za-z]$/u.test(word))
}

/**
 * The operands of one segment: everything that is not a switch.
 * @param {readonly string[]} args - the words after the program name.
 * @returns {readonly string[]} candidate delete targets.
 */
function operands(args) {
  const out = []
  let literal = false
  for (const word of args) {
    if (!literal && word === '--') {
      literal = true
      continue
    }
    if (!literal && (word.startsWith('-') || /^\/[A-Za-z]$/u.test(word))) continue
    out.push(word)
  }
  return out
}

/**
 * Find the delete targets of one segment, when that segment is a recursive delete.
 * @param {readonly string[]} words - one segment's words, wrappers included.
 * @param {'posix'|'powershell'|'cmd'} dialect - the shell parsing this segment.
 * @returns {{ program: string, targets: string[] } | null} the program and its
 *   targets, or `null` when the segment deletes nothing recursively.
 */
export function deleteTargets(words, dialect) {
  const segment = unwrap(words)
  if (segment.length === 0) return null
  const program = programName(segment[0])
  const args = segment.slice(1)

  if (dialect === 'cmd') {
    if (!CMD_DELETE.has(program)) return null
    const switchesHere = switches(args).map((word) => word.toLowerCase())
    const recursive = switchesHere.includes('/s') || program === 'deltree'
    if (!recursive) return null
    return { program, targets: operands(args) }
  }

  if (dialect === 'powershell') {
    if (!PWSH_DELETE.has(program)) return null
    const switchesHere = switches(args).map((word) => word.toLowerCase())
    const recursive = switchesHere.includes('-recurse') || switchesHere.includes('-r') || switchesHere.includes('/s')
    if (!recursive) return null
    return { program, targets: operands(args) }
  }

  if (!POSIX_DELETE.has(program)) return null
  const switchesHere = switches(args).map((word) => word.toLowerCase())
  // `-r`, `-R`, `-rf`, `-fr`, `-r -f` and `--recursive` all mean the same thing here.
  const recursive = switchesHere.some((word) => word === '--recursive' || /^-[^-]*[rR]/u.test(word))
  if (!recursive) return null
  return { program, targets: operands(args) }
}
