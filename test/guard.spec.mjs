import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findViolation, findViolationIn, refusalReason } from '../lib/guard.js'

/** The command exactly as the reporter's model wrote it, inside a pwsh call. */
const REPORTED = 'cmd /c "rd /s /q \\"$d\\""'

describe('the reported command', () => {
  it('is refused, and names the operand that actually reaches rd', () => {
    assert.deepEqual(findViolation('pwsh', REPORTED), {
      program: 'rd',
      target: '\\',
      category: 'root',
    })
  })

  it('refuses the same text whatever the variable holds', () => {
    // The write-up checked this with the variable bound to the real path and again
    // with it empty: the command text is identical, and the delete verb is handed
    // a bare backslash either way.
    assert.deepEqual(findViolation('pwsh', REPORTED), findViolation('pwsh', REPORTED))
    assert.equal(findViolation('pwsh', REPORTED).target, '\\')
  })

  it('is allowed once the quoting is PowerShell dialect', () => {
    assert.equal(findViolation('pwsh', 'cmd /c "rd /s /q `"$d`""'), null)
  })

  it('carries a reason that names the escaping hazard', () => {
    const reason = refusalReason(findViolation('pwsh', REPORTED))
    assert.match(reason, /backtick/u)
    assert.match(reason, /root of the current drive/u)
  })
})

describe('posix recursive deletes', () => {
  const denied = [
    ['rm -rf /', '/'],
    // POSIX reads a trailing backslash as a line continuation, so the operand is
    // genuinely empty — still refused, under a different name.
    ['rm -rf \\', ''],
    ['rm -rf //', '//'],
    ['rm -rf ..', '..'],
    ['rm -rf .', '.'],
    ['rm -rf "a/.."', 'a/..'],
    ['sudo rm -rf /', '/'],
    ['rm -r /', '/'],
    ['rm -fr /', '/'],
    ['rm --recursive /', '/'],
    ['rm -rf', ''],
    ['rm -rf dist && rm -rf /', '/'],
    ['bash -c "rm -rf /"', '/'],
    ['sh -lc "rm -rf /"', '/'],
    ['/bin/rm -rf /', '/'],
    ['FOO=1 rm -rf /', '/'],
  ]

  for (const [command, target] of denied) {
    it(`refuses ${JSON.stringify(command)}`, () => {
      const violation = findViolation('bash', command)
      assert.notEqual(violation, null, command)
      assert.equal(violation.target, target)
    })
  }

  const allowed = [
    'rm -rf ./dist',
    'rm -rf dist',
    'rm -rf node_modules build .next',
    'rm -rf /tmp/build',
    'rm -rf "$OUT"',
    'rm -rf ${BUILD_DIR}/x',
    'rm -rf *',
    'rm -rf ./*',
    'rm -rf ~/scratch',
    'rm -f file.txt',
    'rm file.txt',
    'rm -rf dist && npm run build',
    'git clean -fdx',
    'find . -name "*.o" -delete',
    'npm run clean',
    'echo rm -rf /',
    'grep -r "rm -rf /" docs/',
  ]

  for (const command of allowed) {
    it(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(findViolation('bash', command), null, command)
    })
  }
})

describe('cmd recursive deletes', () => {
  const denied = [
    ['rd /s /q \\', '\\'],
    ['rd /s /q /', '/'],
    ['rd /s /q C:\\', 'C:\\'],
    ['rd /s /q C:', 'C:'],
    ['del /s /q C:\\*', 'C:\\*'],
    ['rmdir /s /q \\', '\\'],
    ['deltree \\', '\\'],
  ]

  for (const [command, target] of denied) {
    it(`refuses ${JSON.stringify(command)} through cmd`, () => {
      const violation = findViolation('pwsh', `cmd /c "${command}"`)
      assert.notEqual(violation, null, command)
      assert.equal(violation.target, target)
    })
  }

  const allowed = [
    'rd /s /q C:\\Users\\x\\out',
    'rd /s /q "C:\\Users\\x\\out"',
    'del /s /q build',
    'rmdir /s /q .\\dist',
  ]

  for (const command of allowed) {
    it(`allows ${JSON.stringify(command)} through cmd`, () => {
      assert.equal(findViolation('pwsh', `cmd /c "${command}"`), null, command)
    })
  }
})

describe('powershell deletes', () => {
  const denied = [
    ['Remove-Item -Recurse -Force C:\\', 'C:\\'],
    ['Remove-Item -Recurse -Force /', '/'],
    ['Remove-Item -Recurse -Force \\', '\\'],
    ['Remove-Item -Recurse -Force C:', 'C:'],
    ['Remove-Item -Recurse -Force ..', '..'],
    ['rm -Recurse -Force C:\\', 'C:\\'],
    ['ri -r -fo C:\\', 'C:\\'],
    ['Remove-Item -Recurse', ''],
  ]

  for (const [command, target] of denied) {
    it(`refuses ${JSON.stringify(command)}`, () => {
      const violation = findViolation('pwsh', command)
      assert.notEqual(violation, null, command)
      assert.equal(violation.target, target)
    })
  }

  const allowed = [
    'Remove-Item -Recurse -Force .\\dist',
    'Remove-Item -Recurse -Force C:\\Users\\x\\out',
    'Remove-Item -Recurse -Force *',
    'Remove-Item -Recurse -Force $d',
    'Remove-Item foo.txt',
    'Get-ChildItem -Recurse',
    'Write-Host "Remove-Item -Recurse C:\\"',
  ]

  for (const command of allowed) {
    it(`allows ${JSON.stringify(command)}`, () => {
      assert.equal(findViolation('pwsh', command), null, command)
    })
  }
})

describe('non-recursive deletes are not this guard\'s business', () => {
  // A delete without the recursion flag cannot walk a tree, so refusing one is a
  // false positive. These pin that boundary: without them a mutation that treated
  // every delete as recursive would still pass every other test in this file.
  it('allows a non-recursive rm even at a root', () => {
    assert.equal(findViolation('bash', 'rm -f /'), null)
    assert.equal(findViolation('bash', 'rm /'), null)
    assert.equal(findViolation('bash', 'rm -f /tmp/x'), null)
  })

  it('allows a cmd delete without /s even at a drive root', () => {
    assert.equal(findViolationIn('cmd', 'rd /q C:\\'), null)
    assert.equal(findViolationIn('cmd', 'del /q build'), null)
  })

  it('allows a PowerShell delete without -Recurse', () => {
    assert.equal(findViolation('pwsh', 'Remove-Item -Force C:\\'), null)
    assert.equal(findViolation('pwsh', 'Remove-Item C:\\'), null)
  })
})

describe('scope of the guard', () => {
  it('ignores tools that do not carry a command string', () => {
    assert.equal(findViolation('read', 'rm -rf /'), null)
    assert.equal(findViolation('terminal_spawn', 'rm -rf /'), null)
  })

  it('fails open on text it cannot split', () => {
    assert.equal(findViolation('bash', "rm -rf 'unterminated"), null)
    assert.equal(findViolation('pwsh', 'cmd /c "rd /s /q unterminated'), null)
  })

  it('stops descending after a bounded number of wrappers', () => {
    const nested = `${'bash -c "'.repeat(6)}rm -rf /${'"'.repeat(6)}`
    // Either it finds it inside the budget or it declines to judge; it never throws.
    assert.doesNotThrow(() => findViolation('bash', nested))
  })

  it('does not read a non-recursive delete as destructive', () => {
    assert.equal(findViolation('bash', 'rm -fx dist'), null)
    assert.equal(findViolation('bash', 'rm --force dist'), null)
  })
})
