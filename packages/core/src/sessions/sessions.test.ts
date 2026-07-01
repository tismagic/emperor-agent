import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../memory/store'
import { ConversationStore, ProjectSessionMemoryStore, SessionMemoryStore } from './conversation'
import { migrateLegacyMainlineToDefaultSession } from './migrate'
import { SessionStore } from './store'
import { fallbackSessionTitle, sanitizeSessionTitle } from './title'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ConversationStore (test_conversation_store.py)', () => {
  it('keeps separate session histories isolated', () => {
    const root = tmp('emperor-session-conv-')
    const a = new ConversationStore(join(root, 'a'))
    const b = new ConversationStore(join(root, 'b'))

    a.appendHistory('user', 'hello a')
    b.appendHistory('user', 'hello b')

    expect(a.loadUnarchivedHistory().map((r) => r.content)).toContain('hello a')
    expect(a.loadUnarchivedHistory().map((r) => r.content)).not.toContain('hello b')
    expect(b.loadUnarchivedHistory().map((r) => r.content)).toContain('hello b')
  })

  it('round-trips history rows, checkpoints, and turn ids', () => {
    const store = new ConversationStore(join(tmp('emperor-session-round-'), 's1'))
    store.appendHistory('user', 'hi', { extra: { turn_id: 't1' } })
    store.appendHistory('assistant', 'hello', { extra: { turn_id: 't1' } })
    store.appendHistory('user', 'hidden', { extra: { turn_id: 'hidden', hidden: true } })
    store.appendHistory('assistant', 'hidden reply', { extra: { turn_id: 'hidden' } })

    expect(store.loadUnarchivedHistory()).toEqual([
      { role: 'user', content: 'hi', turn_id: 't1' },
      { role: 'assistant', content: 'hello', turn_id: 't1' },
    ])
    expect(store.loadUnarchivedTurnIds()).toEqual(['t1'])

    expect(store.readCheckpoint()).toBeNull()
    store.writeCheckpoint([{ role: 'user', content: 'in-flight' }])
    expect(store.readCheckpoint()).toEqual([{ role: 'user', content: 'in-flight' }])
    store.clearCheckpoint()
    expect(store.readCheckpoint()).toBeNull()
  })

  it('SessionMemoryStore delegates history to conversation and memory to shared store', () => {
    const root = tmp('emperor-session-memory-')
    const userFile = join(root, 'templates', 'USER.local.md')
    const shared = new MemoryStore(join(root, 'memory'), userFile)
    const conversation = new ConversationStore(join(root, 'sessions', 's1'))
    const scoped = new SessionMemoryStore(shared, conversation)

    scoped.writeMemory('# Shared\n')
    scoped.appendHistory('user', 'session message')

    expect(shared.readMemory()).toContain('Shared')
    expect(shared.loadUnarchivedHistory()).toEqual([])
    expect(scoped.loadUnarchivedHistory()).toEqual([{ role: 'user', content: 'session message' }])
  })

  it('ProjectSessionMemoryStore writes project memory without touching global memory', () => {
    const root = tmp('emperor-project-session-memory-')
    const userFile = join(root, 'templates', 'USER.local.md')
    const shared = new MemoryStore(join(root, 'memory'), userFile)
    shared.writeMemory('# Global\n\nOriginal global memory')
    const conversation = new ConversationStore(join(root, 'sessions', 's1'))
    const projectStore = {
      memory: '',
      readManagedMemory: () => projectStore.memory,
      updateMemory: (_projectId: string, content: string) => { projectStore.memory = content },
    }
    const scoped = new ProjectSessionMemoryStore(shared, conversation, projectStore, 'project_1')

    scoped.writeMemory('## 项目情况\n\n- 项目使用 Electron + Vue。')
    scoped.writeUser('# User\n\nShould not overwrite')
    scoped.appendEpisode('Should not create global episode')

    expect(shared.readMemory()).toContain('Original global memory')
    expect(projectStore.memory).toContain('项目使用 Electron')
    expect(scoped.readTodayEpisode()).toBe('')
  })
})

