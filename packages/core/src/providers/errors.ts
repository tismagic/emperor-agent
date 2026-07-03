export type ProviderErrorKind =
  | 'context_overflow'
  | 'rate_limit'
  | 'auth'
  | 'transient'
  | 'permanent'
  | 'unknown'

export function classifyProviderError(error: unknown): ProviderErrorKind {
  const fields = providerErrorFields(error)
  const haystack = [fields.code, fields.type, fields.status, fields.message].join(' ').toLowerCase()
  if (/\b(context_length_exceeded|context_overflow|max_context_length)\b/.test(haystack)) return 'context_overflow'
  if (/maximum context length|context window|context length|too many tokens|prompt is too long|input is too long|exceeds.*token/.test(haystack)) return 'context_overflow'
  if (/\b(rate_limit|rate limit|too many requests|429)\b/.test(haystack)) return 'rate_limit'
  if (/\b(auth|authentication|unauthorized|forbidden|invalid api key|401|403)\b/.test(haystack)) return 'auth'
  if (/\b(timeout|timed out|econnreset|etimedout|network|temporarily unavailable|502|503|504)\b/.test(haystack)) return 'transient'
  if (fields.message) return 'permanent'
  return 'unknown'
}

export function isContextOverflowProviderError(error: unknown): boolean {
  return classifyProviderError(error) === 'context_overflow'
}

export function isRetryableProviderErrorKind(kind: ProviderErrorKind): boolean {
  return kind === 'rate_limit' || kind === 'transient'
}

function providerErrorFields(error: unknown): { code: string; type: string; status: string; message: string } {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  return {
    code: stringField(record.code),
    type: stringField(record.type),
    status: stringField(record.status),
    message: error instanceof Error ? error.message : String(error ?? ''),
  }
}

function stringField(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}
