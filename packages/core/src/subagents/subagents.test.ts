import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskManager } from '../tasks/manager'
import { TaskKind, TaskStatus } from '../tasks/models'
import { SidechainTranscript } from '../tasks/sidechain'
import { TokenTracker } from '../memory/token-tracker'
import type { ModelRouter, ProviderSnapshot } from '../model/router'
import type { LLMResponse } from '../providers/base'
import { Tool } from '../tools/base'
import { toolParamsSchema } from '../tools/schema'
import { ToolRegistry } from '../tools/registry'
import { DispatchSubagentTool, composeSubagentTask, extractEvidenceFiles, extractEvidenceRefs } from '../tools/dispatch'
import { buildDispatchRunnerFactory } from './dispatch-runner'
import { SubagentRegistry } from './registry'

const TEMPLATES = join(__dirname, '..', '..', '..', '..', 'templates', 'subagents')

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

class ReadTool extends Tool {
  override name = 'read_file'
  override description = 'read'
  override parameters = toolParamsSchema({}, [])
  override readOnly = true
  execute(): string { return 'ok' }
}

class FakeRunner {
  history: Array<Record<string, unknown>> = []
  constructor(private readonly final: string) {}
  step(history: Array<Record<string, unknown>>): string {
    this.history = history
    return this.final
  }
}

describe('SubagentRegistry (W08)', () => {
  it('loads builtin specs, aliases, templates, and skill summaries', () => {
    const registry = new SubagentRegistry(TEMPLATES, {
      buildSkillsSummary: () => '- **demo**: skill summary',
    })

    expect(registry.names()).toEqual([
      'dongchang_tanshi',
      'neiguan_yingzao',
      'shangbao_dianbu',
      'sili_suitang',
      'verification_reviewer',
      'xiaohuangmen',
    ])
    expect(registry.names({ includeAliases: true })).toContain('researcher')
    expect(registry.aliases()).toEqual({
      general: 'neiguan_yingzao',
      researcher: 'dongchang_tanshi',
      reviewer: 'verification_reviewer',
    })
    expect(registry.get('researcher')?.name).toBe('dongchang_tanshi')
    expect(registry.get('sili_suitang')?.systemPrompt).toContain('司礼监随堂')
    expect(registry.get('sili_suitang')?.systemPrompt).toContain('demo')
    for (const name of registry.names()) {
      const tools = registry.get(name)!.toolNames
      expect(tools).not.toContain('dispatch_subagent')
      expect(tools).not.toContain('update_todos')
    }
  })
})

