/**
 * 领域错误基类 (MIG-FND-008)。
 *
 * 对齐 Python 侧散落的 `class XxxError(ValueError/RuntimeError)`（SchedulerStoreCorrupt、
 * PlanQualityError、PlanEvidenceError、CompactionParseError 等）。所有错误可被 IPC 边界
 * 序列化为「安全错误」——只暴露 code/message，不泄内部细节。
 */
export class EmperorError extends Error {
  /** 稳定的机器可读错误码，用于 IPC/日志关联。 */
  readonly code: string

  constructor(message: string, code = 'emperor_error', options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }

  /** IPC 边界用：只回 code+message，绝不带内部栈。 */
  toSafe(): { code: string; message: string } {
    return { code: this.code, message: this.message }
  }
}

/** 持久化文件损坏（解析失败）。对齐 Python `SchedulerStoreCorrupt` 等。 */
export class StoreCorruptError extends EmperorError {
  /** 被隔离的损坏文件备份路径（若已隔离）。 */
  readonly backupPath?: string

  constructor(message: string, backupPath?: string, options?: ErrorOptions) {
    super(message, 'store_corrupt', options)
    this.backupPath = backupPath
  }
}

/** 解析错误（如压缩结果 XML 缺标签）。对齐 `CompactionParseError`。 */
export class ParseError extends EmperorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'parse_error', options)
  }
}

/** 校验错误（schema / 不变量）。对齐 `PlanQualityError`/`PlanEvidenceError`。 */
export class ValidationError extends EmperorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'validation_error', options)
  }
}

/** 模型输入超过上下文窗口。 */
export class ContextOverflowError extends EmperorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'context_overflow', options)
  }
}

/** 把任意 throwable 归一成安全错误（IPC 出口用）。 */
export function toSafeError(err: unknown): { code: string; message: string } {
  if (err instanceof EmperorError) return err.toSafe()
  if (err instanceof Error) return { code: 'internal_error', message: err.message }
  return { code: 'internal_error', message: String(err) }
}
