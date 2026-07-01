/**
 * 系统提示词构建 ContextBuilder (MIG-CORE-006)。对齐 Python `agent/context.py`。
 * bootstrap(SOUL/TOOL/USER) + identity + memory + skills 拼装；段以 \n\n---\n\n 连接。
 * jinja → 手写插值（仅 workspace / subagents_summary / skills_summary 三个变量）。
 * skills/subagent/memory 以注入接口给入（完整实现来自各自波次）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DEFAULT_MEMORY_BUDGET_CHARS = 12_000

export interface ContextSection {
  name: string
  content: string
  source: string
  priority: number
  budgetChars: number | null
  version: string | null
}

/** 完整 SkillsLoader 的最小表面（W04/技能波次提供实现）。 */
export interface SkillsLoaderLike {
  getAlwaysSkills(): string[]
  loadSkillsForContext(names: string[]): string
  buildSkillsSummary(opts?: { exclude?: Set<string> }): string
}

/** SubagentRegistry 的最小表面（W08 提供实现）。 */
export interface SubagentRegistryLike {
  describe(): string
}

/** MemoryStore 的最小表面（W06 提供实现）。 */
export interface MemoryLike {
  readMemory(): string
  memoryFile?: string
}

export class ContextBuilder {
  private static readonly BOOTSTRAP_FILES = ['SOUL.md', 'TOOL.md', 'USER.md']

  readonly docsDir: string
  readonly skills: SkillsLoaderLike
  readonly memory: MemoryLike | null
  readonly memoryBudgetChars: number
  subagentRegistry: SubagentRegistryLike | null = null
  sessionMode: 'chat' | 'build' = 'chat'
  projectAgents = ''
  projectPath = ''
  projectIndexSummary = ''

  constructor(
    docsDir: string,
    skillsLoader: SkillsLoaderLike,
    opts?: { memory?: MemoryLike | null; memoryBudgetChars?: number },
  ) {
    this.docsDir = docsDir
    this.skills = skillsLoader
    this.memory = opts?.memory ?? null
    this.memoryBudgetChars = opts?.memoryBudgetChars ?? DEFAULT_MEMORY_BUDGET_CHARS
  }

  setSubagentRegistry(subagentRegistry: SubagentRegistryLike | null): void {
    this.subagentRegistry = subagentRegistry
  }

  setSessionScope(opts?: { mode?: string; projectAgents?: string; projectPath?: string; projectIndexSummary?: string }): void {
    this.sessionMode = opts?.mode === 'build' ? 'build' : 'chat'
    this.projectAgents = String(opts?.projectAgents ?? '').trim()
    this.projectPath = String(opts?.projectPath ?? '').trim()
    this.projectIndexSummary = String(opts?.projectIndexSummary ?? '').trim()
  }