describe('SessionStore (test_session_store.py)', () => {
  it('creates, lists, renames, touches, archives, restores, and deletes sessions', () => {
    const root = tmp('emperor-session-store-')
    const store = new SessionStore(root)
    const keeper = store.create('Keeper')
    const session = store.create('First Session', {
      mode: 'build',
      project: { project_id: 'abc123', project_path: join(root, 'project'), project_name: 'project' },
    })

    expect(existsSync(join(root, 'sessions', session.id))).toBe(true)
    expect(session.mode).toBe('build')
    expect(session.project_id).toBe('abc123')
    expect(store.rename(session.id, 'New Title')).toBe(true)
    expect(store.touch(session.id, 'hello world', { incrementMessages: true })?.preview).toBe('hello world')
    expect(store.get(session.id)?.message_count).toBe(1)
    expect(store.archive(session.id)?.archived_at).toBeTruthy()
    expect(store.list().map((s) => s.id)).toEqual([keeper.id])
    expect(store.restore(session.id)?.archived_at).toBeNull()
    expect(store.delete(session.id)).toBe(true)
    expect(existsSync(join(root, 'sessions', session.id))).toBe(false)
    expect(store.delete(keeper.id)).toBe(false)
  })

  it('normalizes legacy entries and quarantines corrupt index files', () => {
    const root = tmp('emperor-session-legacy-')
    const sessionsDir = join(root, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'index.json'), JSON.stringify([{ id: 'legacy', title: 'Old', updated_at: '2026-01-01T00:00:00+0800' }]), 'utf8')

    const item = new SessionStore(root).list()[0]!
    expect(item.mode).toBe('chat')
    expect(item.project_id).toBeNull()
    expect(item.archived_at).toBeNull()

    writeFileSync(join(sessionsDir, 'index.json'), 'not valid json{{{', 'utf8')
    expect(new SessionStore(root).list()).toEqual([])
    expect(readdirSync(sessionsDir).some((name) => name.startsWith('index.corrupt-') && name.endsWith('.json'))).toBe(true)
    expect(existsSync(join(sessionsDir, 'index.json'))).toBe(false)
  })
})

describe('session migration (test_loop_sessions.py)', () => {
  it('moves legacy mainline history, checkpoint, and runtime events into a default session once', () => {
    const root = tmp('emperor-session-migrate-')
    const memoryDir = join(root, 'memory')
    rmSync(memoryDir, { recursive: true, force: true })
    mkdirSync(memoryDir, { recursive: true })
    writeFileSync(join(memoryDir, 'history.jsonl'), '{"ts":"2026-01-01","role":"user","content":"old"}\n', { encoding: 'utf8', flag: 'w' })
    writeFileSync(join(memoryDir, '_checkpoint.json'), '{"history":[{"role":"user","content":"ck"}]}', { encoding: 'utf8', flag: 'w' })
    mkdirSync(join(memoryDir, 'runtime'), { recursive: true })
    writeFileSync(join(memoryDir, 'runtime', 'events.jsonl'), '{"type":"ready"}\n', 'utf8')

    const migrated = migrateLegacyMainlineToDefaultSession(root)
    const again = migrateLegacyMainlineToDefaultSession(root)

    expect(migrated).not.toBeNull()
    expect(again).toBeNull()
    expect(existsSync(join(memoryDir, 'history.jsonl'))).toBe(false)
    expect(existsSync(join(root, 'sessions', migrated!.id, 'history.jsonl'))).toBe(true)
    expect(existsSync(join(root, 'sessions', migrated!.id, '_checkpoint.json'))).toBe(true)
    expect(existsSync(join(root, 'sessions', migrated!.id, 'runtime', 'events.jsonl'))).toBe(true)
  })
})

describe('session title (test_session_title.py)', () => {
  it('sanitizes boilerplate, punctuation, and fallback titles', () => {
    expect(sanitizeSessionTitle('《关于 帮我优化 Codex UI！》')).toBe('Codex UI')
    expect(sanitizeSessionTitle('如何实现真实会话路由？')).toBe('真实会话路由')
    expect(sanitizeSessionTitle('"配置 MCP 工具"')).toBe('配置 MCP 工具')
    expect(fallbackSessionTitle('请帮我实现真实懒创建会话，需要同步标题')).toBe('真实懒创建会话')
    expect(fallbackSessionTitle('   !!!   ')).toBe('新会话')
  })
})
