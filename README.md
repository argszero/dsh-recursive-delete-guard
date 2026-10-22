# @argszero/dsh-recursive-delete-guard

A Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that refuses a **recursive delete whose operand is a filesystem root** rather than a directory.

It exists because of one incident, [discussion #10569](https://github.com/deepseek-ai/deepseek-harness/discussions/10569): a cleanup meant to remove one project subdirectory instead removed the root of `C:` — 48 user files, much of `Program Files` — in 120 seconds, under `danger-full-access` with `approval: never`.

## What actually happened

The command was written as

```powershell
$d = 'C:/Users/<user>/Documents/AI/Moveit/pvkit/projects/v4_wall_full/out/film_blur_frames'
if (Test-Path $d) { cmd /c "rd /s /q \"$d\"" }
```

`\"` is a `cmd.exe` escape. It is not a PowerShell escape — PowerShell escapes with a backtick — so the string ends at that quote and the delete verb is handed `\`, the root of the current drive.

Measured on PowerShell 7.6.7 with a stand-in `cmd` that prints its argv:

| command | argv the delete verb sees |
|---|---|
| `cmd /c "rd /s /q \"$d\""` | `[1] = rd /s /q \`  `[2] = <the path>\` |
| `cmd /c "rd /s /q `"$d`""` | `[1] = rd /s /q "<the path>"` |

The reporter's stderr corroborates it independently: every path it lists is anchored at the drive root (`\PROGRA~2`, `\$RECYCLE.BIN`, `\pagefile.sys`). Nothing in the harness checked the target, because `danger-full-access` means exactly that.

## What this plugin does

Before a tool call is dispatched, it reads the command string, splits it **in the dialect of the shell that would run it**, follows `cmd /c` and `sh -c` wrappers inside it, and denies the call when a recursive delete's operand is one of:

- a filesystem root — `/`, `\`, `//`, `\\`
- a drive root — `C:\`, `C:/`, `C:/*`, `C:\*`
- a bare drive letter — `C:` (the current directory on that drive)
- a separator relative to the current drive's root — `\Users\x` (Windows only)
- a path that normalizes to the directory the command started in — `.`, `..`, `a/..`
- nothing at all — `rm -rf`, `Remove-Item -Recurse`

Everything else passes through untouched.

```
Recursive delete refused: "rd" would receive "the operand "\" is a filesystem root".
A shell does not always hand a delete program the path the command text appears to name. …
```

## What it does not do

- **It is not a sandbox.** A recursive delete aimed at a real subdirectory is allowed, including one outside the workspace: you chose `danger-full-access`, and a plugin that quietly narrowed it would be a different product with a different consent story.
- **It does not build a blocklist of destructive programs.** The set is explicit and small — `rm -r`, `rd|rmdir /s`, `del|erase /s`, `deltree`, and PowerShell's `Remove-Item` with its aliases. `find -delete`, `git clean -fdx`, `shred`, and a language runtime's own delete are out of scope by design.
- **It cannot see an expansion.** `rm -rf "$OUT"` is allowed, because the operand is a variable and the guard does not evaluate one. The reported command *is* caught, because the operand that reaches `rd` is a literal `\` in the command text — but a guard that guessed at variable values would refuse working commands.
- **It fails open.** A command it cannot split confidently — an unterminated quote — is allowed, not guessed at.
- **It is not the upstream fix.** The report's items 1, 2 and 4 belong to the core: validate a destructive target before running it, require confirmation for destructive commands, and make the timeout kill the *process tree*. This plugin is a floor under the worst case.

## Install

```sh
dsh plugin --profile <profile> add github:argszero/dsh-recursive-delete-guard
```

That one command installs the package into the profile and adds it to the
profile's bundle list. A plain `npm i` of the same spec is **inert on its own**:
a bundle becomes a layer only when the profile's `package.json` lists it under
`dsh.profile.bundles` (`packages/boot/app-boot/src/profile.ts`), and the plugin
manager is what writes that list after an install
(`packages/boot/plugin-manager/src/operations.ts`).

Mounted by hand instead:

```yaml
# cordis.yml
plugins:
  '@argszero/dsh-recursive-delete-guard': {}
```

## Configuration

```yaml
plugins:
  '@argszero/dsh-recursive-delete-guard':
    mode: deny      # deny (default) | off
    tools:          # shell tools whose `command` argument is read
      - bash
      - pwsh
```

`mode: off` mounts nothing at all. An unknown `mode`, a non-array `tools`, or a `tools` entry that is not a string throws at mount time — a guard that silently defaulted would report protection it does not provide.

## Verification

```sh
node --test test/*.spec.mjs      # 136 tests
node scripts/inject-defects.mjs  # 30 mutation arms, every one CAUGHT
node scripts/mount-smoke.mjs     # real cordis dispatch, deny and allow both observed
```

The suite pins the measured argv above, so a tokenizer change that stopped reproducing it would fail rather than quietly start agreeing with itself.

## License

MIT.
