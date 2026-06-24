import { contextBridge, ipcRenderer } from 'electron'
import { parseBackendArg, parseBackendToken } from './backend-arg'

// Expose a minimal, read-only surface to the renderer. backendBaseUrl is the
// absolute URL of the local backend (injected by main.ts); the renderer uses it
// to build /api and /ws requests when loaded from the app:// protocol.
// backendToken is the per-launch auth token (packaged app only; empty in dev).
contextBridge.exposeInMainWorld('emperor', {
  backendBaseUrl: parseBackendArg(process.argv),
  backendToken: parseBackendToken(process.argv),
  version: '0.1.0',
  platform: process.platform,
  selectDirectory: () => ipcRenderer.invoke('emperor:select-directory'),
})
