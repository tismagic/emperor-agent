// Pure decisions for backend process lifecycle, kept out of the Electron
// runtime so they can be unit tested.

export interface StartupPlan {
  action: 'attach' | 'spawn'
  ownsBackend: boolean
}

// Decide whether to attach to an already-running backend or spawn our own.
// We only "own" (and later reclaim) a backend we spawned ourselves, so an
// externally launched `emperor-agent web` survives the desktop app quitting.
export function planStartup({ alreadyHealthy }: { alreadyHealthy: boolean }): StartupPlan {
  if (alreadyHealthy === true) {
    return { action: 'attach', ownsBackend: false }
  }
  return { action: 'spawn', ownsBackend: true }
}

// Only kill the backend on quit when we both own it and have a live child.
export function planShutdown({
  ownsBackend,
  child,
}: {
  ownsBackend: boolean
  child: unknown
}): { shouldKill: boolean } {
  return { shouldKill: Boolean(ownsBackend) && child != null }
}
