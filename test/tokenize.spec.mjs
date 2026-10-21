import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { splitSegments } from '../lib/tokenize.js'

describe('powershell dialect', () => {
  it('reproduces the measured argv of the reported command', () => {
    // Measured on PowerShell 7.6.7 with a stand-in `cmd` that prints its argv:
    //   cmd /c "rd /s /q \"$d\""  →  argv[1] = `rd /s /q \`
    //                                argv[2] = `<the path>\`
    // The variable and the trailing backslash land in the SAME argument, which is
    // why the delete verb ahead of them is left holding a bare backslash.
    const segments = splitSegments('cmd /c "rd /s /q \\"$d\\""', 'powershell')
    assert.deepEqual(segments, [['cmd', '/c', 'rd /s /q \\', '$d\\']])
  })

  it('keeps a backtick-escaped quote inside one argument', () => {
    const segments = splitSegments('cmd /c "rd /s /q `"$d`""', 'powershell')
    assert.deepEqual(segments, [['cmd', '/c', 'rd /s /q "$d"']])
  })

  it('treats a bare variable reference as its own argument', () => {
    assert.deepEqual(splitSegments('Remove-Item -Recurse $d', 'powershell'), [
      ['Remove-Item', '-Recurse', '$d'],
    ])
  })

  it('reads a single-quoted string literally, doubling as the escape', () => {
    assert.deepEqual(splitSegments("Remove-Item -Recurse 'C:\\it''s'", 'powershell'), [
      ['Remove-Item', '-Recurse', "C:\\it's"],
    ])
  })

  it('splits on the operators PowerShell honours', () => {
    assert.deepEqual(splitSegments('cd x; Remove-Item -Recurse a', 'powershell'), [
      ['cd', 'x'],
      ['Remove-Item', '-Recurse', 'a'],
    ])
  })

  it('gives up on an unterminated quote instead of guessing', () => {
    assert.equal(splitSegments('cmd /c "rd /s /q ', 'powershell'), null)
  })
})

describe('posix dialect', () => {
  it('splits a plain command', () => {
    assert.deepEqual(splitSegments('rm -rf ./dist', 'posix'), [['rm', '-rf', './dist']])
  })

  it('honours single quotes literally', () => {
    assert.deepEqual(splitSegments("rm -rf 'a b'", 'posix'), [['rm', '-rf', 'a b']])
  })

  it('honours backslash escaping inside double quotes only for the special set', () => {
    // `\$` escapes, `\n` does not (the backslash survives) — POSIX rule.
    assert.deepEqual(splitSegments('rm -rf "a\\$b\\nc"', 'posix'), [['rm', '-rf', 'a$b\\nc']])
  })

  it('splits on ; && || and pipes', () => {
    assert.deepEqual(splitSegments('cd x && rm -rf dist || true; echo done', 'posix'), [
      ['cd', 'x'],
      ['rm', '-rf', 'dist'],
      ['true'],
      ['echo', 'done'],
    ])
  })

  it('gives up on an unterminated quote', () => {
    assert.equal(splitSegments("rm -rf 'oops", 'posix'), null)
  })

  it('does not treat a backslash inside single quotes as an escape', () => {
    assert.deepEqual(splitSegments("rm -rf 'C:\\x'", 'posix'), [['rm', '-rf', 'C:\\x']])
  })
})

describe('cmd dialect', () => {
  it('reads a quoted path as one word', () => {
    assert.deepEqual(splitSegments('rd /s /q "C:\\Users\\x\\out"', 'cmd'), [
      ['rd', '/s', '/q', 'C:\\Users\\x\\out'],
    ])
  })

  it('honours the caret escape', () => {
    assert.deepEqual(splitSegments('rd /s /q a^ b', 'cmd'), [['rd', '/s', '/q', 'a b']])
  })

  it('ends the command at a redirect', () => {
    assert.deepEqual(splitSegments('rd /s /q x > log.txt', 'cmd'), [
      ['rd', '/s', '/q', 'x'],
      ['log.txt'],
    ])
  })
})
