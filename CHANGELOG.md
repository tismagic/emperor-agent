# Changelog

## Unreleased

- Completed TypeScript/Electron migration hardening follow-up after the 2026-07-01 audit.
- Added MCP tool-result untrusted marking and protocol `isError` propagation.
- Added shared core runtime event typing for renderer event projections.
- Consolidated mapped renderer Core API calls through `api/http.ts`.
- Added token usage hot-log monthly archive support while preserving aggregate statistics across archive and hot rows.
- Removed duplicated Composer model/mode floating-menu logic behind a shared helper.
- Reduced chat message-list scroll watcher cost by tracking the latest visible message signature instead of deep-watching the full timeline.
- Cleaned binary NUL bytes from `packages/core/src/memory/history.ts` source signatures.

