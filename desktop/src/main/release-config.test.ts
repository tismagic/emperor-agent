import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const desktopRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(desktopRoot, '..')

describe('desktop release packaging (MIG-REL-001)', () => {
  it('does not bundle the legacy Python backend by default', () => {
    const config = fs.readFileSync(path.join(desktopRoot, 'electron-builder.yml'), 'utf8')

    expect(config).not.toContain('build/backend')
    expect(config).not.toContain('to: backend')
    expect(config).toContain('runtime-defaults')
  })

  it('build_desktop_release does not require the Python backend bundle', () => {
    const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'build_desktop_release.sh'), 'utf8')

    expect(fs.existsSync(path.join(repoRoot, 'scripts', 'build_backend_bundle.sh'))).toBe(false)
    expect(script).not.toContain('build_backend_bundle.sh')
    expect(script).not.toContain('PYTHON_BIN')
  })
})
