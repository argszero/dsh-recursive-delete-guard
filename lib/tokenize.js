/**
 * Command tokenizers, one per shell dialect the harness can drive.
 *
 * Why this exists: the command string is the only thing a pre-execution guard
 * sees, and the same text means different things in different shells. The
 * reported incident is exactly that — `cmd /c "rd /s /q \"$d\""` written inside a
 * PowerShell command, where `\"` is not an escape (PowerShell escapes with a
 * backtick), so the string closes early and the delete verb is handed `\`.
 * Measured on PowerShell 7.6.7 with a stand-in `cmd` that prints its argv:
 *
 *   cmd /c "rd /s /q \"$d\""   →  argv[1] = `rd /s /q \`
 *                                 argv[2] = `<the path>\`
 *   cmd /c "rd /s /q `"$d`""   →  argv[1] = `rd /s /q "<the path>"`   (correct)
 *
 * A guard that read the text with the wrong dialect would see the intended path
 * and wave the call through. So the tokenizers below are deliberately small and
 * dialect-faithful, and every one of them gives up (`null`) rather than guess.
 */

/** Characters that separate words in every dialect here. */
const WHITESPACE = new Set([' ', '\t', '\r', '\n'])

/**
 * Split a command line into simple-command segments of words.
 * @param {string} command - the command text exactly as the tool received it.
 * @param {'posix'|'powershell'|'cmd'} dialect - the shell that will parse it.
 * @returns {string[][] | null} one array of words per segment, or `null` when the
 *   text cannot be split confidently (unterminated quote and the like), which the
 *   caller treats as "unknown" and therefore allows.
 */
export function splitSegments(command, dialect) {
  if (typeof command !== 'string') return null
  if (dialect === 'cmd') return cmdSegments(command)
  if (dialect === 'powershell') return powershellSegments(command)
  return posixSegments(command)
}

/**
 * Shared accumulator: turns word/segment bookkeeping into the same shape for all
 * three dialects, so a tokenizer only has to say where words end.
 * @returns the flushing helpers a tokenizer drives.
 */
function collector() {
  const segments = []
  let words = []
  let word = ''
  let started = false
  return {
    /** Append one character to the current word. */
    char(ch) {
      started = true
      word += ch
    },
    /** End the current word, if one is open. */
    endWord() {
      if (started) {
        words.push(word)
        word = ''
        started = false
      }
    },
    /** End the current segment, if it holds any word. */
    endSegment() {
      this.endWord()
      if (words.length > 0) segments.push(words)
      words = []
    },
    /** Whether a word is currently open. */
    get open() {
      return started
    },
    /** The accumulated segments. */
    get result() {
      return segments
    },
  }
}

/**
 * POSIX shell quoting: `'…'` is literal, `"…"` escapes only `$ \` " \ \n`, and a
 * bare backslash escapes the next character.
 * @param {string} command - the command text.
 * @returns {string[][] | null} segments, or `null` on an unterminated quote.
 */
function posixSegments(command) {
  const out = collector()
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (WHITESPACE.has(ch)) {
      out.endWord()
      i += 1
      continue
    }
    // A `#` only starts a comment at the beginning of a word.
    if (ch === '#' && !out.open) {
      while (i < command.length && command[i] !== '\n') i += 1
      continue
    }
    if (ch === "'") {
      i += 1
      const start = i
      while (i < command.length && command[i] !== "'") i += 1
      if (i >= command.length) return null
      for (let k = start; k < i; k += 1) out.char(command[k])
      i += 1
      continue
    }
    if (ch === '"') {
      i += 1
      let closed = false
      while (i < command.length) {
        const c = command[i]
        if (c === '"') {
          closed = true
          i += 1
          break
        }
        if (c === '\\' && i + 1 < command.length && '$`"\\\n'.includes(command[i + 1])) {
          out.char(command[i + 1])
          i += 2
          continue
        }
        out.char(c)
        i += 1
      }
      if (!closed) return null
      continue
    }
    if (ch === '\\') {
      if (i + 1 < command.length) {
        out.char(command[i + 1])
        i += 2
      } else {
        i += 1
      }
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '&' || ch === '|') {
      out.endSegment()
      i += 1
      if (i < command.length && command[i] === ch) i += 1
      continue
    }
    out.char(ch)
    i += 1
  }
  out.endSegment()
  return out.result
}

/**
 * PowerShell argument mode: the escape character is a backtick, `'…'` is literal
 * apart from a doubled `''`, and a bare `$` begins a new argument — which is why
 * the reported command handed the delete verb `\` and the path as two arguments
 * instead of one (measured, see the module comment).
 * @param {string} command - the command text.
 * @returns {string[][] | null} segments, or `null` on an unterminated quote.
 */
function powershellSegments(command) {
  const out = collector()
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (WHITESPACE.has(ch)) {
      out.endWord()
      i += 1
      continue
    }
    if (ch === '`') {
      if (i + 1 < command.length) {
        out.char(command[i + 1])
        i += 2
      } else {
        i += 1
      }
      continue
    }
    if (ch === '"') {
      i += 1
      let closed = false
      while (i < command.length) {
        const c = command[i]
        if (c === '"') {
          closed = true
          i += 1
          break
        }
        if (c === '`' && i + 1 < command.length) {
          out.char(command[i + 1])
          i += 2
          continue
        }
        out.char(c)
        i += 1
      }
      if (!closed) return null
      continue
    }
    if (ch === "'") {
      i += 1
      let closed = false
      while (i < command.length) {
        if (command[i] === "'") {
          if (command[i + 1] === "'") {
            out.char("'")
            i += 2
            continue
          }
          closed = true
          i += 1
          break
        }
        out.char(command[i])
        i += 1
      }
      if (!closed) return null
      continue
    }
    if (ch === '$') {
      // A variable reference is its own argument, next to a quoted string too.
      out.endWord()
      out.char(ch)
      i += 1
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      out.endSegment()
      i += 1
      if (i < command.length && command[i] === ch) i += 1
      continue
    }
    out.char(ch)
    i += 1
  }
  out.endSegment()
  return out.result
}

/**
 * `cmd.exe` quoting: double quotes toggle, `^` escapes the next character, and
 * `&`/`|`/`>` end the command.
 * @param {string} command - the command text.
 * @returns {string[][] | null} segments, or `null` on an unterminated quote.
 */
function cmdSegments(command) {
  const out = collector()
  let quoted = false
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (ch === '"') {
      quoted = !quoted
      i += 1
      continue
    }
    if (!quoted && WHITESPACE.has(ch)) {
      out.endWord()
      i += 1
      continue
    }
    if (!quoted && ch === '^' && i + 1 < command.length) {
      out.char(command[i + 1])
      i += 2
      continue
    }
    if (!quoted && (ch === '&' || ch === '|' || ch === '>' || ch === '<')) {
      out.endSegment()
      i += 1
      if (i < command.length && command[i] === ch) i += 1
      continue
    }
    out.char(ch)
    i += 1
  }
  if (quoted) return null
  out.endSegment()
  return out.result
}
