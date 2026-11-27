import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

export function openDb(path) {
  if (!path) throw new Error('缺少数据库路径（--db 或 SD_DB）')
  if (!existsSync(path)) throw new Error(`数据库不存在：${path}`)
  const db = new DatabaseSync(path)
  // 海豹运行中可能持有写锁，等待而不是立刻失败
  try {
    db.exec('PRAGMA busy_timeout = 30000')
  } catch {
    /* ignore */
  }
  return db
}

export function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

const REQUIRED = ['attrs', 'group_info']

export function assertSchema(db) {
  const missing = REQUIRED.filter((t) => !hasTable(db, t))
  if (missing.length) throw new Error(`数据库缺少表：${missing.join(', ')}，确认这是海豹的数据目录`)
}

export const LOG_TABLES = ['logs', 'log_items']

export function assertLogSchema(db) {
  const missing = LOG_TABLES.filter((t) => !hasTable(db, t))
  if (missing.length) throw new Error(`日志库缺少表：${missing.join(', ')}`)
}

export function now() {
  return Math.floor(Date.now() / 1000)
}

/** 事务；dryRun 时执行完回滚 */
export function tx(db, fn, { dryRun = false } = {}) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
}

