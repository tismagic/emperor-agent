import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJson, writeJsonAtomic } from './atomic-json'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emperor-store-'))
})
afterEach(() => {})

describe('atomic-json store', () => {
  it('round-trips JSON and creates parent dirs', async () => {
    const p = join(dir, 'nested', 'state.json')
    await writeJsonAtomic(p, { a: 1, b: ['x'] })
    expect(existsSync(p)).toBe(true)
    expect(await readJson(p, null)).toEqual({ a: 1, b: ['x'] })
  })

  it('returns fallback when file is missing', async () => {
    expect(await readJson(join(dir, 'missing.json'), { def: true })).toEqual({ def: true })
  })

  it('isolates a corrupt file and reports it, then returns fallback', async () => {
    const p = join(dir, 'broken.json')
    await writeFile(p, '{ not json', 'utf8')
    const reports: string[] = []
    const result = await readJson(p, { ok: false }, { onCorrupt: (i) => reports.push(i.backupPath) })
    expect(result).toEqual({ ok: false })
    expect(reports).toHaveLength(1)
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('broken.json.corrupt-'))).toBe(true)
  })

  it('leaves no tmp files behind after a successful write', async () => {
    const p = join(dir, 'clean.json')
    await writeJsonAtomic(p, { ok: true })
    const files = await readdir(dir)
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0)
  })

  it('does not clobber the old file content mid-write (atomic replace)', async () => {
    const p = join(dir, 'state.json')
    await writeJsonAtomic(p, { v: 1 })
    await writeJsonAtomic(p, { v: 2 })
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ v: 2 })
  })
})