  renderTemplate(name: string, vars: Record<string, string>): string {
    const path = join(this.docsDir, 'agent', name)
    if (!existsSync(path)) return ''
    try {
      let text = readFileSync(path, 'utf8')
      // jinja {{ var }} → 插值（仅三个已知变量；容忍任意空白）。
      for (const [key, value] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value)
      }
      return text
    } catch {
      return ''
    }
  }

  buildSystemPrompt(): string {
    return this.buildSections().map((s) => s.content).join('\n\n---\n\n')
  }

  buildSections(): ContextSection[] {
    const sections: ContextSection[] = []

    const bootstrapParts: string[] = []
    const versions: string[] = []
    for (const name of ContextBuilder.BOOTSTRAP_FILES) {
      const path = this.bootstrapPath(name)
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'utf8').trim()
      bootstrapParts.push(text)
      const version = promptVersion(text)
      if (version) versions.push(`${name}:${version}`)
    }
    const bootstrap = bootstrapParts.join('\n\n')
    if (bootstrap) {
      sections.push({
        name: 'bootstrap',
        content: bootstrap,
        source: 'templates/SOUL.md+TOOL.md+USER.md',
        priority: 100,
        budgetChars: null,
        version: versions.join(', ') || null,
      })
    }

    const workspace = this.sessionMode === 'build' && this.projectPath ? this.projectPath : dirname(this.docsDir)
    const identity = this.renderTemplate('identity.md', { workspace, subagents_summary: this.subagentsSummary() })
    if (identity) {
      sections.push({
        name: 'identity',
        content: identity,
        source: 'templates/agent/identity.md',
        priority: 90,
        budgetChars: null,
        version: promptVersion(identity),
      })
    }

    if (this.sessionMode === 'build') {
      if (this.projectAgents) {
        sections.push({
          name: 'project_agents',
          content:
            '# Project AGENTS.md\n\n' +
            `Project path: ${this.projectPath || '(unknown)'}\n\n` +
            `${clipText(this.projectAgents, this.memoryBudgetChars, 'Project AGENTS.md')}`,
          source: this.projectPath ? join(this.projectPath, 'AGENTS.md') : 'Project AGENTS.md',
          priority: 85,
          budgetChars: this.memoryBudgetChars,
          version: null,
        })
      }
    } else if (this.memory) {
      const memory = this.memory.readMemory().trim()
      if (memory) {
        const budgeted = clipText(memory, this.memoryBudgetChars, 'Long-term Memory')
        sections.push({
          name: 'long_term_memory',
          content: `# Long-term Memory\n\n${budgeted}`,
          source: String(this.memory.memoryFile ?? 'memory'),
          priority: 80,
          budgetChars: this.memoryBudgetChars,
          version: null,
        })
      }
      if (this.projectIndexSummary) {
        sections.push({
          name: 'project_index_summary',
          content: `# Project Index Summary\n\n${this.projectIndexSummary}`,
          source: 'memory/projects/index.json',
          priority: 75,
          budgetChars: null,
          version: null,
        })
      }
    }

    const alwaysSkills = this.skills.getAlwaysSkills()
    if (alwaysSkills.length) {
      const alwaysContent = this.skills.loadSkillsForContext(alwaysSkills)
      if (alwaysContent) {
        sections.push({
          name: 'active_skills',
          content: `# Active Skills\n\n${alwaysContent}`,
          source: 'skills/*/SKILL.md',
          priority: 70,
          budgetChars: null,
          version: null,
        })
      }
    }

    const skillsSummary = this.skills.buildSkillsSummary({ exclude: new Set(alwaysSkills) })
    if (skillsSummary) {
      const skillsSection = this.renderTemplate('skills_section.md', { skills_summary: skillsSummary })
      sections.push({
        name: 'skills_summary',
        content: skillsSection,
        source: 'templates/agent/skills_section.md',
        priority: 60,
        budgetChars: null,
        version: promptVersion(skillsSection),
      })
    }

    return sections
  }

  private bootstrapPath(name: string): string {
    if (name === 'USER.md') {
      const local = join(this.docsDir, 'USER.local.md')
      if (existsSync(local)) return local
      const init = join(this.docsDir, 'init', 'USER.md')
      if (existsSync(init)) return init
    }
    return join(this.docsDir, name)
  }

  private subagentsSummary(): string {
    if (this.subagentRegistry === null) return '(subagent registry not yet attached)'
    return this.subagentRegistry.describe()
  }
}

function promptVersion(text: string): string | null {
  const match = /^Prompt-Version:\s*(.+)$/m.exec(text)
  return match ? match[1]!.trim() : null
}

function clipText(text: string, budgetChars: number, label: string): string {
  if (budgetChars <= 0 || text.length <= budgetChars) return text
  const headBudget = Math.max(1, Math.trunc(budgetChars * 0.68))
  const tailBudget = Math.max(1, budgetChars - headBudget)
  const omitted = text.length - headBudget - tailBudget
  return (
    `${text.slice(0, headBudget).replace(/\s+$/, '')}\n\n` +
    `[${label} clipped by ContextBuilder: ${omitted} chars omitted]\n\n` +
    `${text.slice(text.length - tailBudget).replace(/^\s+/, '')}`
  )
}
