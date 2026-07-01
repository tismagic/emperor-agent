import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SubagentSpec } from './spec'

const BUILTIN_SPECS: Record<string, Omit<SubagentSpec, 'name' | 'systemPrompt'>> = {
  xiaohuangmen: {
    description: '通传小黄门。轻量只读, 适合短命令、快速确认、跑腿探路。若发现差事变复杂, 应回禀总管改派专职内官。',
    toolNames: ['run_command', 'read_file', 'glob', 'grep'],
    maxTurns: 8,
    planReadonlyExplorer: false,
  },
  sili_suitang: {
    description: '司礼监随堂小太监。只读文书, 适合阅读代码、查阅文档、整理提纲、归纳结论。',
    toolNames: ['load_skill', 'read_file', 'glob', 'grep'],
    maxTurns: 12,
    planReadonlyExplorer: true,
  },
  dongchang_tanshi: {
    description: '东厂探事小太监。只读查访, 适合抓网页、查资料、探索性搜索、比对外部线索。',
    toolNames: ['run_command', 'web_fetch', 'load_skill', 'read_file', 'glob', 'grep'],
    maxTurns: 15,
    planReadonlyExplorer: false,
  },
  shangbao_dianbu: {
    description: '尚宝监典簿小太监。只读核验, 适合盘点文件、校对清单、检查遗漏、整理表册。',
    toolNames: ['run_command', 'read_file', 'glob', 'grep'],
    maxTurns: 12,
    planReadonlyExplorer: true,
  },
  verification_reviewer: {
    description: '独立复核小太监。只读审查项目变更, 适合对非平凡计划做对抗式复核、验证命令核验、风险遗漏检查。',
    toolNames: ['run_command', 'read_file', 'glob', 'grep'],
    maxTurns: 14,
    planReadonlyExplorer: true,
  },
  neiguan_yingzao: {
    description: '内官监营造小太监。可读写可执行命令, 适合修改文件、搭建工程、跑命令验收。',
    toolNames: ['run_command', 'web_fetch', 'load_skill', 'read_file', 'write_file', 'edit_file', 'glob', 'grep'],
    maxTurns: 20,
    planReadonlyExplorer: false,
  },
}

const ALIASES: Record<string, string> = {
  general: 'neiguan_yingzao',
  researcher: 'dongchang_tanshi',
  reviewer: 'verification_reviewer',
}

const DEFAULT_PROMPT = (
  '你是奉总管之命专办一件差事的小太监。\n' +
  "- 不必使用'奉天承运皇帝诏曰'前缀, 那是总管对皇上的礼数。\n" +
  '- 用工具尽快把差事办妥, 最后用一段简短中文向总管回禀。\n' +
  '- 最终回禀必须包含: 结论、证据、风险、建议下一步。\n' +
  '- 只回禀结论与关键信息, 不要复述每一步细节。\n' +
  '- 你不能再派遣其他小太监, 所有差事自己跑工具完成。'
)

export interface SkillsSummaryProvider {
  buildSkillsSummary?: () => string
  summary?: () => string
}

export class SubagentRegistry {
  readonly templatesDir: string
  private readonly skillsLoader: SkillsSummaryProvider | null
  private readonly specs = new Map<string, SubagentSpec>()

  constructor(templatesDir: string, skillsLoader?: SkillsSummaryProvider | null) {
    this.templatesDir = templatesDir
    this.skillsLoader = skillsLoader ?? null
    this.loadAll()
  }

  resolveName(name: string): string {
    return ALIASES[name] ?? name
  }

  get(name: string): SubagentSpec | null {
    return this.specs.get(this.resolveName(name)) ?? null
  }

  names(opts: { includeAliases?: boolean } = {}): string[] {
    const names = new Set(this.specs.keys())
    if (opts.includeAliases) {
      for (const alias of Object.keys(ALIASES)) names.add(alias)
    }
    return [...names].sort()
  }

  aliases(): Record<string, string> {
    return { ...ALIASES }
  }

  describe(): string {
    const lines = [...this.specs.values()].map((spec) => `  - ${spec.name}: ${spec.description}`)
    const aliasText = Object.entries(ALIASES).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} -> ${v}`).join(', ')
    if (aliasText) lines.push(`  - 兼容别名: ${aliasText}`)
    return lines.join('\n')
  }

  private loadAll(): void {
    for (const [name, cfg] of Object.entries(BUILTIN_SPECS)) {
      const promptFile = join(this.templatesDir, `${name}.md`)
      let systemPrompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8').trim() : DEFAULT_PROMPT
      if (this.skillsLoader && cfg.toolNames.includes('load_skill')) {
        const summary = this.skillsLoader.buildSkillsSummary?.() || this.skillsLoader.summary?.() || ''
        if (summary) {
          systemPrompt += (
            '\n\n## 可加载的技能 (load_skill)\n\n' +
            `${summary}\n\n` +
            '遇到对应专题时, 先调 load_skill 把技能内容拉进上下文。'
          )
        }
      }
      this.specs.set(name, { name, systemPrompt, ...cfg })
    }
  }
}
