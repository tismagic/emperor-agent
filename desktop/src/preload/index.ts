import { contextBridge } from 'electron'
import { parseBackendArg } from './backend-arg'

// Expose a minimal, read-only surface to the renderer. backendBaseUrl is the
// absolute URL of the local backend (injected by main.ts); the renderer uses it
// to build /api and /ws requests when loaded from the app:// protocol.
contextBridge.exposeInMainWorld('emperor', {
  backendBaseUrl: parseBackendArg(process.argv),
  version: '0.1.0',
  platform: process.platform,
})
