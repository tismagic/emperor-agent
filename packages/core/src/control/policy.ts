/**
 * ControlPolicy (MIG-CTRL-002)。对齐 Python `agent/control/policy.py`。
 * 经 PermissionPipeline.isToolExposed 暴露工具；plan 模式过滤 definitions。
 */
import { PermissionPipeline } from '../permissions/pipeline'
import type { ToolRegistry } from '../tools/registry'
import type { ToolDefinition } from '../tools/base'
import { ControlMode } from './models'

export const CONTROL_TOOL_NAMES = new Set(['ask_user', 'propose_plan'])

interface PolicyHost {
  readonly mode: string
}

export class ControlPolicy {
  private readonly manager: PolicyHost
  readonly permissionPipeline: PermissionPipeline

  constructor(manager: PolicyHost) {
    this.manager = manager
    this.permissionPipeline = new PermissionPipeline()
  }

  isToolAllowed(name: string, registry: ToolRegistry): boolean {
    return this.permissionPipeline.isToolExposed(name, this.manager.mode, { registry })
  }

  filteredDefinitions(registry: ToolRegistry): ToolDefinition[] {
    const definitions = registry.getDefinitions()
    if (this.manager.mode !== ControlMode.PLAN) {
      return definitions.filter((item) => item.name !== 'propose_plan')
    }
    return definitions.filter((item) => this.isToolAllowed(String(item.name ?? ''), registry))
  }
}
