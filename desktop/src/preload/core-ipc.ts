import { channelForCoreOperation } from '../shared/ipc-contract'

export interface CoreIpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export interface CoreBridge {
  invokeCore(operationKey: string, ...args: unknown[]): Promise<unknown>
}

export function createCoreBridge(ipcRenderer: CoreIpcRendererLike): CoreBridge {
  return {
    invokeCore: (operationKey: string, ...args: unknown[]) => ipcRenderer.invoke(channelForCoreOperation(operationKey), ...args),
  }
}
