import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classifyTarget, isFatal } from '../lib/target.js'

describe('classifyTarget', () => {
  const fatal = [
    ['', 'empty', false],
    ['   ', 'empty', false],
    ['/', 'root', false],
    ['\\', 'root', true],
    ['//', 'root', false],
    ['\\\\', 'root', true],
    ['C:', 'drive', true],
    ['C:\\', 'root', true],
    ['C:/', 'root', true],
    ['C:/*', 'root', true],
    ['C:\\*', 'root', true],
    ['/*', 'root', false],
    ['.', 'relative-root', false],
    ['..', 'relative-root', true],
    ['./', 'relative-root', false],
    ['a/..', 'relative-root', false],
  ]

  for (const [word, expected, windows] of fatal) {
    it(`classifies ${JSON.stringify(word)} with windows=${windows} as ${expected}`, () => {
      assert.equal(classifyTarget(word, { windows }), expected)
    })
  }

  const safe = [
    ['dist', false],
    ['./dist', false],
    ['node_modules', true],
    ['C:/Users/x/out', true],
    ['C:\\Users\\x\\out', true],
    ['/tmp/build', false],
    ['$TMPDIR/x', false],
    ['~/scratch', false],
    ['foo/*', false],
    ['//server/share/dir', true],
    ['\\\\server\\share\\dir', true],
    ['a/../b', false],
  ]

  for (const [word, windows] of safe) {
    it(`leaves ${JSON.stringify(word)} with windows=${windows} alone`, () => {
      assert.equal(classifyTarget(word, { windows }), 'safe')
    })
  }

  it('reads a leading separator as drive-relative only on Windows', () => {
    assert.equal(classifyTarget('\\Users\\x', { windows: true }), 'drive-relative')
    assert.equal(classifyTarget('\\Users\\x', { windows: false }), 'safe')
  })

  it('treats a bare glob as scoped to the working directory', () => {
    assert.equal(classifyTarget('*', { windows: true }), 'scoped-glob')
    assert.equal(isFatal('scoped-glob'), false)
  })

  it('names exactly the fatal shapes', () => {
    for (const category of ['empty', 'root', 'drive', 'drive-relative', 'relative-root']) {
      assert.equal(isFatal(category), true, category)
    }
    for (const category of ['scoped-glob', 'safe', 'nonsense']) {
      assert.equal(isFatal(category), false, category)
    }
  })

  it('tolerates a non-string word', () => {
    assert.equal(classifyTarget(undefined), 'empty')
    assert.equal(classifyTarget(42), 'empty')
  })
})
