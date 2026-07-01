import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isHighRiskCommand, isLowRiskCommand, isReadonlyCommand, isSensitivePath } from './tools/resolvers'
import { ToolRegistry } from './tools/registry'
import { Tool } from './tools/base'
import { S, toolParamsSchema } from './tools/schema'
import { pairToolCalls, capToolResults, shrinkOldToolResults, ContextPipeline, ToolResultStore } from './context/pipeline'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// ── TOOL-005 command resolvers ──

describe('command resolvers', () => {
  it('high risk flags push/sudo/rm -rf/docker push/terraform apply etc', () => {
    expect(isHighRiskCommand('git push origin main')).toBe(true)
    expect(isHighRiskCommand('sudo rm -rf /')).toBe(true)
    expect(isHighRiskCommand('docker push image')).toBe(true)
    expect(isHighRiskCommand('terraform apply')).toBe(true)
    expect(isHighRiskCommand('pip install requests')).toBe(true)
  })

  it('non-high-risk commands pass through', () => {
    expect(isHighRiskCommand('pwd')).toBe(false)
    expect(isHighRiskCommand('git status')).toBe(false)
    expect(isHighRiskCommand('pytest tests/ -q')).toBe(false)
  })

  it('low risk allowlist covers ls/pwd/pytest/git status|diff|log + npm test + python3 -m pytest', () => {
    expect(isLowRiskCommand('ls')).toBe(true)
    expect(isLowRiskCommand('pwd')).toBe(true)
    expect(isLowRiskCommand('pytest')).toBe(true)
    expect(isLowRiskCommand('git status')).toBe(true)
    expect(isLowRiskCommand('git log --oneline')).toBe(true)
    expect(isLowRiskCommand('npm test')).toBe(true)
    expect(isLowRiskCommand('python3 -m pytest tests/')).toBe(true)
  })

  it('low risk blocks chained/redirected commands', () => {
    expect(isLowRiskCommand('ls && rm -rf .')).toBe(false)
    expect(isLowRiskCommand('pwd; cat /etc/passwd')).toBe(false)
    expect(isLowRiskCommand('ls > /dev/null')).toBe(false)
  })

  it('readonly excludes pytest/npm test (code execution)', () => {
    expect(isReadonlyCommand('ls')).toBe(true)
    expect(isReadonlyCommand('git status')).toBe(true)
    expect(isReadonlyCommand('pytest')).toBe(false)
    expect(isReadonlyCommand('npm test')).toBe(false)
    expect(isReadonlyCommand('npm test -- --run')).toBe(false)
  })

  it('sensitive path flags secrets, memory, git internals, traversal', () => {
    expect(isSensitivePath('.env')).toBe(true)
    expect(isSensitivePath('memory/history.jsonl')).toBe(true)
    expect(isSensitivePath('../../etc/passwd')).toBe(true)
    expect(isSensitivePath('src/main.ts')).toBe(false)
    expect(isSensitivePath('.git/config')).toBe(true)
    expect(isSensitivePath('desktop/out/index.html')).toBe(true)
  })
})

// ── TOOL-003 registry + base ──

class EchoTool extends Tool {
  name = 'echo'
  description = 'echoes input'
  parameters = toolParamsSchema({ text: S('text to echo') })
  async execute(args: Record<string, unknown>) { return `echo: ${args.text}` }
}

describe('ToolRegistry', () => {
  it('registers tools, generates definitions, executes and casts params', async () => {
    const reg = new ToolRegistry()
    reg.register(new EchoTool())
    const defs = reg.getDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]!.name).toBe('echo')
    expect(defs[0]!.description).toBe('echoes input')
    expect(defs[0]!.input_schema.properties.text).toMatchObject({ type: 'string' })

    const out = await reg.execute('echo', { text: 'hello' })
    expect(out).toBe('echo: hello')
  })

  it('rejects duplicate registration and unknown tools', () => {
    const reg = new ToolRegistry()
    reg.register(new EchoTool())
    expect(() => reg.register(new EchoTool())).toThrow(/already registered/)
    expect(() => reg.prepareCall('nope', {})).toThrow(/Unknown tool/)
  })
})

// ── CORE-002/003/005 context_pipeline ──

