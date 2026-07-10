import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadLocalConfig,
  localConfigDiagnostics,
  localConfigPath,
  mergeWebuiOverrides,
  parseLocalConfig,
  saveLocalConfig,
} from './local-config'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emperor-local-config-'))
})

describe('local config', () => {
  it('round-trips webui and desktop pet preferences with Python-compatible field names', async () => {
    await saveLocalConfig(dir, {
      webui: { host: '127.0.0.2', port: 9999, openBrowser: true },
      desktopPet: { enabled: true, autoStartWithWebui: false },
      prompt: { profile: 'classic' },
      permissions: {
        rules: [
          {
            id: 'ask-publish',
            action: 'ask',
            tool: 'run_command',
            commandPrefix: 'npm publish',
          },
        ],
      },
    })

    const onDisk = JSON.parse(
      await readFile(join(dir, 'emperor.local.json'), 'utf8'),
    )
    expect(onDisk).toEqual({
      webui: { host: '127.0.0.2', port: 9999, openBrowser: true },
      desktopPet: { enabled: true, autoStartWithWebui: false },
      prompt: { profile: 'classic' },
      permissions: {
        rules: [
          {
            id: 'ask-publish',
            action: 'ask',
            tool: 'run_command',
            commandPrefix: 'npm publish',
          },
        ],
      },
    })

    const loaded = await loadLocalConfig(dir)
    const prefs = mergeWebuiOverrides(loaded, {
      host: '127.0.0.1',
      port: 8765,
      openBrowser: false,
    })

    expect(loaded.webui).toEqual({
      host: '127.0.0.2',
      port: 9999,
      openBrowser: true,
    })
    expect(loaded.desktopPet).toEqual({
      enabled: true,
      autoStartWithWebui: false,
    })
    expect(loaded.prompt).toEqual({ profile: 'classic' })
    expect(loaded.permissions.rules).toEqual([
      {
        id: 'ask-publish',
        action: 'ask',
        tool: 'run_command',
        commandPrefix: 'npm publish',
      },
    ])
    expect(prefs).toEqual({ host: '127.0.0.1', port: 8765, openBrowser: false })
  })

  it('parses legacy snake_case desktop pet and open_browser keys', () => {
    const parsed = parseLocalConfig({
      webui: { host: '0.0.0.0', port: '70000', open_browser: true },
      desktop_pet: { enabled: 1, auto_start_with_webui: false },
      permissions: {
        rules: [
          {
            id: 'deny-secrets',
            action: 'deny',
            tool: 'write_file',
            path_glob: 'secrets/**',
          },
          { id: '', action: 'allow', tool: 'read_file' },
        ],
      },
    })

    expect(parsed.webui).toEqual({
      host: '0.0.0.0',
      port: 8765,
      openBrowser: true,
    })
    expect(parsed.desktopPet).toEqual({
      enabled: true,
      autoStartWithWebui: false,
    })
    expect(parsed.prompt).toEqual({ profile: 'technical' })
    expect(parsed.permissions.rules).toHaveLength(2)
  })

  it('preserves corrupt config files and reports backups in diagnostics', async () => {
    const path = localConfigPath(dir)
    await writeFile(path, '{bad json', 'utf8')

    const loaded = await loadLocalConfig(dir)

    expect(loaded.webui.port).toBe(8765)
    expect(existsSync(path)).toBe(false)
    const diagnostics = await localConfigDiagnostics(dir)
    expect(diagnostics.status).toBe('missing')
    expect(diagnostics.exists).toBe(false)
    expect(diagnostics.corruptBackups).toHaveLength(1)
    expect(diagnostics.corruptBackups[0]!.path).toContain(
      'emperor.local.json.corrupt-',
    )
    expect(diagnostics.corruptBackups[0]!.bytes).toBe('{bad json'.length)
  })

  it('reports permission rule diagnostics from local config', async () => {
    const path = localConfigPath(dir)
    await writeFile(
      path,
      JSON.stringify({
        permissions: {
          rules: [
            {
              id: 'deny-secrets',
              action: 'deny',
              tool: 'write_file',
              pathGlob: 'secrets/**',
            },
            { id: '', action: 'allow', tool: 'read_file' },
          ],
        },
      }),
      'utf8',
    )

    const diagnostics = await localConfigDiagnostics(dir)

    expect(diagnostics.permissions).toMatchObject({
      loaded: 1,
      invalid: 1,
    })
  })
})
