# Security Policy

## Scope

Emperor Agent is a local, single-user Electron application. The supported security boundary is:

- Electron renderer to main-process IPC.
- Model/tool execution to local filesystem and process execution.
- MCP and external platform results as untrusted input.

The retired Python web runtime is not a supported product line.

## Reporting

Do not publish exploit details before a fix is available. Report security issues with:

- A short impact summary.
- Reproduction steps.
- Affected commit or release.
- Any relevant logs with secrets removed.

For this private workspace, file the report as a private issue or send it directly to the repository owner.

## Handling Rules

- Never include API keys, local config, `memory/`, `.team/`, or user documents in reports.
- Treat MCP tool output, web content, and external bridge messages as untrusted data.
- High-impact changes to model, MCP, local config, permissions, scheduler, or command execution must keep CoreApi mutation guards and tests updated.

