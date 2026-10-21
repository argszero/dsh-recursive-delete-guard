/**
 * Hand-written types for a package that ships its ESM source directly.
 * `lib/` is the artifact; nothing is compiled.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Plugin name as the loader sees it. */
export declare const name: 'recursive-delete-guard'

/** The posture the guard runs in. */
export type Mode = 'deny' | 'off'

/** Loader configuration. */
export interface Config {
  /** `deny` refuses the call; `off` mounts nothing. Defaults to `deny`. */
  mode?: Mode
  /** Shell tools whose `command` argument is read. Defaults to `['bash', 'pwsh']`. */
  tools?: readonly string[]
}

/** Normalized settings. */
export interface Settings {
  readonly mode: Mode
  readonly tools: readonly string[]
}

/** One refusal. */
export interface Violation {
  /** The delete program, as the shell would invoke it. */
  readonly program: string
  /** The operand the shell would hand that program. */
  readonly target: string
  /** The shape that made the operand fatal. */
  readonly category: string
}

/** Validate the configuration, throwing rather than defaulting silently. */
export declare function normaliseConfig(config: unknown): Settings

/** Judge one pending tool call. */
export declare function evaluate(
  exec: { readonly name?: unknown, readonly arguments?: unknown },
  settings: Settings,
): Violation | null

/** Mount the guard. */
export declare function apply(ctx: Context, config?: Config): () => void
