export interface SubagentSpec {
  name: string
  description: string
  systemPrompt: string
  toolNames: string[]
  maxTurns: number
  planReadonlyExplorer: boolean
}
