/**
 * `@argszero/dsh-recursive-delete-guard` — refuse a recursive delete whose
 * operand is a filesystem root instead of a directory.
 *
 * The reported incident (discussion #10569) is not a sandbox bypass. The
 * operator ran with `danger-full-access` and `approval: never`, and the command
 * was meant to remove one project subdirectory. It removed the root of `C:`
 * instead, because the command was written as
 *
 *     cmd /c "rd /s /q \"$d\""
 *
 * inside PowerShell. PowerShell escapes with a backtick; `\"` does not escape,
 * so the string ends at the backslash-quote and the delete verb is handed `\`.
 * Measured on PowerShell 7.6.7 with a stand-in `cmd` that prints its argv, the
 * call arrives as two arguments — `rd /s /q \` and the intended path — and `\`
 * is the root of the current drive. The reporter's own stderr agrees
 * independently: every path it lists is anchored at `\` (`\PROGRA~2`, `\$RECYCLE.BIN`).
 *
 * This plugin reads the command before it runs, in the dialect of the shell that
 * would run it, and denies the call when the operand a delete program would
 * receive is a root, a bare drive letter, a separator relative to the current
 * drive's root, a path that normalizes to its own starting directory, or nothing
 * at all. It does not narrow `danger-full-access` and it does not judge whether
 * a target is inside the workspace: a delete aimed at a real subdirectory passes
 * untouched, wherever that subdirectory lives.
 */

import { findViolation, refusalReason } from './guard.js'

/** Plugin name as the loader sees it. */
export const name = 'recursive-delete-guard'

/** Shell tools whose `command` argument this plugin reads, by default. */
const DEFAULT_TOOLS = ['bash', 'pwsh']

/** The accepted postures. */
const MODES = new Set(['deny', 'off'])

/**
 * Validate the configuration, refusing rather than guessing: a silently
 * defaulted guard would report protection it does not provide.
 * @param {unknown} config - the loader-supplied configuration.
 * @returns {{ mode: 'deny'|'off', tools: readonly string[] }} the normalized settings.
 */
export function normaliseConfig(config) {
  const input = config ?? {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('recursive-delete-guard: config must be an object')
  }
  const mode = input.mode ?? 'deny'
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    throw new TypeError(`recursive-delete-guard: mode must be one of ${[...MODES].join(', ')}, received ${String(mode)}`)
  }
  const tools = input.tools ?? DEFAULT_TOOLS
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== 'string')) {
    throw new TypeError('recursive-delete-guard: tools must be an array of tool names')
  }
  return { mode, tools }
}

/**
 * Judge one pending tool call.
 * @param {{ name?: unknown, arguments?: unknown }} exec - the pending execution.
 * @param {{ tools: readonly string[] }} settings - normalized configuration.
 * @returns {{ program: string, target: string, category: string } | null} the
 *   refusal, or `null` to let the call continue.
 */
export function evaluate(exec, settings) {
  if (typeof exec?.name !== 'string') return null
  if (!settings.tools.includes(exec.name)) return null
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return null
  const command = args.command
  if (typeof command !== 'string') return null
  return findViolation(exec.name, command)
}

/**
 * Mount the guard.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {unknown} config - the loader-supplied configuration.
 * @returns {() => void} the listener's disposer, also registered as an effect.
 */
export function apply(ctx, config) {
  const settings = normaliseConfig(config)
  if (settings.mode === 'off') return () => {}

  const stop = ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      const violation = evaluate(exec, settings)
      if (violation !== null) return { kind: 'deny', reason: refusalReason(violation) }
      return next()
    },
    // Ahead of the other listeners: a root delete must not be executed while an
    // approval or review listener is still deciding.
    { prepend: true },
  )

  ctx.effect(() => stop)
  return stop
}
