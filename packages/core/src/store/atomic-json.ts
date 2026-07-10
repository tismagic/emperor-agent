import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 原子 JSON 存储 + 腐坏隔离 (MIG-FND-002)。
 *
 * 对齐 Python 各 store 的写模式（`tasks/store`、`scheduler/store`、`runtime/store`、
 * `memory_versions._atomic_write_text`）：写 tmp → rename 原子替换；解析失败 → 备份为
 * `*.corrupt-<ts>` → 返回默认 → 暴露给 diagnostics。**不变量**：终态写要么完整要么保留旧文件。
 */

export interface ReadOptions {
  /** 解析失败、已隔离损坏文件后回调（用于 diagnostics 可见，不静默吞）。 */
  onCorrupt?: (info: {
    path: string
    backupPath: string
    error: unknown
  }) => void
}

function corruptName(path: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return `${path}.corrupt-${ts}`
}

/** 把损坏文件复制为 `*.corrupt-<ts>` 旁路保存，返回备份路径。 */
export async function isolateCorrupt(path: string): Promise<string> {
  const backup = corruptName(path)
  await copyFile(path, backup)
  return backup
}

/** 读 JSON；不存在或解析失败返回 fallback（失败时先隔离损坏文件）。 */
export async function readJson<T>(
  path: string,
  fallback: T,
  opts: ReadOptions = {},
): Promise<T> {
  if (!existsSync(path)) return fallback
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    let backupPath = ''
    try {
      backupPath = await isolateCorrupt(path)
    } catch {
      // 隔离失败也不要因此再抛；继续返回默认。
    }
    opts.onCorrupt?.({ path, backupPath, error })
    return fallback
  }
}

/** 原子写 JSON：写同目录 tmp → rename 替换。失败清理 tmp 并抛。 */
export async function writeJsonAtomic(
  path: string,
  data: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  const body = `${JSON.stringify(data, null, 2)}\n`
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}
