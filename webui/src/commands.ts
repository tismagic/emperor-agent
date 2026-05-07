export interface SlashCommand {
  name: string
  usage: string
  description: string
  aliases?: string[]
}

export const slashCommands: SlashCommand[] = [
  { name: '/help', usage: '/help', description: '显示可用斜杠命令', aliases: ['/commands'] },
  { name: '/status', usage: '/status', description: '查看运行状态、模型、Token 与资源计数' },
  { name: '/model', usage: '/model', description: '输出当前模型与 Provider 配置信息' },
  { name: '/tokens', usage: '/tokens', description: '输出 Token 消耗统计', aliases: ['/token'] },
  { name: '/tools', usage: '/tools', description: '输出可用工具摘要' },
  { name: '/skills', usage: '/skills', description: '输出可用 Skill 摘要' },
  { name: '/config', usage: '/config', description: '查看并编辑用户配置文件 (USER.local.md)', aliases: ['/configs'] },
  { name: '/memory', usage: '/memory', description: '输出记忆状态摘要' },
  { name: '/compact', usage: '/compact', description: '触发未归档会话压缩，写入 MEMORY/情景记忆' },
  { name: '/clear', usage: '/clear', description: '清空当前屏幕，不删除运行期记忆' },
  { name: '/reload', usage: '/reload', description: '刷新 bootstrap、模型、skills、tools、memory' },
]

export function parseSlashCommand(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const [name, ...args] = trimmed.split(/\s+/)
  const normalized = name.toLowerCase()
  const command = slashCommands.find((item) => item.name === normalized || item.aliases?.includes(normalized))
  return { raw: trimmed, name: normalized, command, args }
}
