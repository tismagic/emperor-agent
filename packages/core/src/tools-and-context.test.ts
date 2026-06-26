import { describe, expect, it } from 'vitest'
import { isHighRiskCommand, isLowRiskCommand, isReadonlyCommand, isSensitivePath } from './tools/resolvers'
import { ToolRegistry } from './tools/registry'
import { Tool, type ToolExecutionContext } from './tools/base'
import { type ParamSchema, S, toolParamsSchema } from './tools/schema'
import { pairToolCalls, capToolResults, shrinkOldToolResults, ContextPipeline } from './context/pipeline'

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
})