describe('DispatchSubagentTool (W04-014/W08)', () => {
  it('composes contract text and extracts evidence refs', () => {
    const task = composeSubagentTask('阅读核心流程', {
      expectedOutput: '列出结论',
      evidenceRequired: '文件路径/行号',
      scopeLimit: '只读 agent/',
    })
    expect(task).toContain('## 差事契约')
    expect(task).toContain('期望产物: 列出结论')
    const refs = extractEvidenceRefs('证据: agent/runner.py:10 docs/migration/ts/README.md https://example.com')
    expect(refs).toEqual(['agent/runner.py:10', 'docs/migration/ts/README.md'])
    expect(extractEvidenceFiles(refs)).toEqual(['agent/runner.py', 'docs/migration/ts/README.md'])
  })

  it('records task and sidechain while running an isolated fake runner', async () => {
    const root = tmp('emperor-dispatch-')
    const subagents = new SubagentRegistry(TEMPLATES)
    const parent = new ToolRegistry()
    parent.register(new ReadTool())
    const manager = new TaskManager(root)
    const captured: Record<string, unknown> = {}
    const fakeRunner = new FakeRunner('结论: done\n证据: agent/runner.py:10\n风险: none\n建议下一步: none')

    const tool = new DispatchSubagentTool({
      parentRegistry: parent,
      subagentRegistry: subagents,
      runnerFactory: (args) => {
        captured.task = args.task
        captured.tools = args.subRegistry.getDefinitions().map((def) => def.name)
        return fakeRunner
      },
      taskManager: manager,
    })

    const result = await tool.execute({
      agent_type: 'sili_suitang',
      task: '阅读核心流程',
      purpose: 'read files',
      expected_output: '结论/证据',
      evidence_required: '文件路径',
      scope_limit: '只读',
    }, { root: root, arguments: {}, parentCallId: 'call_1' })

    expect(result).toContain('结论: done')
    expect(captured.task).toContain('期望产物: 结论/证据')
    expect(captured.tools).toEqual(['read_file'])
    const [record] = manager.store.list()
    expect(record!.kind).toBe(TaskKind.SUBAGENT)
    expect(record!.status).toBe(TaskStatus.COMPLETED)
    expect(record!.tool_call_id).toBe('call_1')
    const page = new SidechainTranscript(root, record!.id).read()
    expect(page.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(page.messages[0]!.content).toBe(captured.task)
  })

  it('enforces plan mode readonly explorer contract', () => {
    const subagents = new SubagentRegistry(TEMPLATES)
    const tool = new DispatchSubagentTool({
      parentRegistry: new ToolRegistry(),
      subagentRegistry: subagents,
      runnerFactory: () => new FakeRunner('unused'),
      controlManager: { mode: 'plan' },
    })

    expect(tool.isReadOnly({
      agent_type: 'sili_suitang',
      task: 'read',
      expected_output: 'summary',
      evidence_required: 'files',
      scope_limit: 'only docs',
    })).toBe(true)
    expect(tool.isReadOnly({ agent_type: 'sili_suitang', task: 'read' })).toBe(false)
    expect(tool.isReadOnly({ agent_type: 'neiguan_yingzao', task: 'write', expected_output: 'x', evidence_required: 'x', scope_limit: 'x' })).toBe(false)
  })

  it('builds routed subagent runners through ModelRouter and records usage role', async () => {
    const root = tmp('emperor-dispatch-routed-')
    const subagents = new SubagentRegistry(TEMPLATES)
    const tracker = new TokenTracker(join(root, 'memory', 'tokens.jsonl'))
    const calls: Array<Record<string, unknown>> = []
    const modelRouter = {
      route: (useCase: string, agentType?: string | null, task?: string | null) => {
        calls.push({ useCase, agentType, task })
        return {
          snapshot: snapshot('secondary-model', 'secondary'),
          fallback: snapshot('main-model', 'main'),
          useCase,
          reason: `${useCase}:${agentType}:lightweight`,
          estimatedTokens: 10,
        }
      },
    } as unknown as ModelRouter
    const factory = buildDispatchRunnerFactory({ modelRouter, tokenTracker: tracker })
    const spec = subagents.get('sili_suitang')!
    const runner = factory({ spec, subRegistry: new ToolRegistry(), task: '阅读 docs' })

    const result = await runner.step([{ role: 'user', content: '阅读 docs' }])
    expect(result).toBe('结论: routed')
    expect(calls[0]).toMatchObject({ useCase: 'subagent', agentType: 'sili_suitang', task: '阅读 docs' })
    expect(requireTokenLedger(tracker.logFile)).toContain('"model_role":"secondary"')
    expect(requireTokenLedger(tracker.logFile)).toContain('"usage_type":"subagent:sili_suitang"')
  })
})

function snapshot(model: string, role: 'main' | 'secondary'): ProviderSnapshot {
  return {
    provider: { chat: async (): Promise<LLMResponse> => response('结论: routed') } as never,
    providerName: 'fake',
    providerLabel: 'Fake',
    model,
    apiBase: null,
    generation: { maxTokens: 2000, temperature: 0.1, reasoningEffort: null },
    contextWindowTokens: 100_000,
    config: {},
    supportsVision: false,
    entryName: 'fake',
    entryLabel: 'Fake',
    modelRole: role,
    routeReason: role === 'secondary' ? 'secondary_model' : 'fallback_main',
  }
}

function response(content: string): LLMResponse {
  return { content, toolCalls: [], finishReason: 'stop', usage: { input: 2, output: 1 }, reasoningContent: null, thinkingBlocks: null }
}

function requireTokenLedger(path: string): string {
  return readFileSync(path, 'utf8')
}