describe('context_pipeline', () => {
  it('pairToolCalls backfills missing tool results and drops orphans', () => {
    const history = [
      { role: 'user', content: 'run it' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    ]
    const [cleaned, filled, dropped] = pairToolCalls(history)
    expect(cleaned).toHaveLength(3)
    expect(cleaned[2]!).toEqual({
      role: 'tool', tool_call_id: 'call_1', name: 'read_file',
      content: '(tool execution interrupted)',
    })
    expect(filled).toBe(1)
    expect(dropped).toBe(0)
  })

  it('pairToolCalls drops orphan tool messages', () => {
    const history = [
      { role: 'tool', tool_call_id: 'orphan', name: 'read_file', content: 'bad' },
      { role: 'user', content: 'hello' },
    ]
    const [cleaned, _f, dropped] = pairToolCalls(history)
    expect(dropped).toBe(1)
    expect(cleaned).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('capToolResults keeps head + tail with truncation marker', () => {
    const text = 'a'.repeat(9000) + 'tail'
    const history = [{ role: 'tool', tool_call_id: 'call_1', name: 'grep', content: text }]
    const [capped, count] = capToolResults(history, 8000)
    expect(capped[0]!.content as string).toMatch(/^a{100}/)
    expect(capped[0]!.content as string).toMatch(/tail$/)
    expect(capped[0]!.content as string).toContain('truncated, total 9004 chars')
    expect(count).toBe(1)
  })

  it('shrinkOldToolResults shrinks old large tools beyond keep_recent', () => {
    const oldLarge = { role: 'tool', tool_call_id: 'old', name: 'grep', content: 'x'.repeat(2000) }
    const recentLarge = { role: 'tool', tool_call_id: 'recent', name: 'grep', content: 'y'.repeat(2000) }
    const history = [oldLarge, { role: 'user', content: 'middle' }, recentLarge]
    const [shrunk, count] = shrinkOldToolResults(history, 2, 100)
    expect(shrunk[0]!.content).toBe('[shrunk] grep → 2000 chars omitted')
    expect(shrunk[2]!.content).toBe('y'.repeat(2000))
    expect(count).toBe(1)
  })

  it('ContextPipeline.project chains all 4 governance steps', () => {
    const pipe = new ContextPipeline({ keepRecent: 2, microcompactKeepRecent: 5 })
    const proj = pipe.project([{ role: 'user', content: 'hi' }])
    expect(proj.messages).toHaveLength(1)
    expect(proj.filled).toBe(0)
    expect(proj.dropped).toBe(0)
  })

  it('replaces large tool results with stable artifact references', () => {
    const root = tmp('emperor-context-pipeline-')
    const content = 'x'.repeat(9000)
    const history = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'grep', arguments: '{}' } }] },
      { role: 'tool', turn_id: 'turn_1', tool_call_id: 'call_1', name: 'grep', content },
    ]
    const pipeline = new ContextPipeline({
      toolResultStore: new ToolResultStore(root),
      replacementMinBytes: 2000,
      replacementPreviewChars: 120,
    })

    const projection = pipeline.project(history)
    const projectionAgain = pipeline.project(history)
    const toolMessage = projection.messages[1]!
    const replacement = (projection.report.tool_result_replacements as Array<Record<string, unknown>>)[0]!

    expect(projection.report.replaced_tool_results).toBe(1)
    expect(projectionAgain.messages[1]!.content).toBe(toolMessage.content)
    expect(projectionAgain.report.tool_result_replacements).toEqual(projection.report.tool_result_replacements)
    expect(readFileSync(join(root, String(replacement.artifact_path)), 'utf8')).toBe(content)
    expect(String(toolMessage.content)).toContain('Tool result stored outside the model context')
    expect(String(toolMessage.content)).toContain(String(replacement.artifact_path))
    expect(String(toolMessage.content)).toContain('original_chars: 9000')
    expect(String(toolMessage.content).length).toBeLessThan(1000)
  })

  it('microcompacts old large text messages without touching tool-call messages', () => {
    const longText = 'alpha '.repeat(900)
    const recentText = 'beta '.repeat(900)
    const history = [
      { role: 'user', content: longText },
      { role: 'assistant', content: 'short reply' },
      { role: 'user', content: recentText },
    ]

    const projection = new ContextPipeline({
      microcompactKeepRecent: 1,
      microcompactMinChars: 1000,
      microcompactHeadChars: 80,
      microcompactTailChars: 60,
    }).project(history)

    expect(projection.report.microcompacted_messages).toBe(1)
    expect((projection.report.microcompact_records as Array<Record<string, unknown>>)[0]).toMatchObject({ index: 0, role: 'user' })
    expect(String(projection.messages[0]!.content)).toMatch(/^\[local_microcompact\]/)
    expect(String(projection.messages[0]!.content)).toContain('original_chars:')
    expect(String(projection.messages[0]!.content)).toContain('alpha alpha')
    expect(projection.messages[2]!.content).toBe(recentText)
    expect(history[0]!.content).toBe(longText)

    const preserved = new ContextPipeline({
      microcompactKeepRecent: 1,
      microcompactMinChars: 1000,
    }).project([
      { role: 'assistant', content: 'x'.repeat(3000), tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'ok' },
      { role: 'user', content: 'next' },
    ])
    expect(preserved.report.microcompacted_messages).toBe(0)
    expect((preserved.messages[0]!.tool_calls as Array<Record<string, unknown>>)[0]!.id).toBe('call_1')
  })

  it('injects plan runtime context before projected history', () => {
    const projection = new ContextPipeline({
      planContextProvider: () => ({ role: 'system', content: '[PLAN_RUNTIME_CONTEXT]\nplan_id: plan_1' }),
    }).project([{ role: 'user', content: 'continue' }])

    expect(String(projection.messages[0]!.content)).toMatch(/^\[PLAN_RUNTIME_CONTEXT\]/)
    expect(projection.messages[1]).toEqual({ role: 'user', content: 'continue' })
    expect(projection.report.plan_context_attached).toBe(1)
  })
})
