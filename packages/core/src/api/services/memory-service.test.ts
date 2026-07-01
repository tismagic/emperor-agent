import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentLoop } from '../../agent/loop'
import type { ModelRoute, ProviderSnapshot } from '../../model/router'
import { LLMProvider, type ChatArgs, type LLMResponse } from '../../providers/base'
import { WatchlistDecision } from '../../watchlist/models'
import { WatchlistService } from '../../watchlist/service'
import { CoreMemoryService } from './memory-service'

const TEMPLATES_DIR = join(__dirname, '..', '..', '..', '..', '..', 'templates')

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('CoreMemoryService (MIG-IPC-007)', () => {
  it('returns the Python-compatible memory payload with context, token, runtime, watchlist, and version summaries', async () => {
    const { root, loop, service } = await makeService()
    loop.sharedMemory.writeMemory('# Long\n\nKeep this fact.')
    writeFileSync(join(root, 'memory', '2026-05-01.md'), '# 2026-05-01\n\nEpisode.', 'utf8')
    loop.activeMemoryStore.appendHistory('user', 'hello', { extra: { turn_id: 'turn_1' } })
    loop.runtimeStore.append({ event: 'message_delta', turn_id: 'turn_1', content: 'hi' })
    loop.tokenTracker.record('gpt-4.1', { input: 10, output: 5, cache_read: 2 }, { provider: 'openai', usageType: 'main_agent' })
    service.saveWatchlist('- [ ] check later')

    const payload = service.getMemory()

    expect(payload.long_term).toContain('Keep this fact')
    expect(payload.episodes).toContain('memory/2026-05-01.md')
    expect(payload.context).toMatchObject({
      mode: 'chat',
      sources: expect.arrayContaining(['memory/MEMORY.local.md', 'memory/projects/index.json']),
    })
    expect(payload.tokensByModel['openai/gpt-4.1']).toMatchObject({ provider: 'openai', model: 'gpt-4.1', total: 17 })
    expect(payload.tokensByUsageType.main_agent).toMatchObject({ total: 17 })
    expect(payload.tokenTotals).toMatchObject({ total: 17, calls: 1 })
    expect(payload.history.active_lines).toBeGreaterThan(0)
    expect(payload.runtime.activeTurns).toBe(1)
    expect(payload.watchlist.content).toBe('- [ ] check later\n')
    expect(payload.versions).toHaveProperty('versions')

    await loop.close()
  })

  it('saves memory/episodes, restores versions, returns full watchlist check payloads, and refreshes runtime context', async () => {
    const { root, loop, service, refreshes } = await makeService()
    const initial = loop.sharedMemory.readMemory()

    expect(service.saveMemory('New memory\n\n')).toEqual({
      path: 'memory/MEMORY.local.md',
      content: 'New memory\n',
    })
    expect(refreshes()).toBe(1)

    expect(() => service.getEpisode('bad-date')).toThrow('episode date must be YYYY-MM-DD')
    expect(() => service.getEpisode('2026-05-02')).toThrow('Episode not found: 2026-05-02')
    expect(service.saveEpisode('Episode body\n\n', '2026-05-02')).toEqual({
      date: '2026-05-02',
      content: 'Episode body\n',
    })
    expect(existsSync(join(root, 'memory', '2026-05-02.md'))).toBe(true)

    const versions = service.listVersions({ target: 'memory', limit: 10 }).versions
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const restored = service.restoreVersion(String(versions[0]!.id))
    expect(restored).toMatchObject({
      restored: { path: 'memory/MEMORY.local.md', content: initial },
      memory: { long_term: initial },
    })
    expect(refreshes()).toBe(2)

    service.saveWatchlist('- [ ] active item')
    const checked = await service.checkWatchlist()
    expect(checked).toMatchObject({
      decision: { action: 'skip', reason: 'manual check' },
      watchlist: { content: '- [ ] active item\n' },
    })

    await loop.close()
  })

  it('returns the full token analytics payload used by the Tokens view', async () => {
    const { loop, service } = await makeService()
    loop.tokenTracker.record('gpt-4.1', { input: 10, output: 2 }, { provider: 'openai', usageType: 'main_agent' })
    loop.tokenTracker.record('gpt-4.1', { input: 5, output: 1, cache_read: 3 }, { provider: 'openai', usageType: 'main_agent' })

    const payload = service.tokens()

    expect(payload.byDateModel[Object.keys(payload.byDateModel)[0]!]!['openai/gpt-4.1']).toMatchObject({ total: 21 })
    expect(payload.byHour).toHaveProperty(new Date().getHours().toString().padStart(2, '0'))
    expect(payload.streak).toHaveProperty('active_days')
    expect(payload.sessions).toBeGreaterThanOrEqual(1)
    expect(payload.messages).toBe(0)
    expect(payload.recentCalls?.[0]).toMatchObject({ model: 'gpt-4.1', total: 9 })
    expect(payload.recentCacheCalls?.[0]).toMatchObject({ cache_read: 3 })
    expect(payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    await loop.close()
  })

  it('compacts unarchived session history through the routed memory compactor', async () => {
    const provider = new FakeProvider()
    provider.reply = [
      '<episode>## Compact episode\n- Summarized old messages.</episode>',
      '<updated_memory># Long\n\nCompacted memory.</updated_memory>',
      '<updated_user># User\n\nCompacted preference.</updated_user>',
    ].join('\n')
    const { loop, service } = await makeService(provider)
    loop.activeMemoryStore.appendHistory('user', 'first', { extra: { turn_id: 'turn_1' } })
    loop.activeMemoryStore.appendHistory('assistant', 'reply', { extra: { turn_id: 'turn_1' } })
    loop.runtimeStore.append({ event: 'message_delta', turn_id: 'turn_1', content: 'reply' })

    const payload = await service.compact()

    expect(payload).toMatchObject({
      status: 'compacted',
      count: 2,
      message: '已压缩 2 条未归档消息。',
      unarchivedHistory: [],
    })
    expect(payload.memory.long_term).toContain('Compacted memory')
    expect(loop.sharedMemory.readUser()).toContain('Compacted preference')
    expect(loop.sharedMemory.readTodayEpisode()).toContain('Compact episode')
    expect(loop.activeMemoryStore.loadUnarchivedHistory()).toEqual([])
    expect(loop.runtimeStore.eventsForTurns(['turn_1'])).toEqual([])
    expect(provider.calls.at(-1)?.model).toBe('fake-mini')

    await loop.close()
  })
})

async function makeService(provider: FakeProvider = new FakeProvider()): Promise<{
  root: string
  loop: AgentLoop
  service: CoreMemoryService
  refreshes: () => number
}> {
  const root = tmp('emperor-memory-service-')
  let refreshCount = 0
  const loop = await AgentLoop.create({
    root,
    templatesDir: TEMPLATES_DIR,
    modelRouter: fakeRouter(provider),
    initializeMcp: false,
  })
  const watchlist = new WatchlistService(root, {
    decider: () => WatchlistDecision.skip('manual check'),
    tokenTracker: loop.tokenTracker,
  })
  const service = new CoreMemoryService(root, {
    loop,
    watchlist,
    refreshRuntimeContext: () => { refreshCount += 1 },
  })
  return { root, loop, service, refreshes: () => refreshCount }
}

class FakeProvider extends LLMProvider {
  calls: ChatArgs[] = []
  reply = 'pong'

  constructor() {
    super({ defaultModel: 'fake-main' })
  }

  async chat(args: ChatArgs): Promise<LLMResponse> {
    this.calls.push(args)
    return {
      content: this.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { input: 1, output: 1 },
      reasoningContent: null,
      thinkingBlocks: null,
    }
  }
}

function fakeRouter(provider: FakeProvider): { route: (useCase: string) => ModelRoute; payload: () => Record<string, unknown> } {
  return {
    route: (useCase: string) => ({
      snapshot: snapshot(provider, useCase === 'main_agent' ? 'main' : 'secondary'),
      fallback: null,
      useCase,
      reason: `${useCase}:fake`,
      estimatedTokens: null,
    }),
    payload: () => ({ mainModel: 'fake-main', secondaryModel: 'fake-mini' }),
  }
}

function snapshot(provider: FakeProvider, role: 'main' | 'secondary'): ProviderSnapshot {
  return {
    provider,
    providerName: 'fake',
    providerLabel: 'Fake',
    model: role === 'main' ? 'fake-main' : 'fake-mini',
    apiBase: null,
    generation: { maxTokens: 2000, temperature: 0.1, reasoningEffort: null },
    contextWindowTokens: 100000,
    config: {},
    supportsVision: false,
    entryName: 'fake',
    entryLabel: 'Fake',
    modelRole: role,
    routeReason: `${role}_model`,
  }
}
