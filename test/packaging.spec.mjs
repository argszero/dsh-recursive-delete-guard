import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** Every file under a directory, relative to ROOT. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

describe('the published surface', () => {
  it('lists only runtime files', () => {
    assert.deepEqual(manifest.files, [
      'lib/**/*.js',
      'lib/types/**/*.d.ts',
      'cordis.patch.yml',
      'README.md',
      'LICENSE',
    ])
  })

  it('ships no test or script file', () => {
    for (const pattern of manifest.files) {
      assert.equal(pattern.includes('test'), false, pattern)
      assert.equal(pattern.includes('scripts'), false, pattern)
    }
  })

  it('points its entry points at files that exist', () => {
    for (const path of [manifest.main, manifest.types, manifest.dsh.bundle.patch]) {
      assert.doesNotThrow(() => statSync(join(ROOT, path)), path)
    }
  })

  it('declares zero runtime dependencies', () => {
    assert.equal(manifest.dependencies, undefined)
    assert.deepEqual(Object.keys(manifest.peerDependencies), ['@deepseek-ai/cordis'])
  })

  it('imports nothing outside itself and node builtins', () => {
    const files = walk('lib').filter((file) => file.endsWith('.js'))
    assert.ok(files.length > 0)
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const match of source.matchAll(/^import .* from '([^']+)'/gmu)) {
        const specifier = match[1]
        assert.ok(
          specifier.startsWith('./') || specifier.startsWith('node:'),
          `${relative(ROOT, join(ROOT, file))} imports ${specifier}`,
        )
      }
    }
  })

  it('keeps its bundle patch pointing at itself', () => {
    const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    // The bundle overlay is a top-level ARRAY of loader patch entries; `dsh plugin add`
    // rejects anything else ("must be a top-level YAML array of loader patch entries"),
    // and a `plugins:` mapping is a cordis.yml loader config, not an overlay.
    const body = patch.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    assert.equal(body[0], '- insert:', 'a bundle overlay must open a top-level array')
    assert.match(patch, new RegExp(`^      name: '${manifest.name.replaceAll('/', '\\/')}'$`, 'mu'))
  })
})
