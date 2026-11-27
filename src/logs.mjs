import { tx } from './db.mjs'

export function normalizeGroup(value) {
  const s = String(value ?? '').trim()
  if (!s) throw new Error('缺少群标识')
  return s.includes(':') ? s : `QQ-Group:${s}`
}

export function countLogs(db, groupId) {
  return {
    logs: db.prepare('SELECT COUNT(*) AS n FROM logs WHERE group_id = ?').get(groupId).n,
    items: db.prepare('SELECT COUNT(*) AS n FROM log_items WHERE group_id = ?').get(groupId).n,
  }
}

/** logs 在 (group_id, name) 上有唯一索引，同名会整条 UPDATE 失败 */
export function findCollisions(db, oldGroup, newGroup) {
  return db
    .prepare(
      `SELECT o.name AS name FROM logs o JOIN logs n ON o.name = n.name
       WHERE o.group_id = ? AND n.group_id = ? ORDER BY o.name`
    )
    .all(oldGroup, newGroup)
    .map((r) => r.name)
}

export function migrateLogs(db, { oldGroup, newGroup, dryRun = false }) {
  const from = normalizeGroup(oldGroup)
  const to = normalizeGroup(newGroup)
  if (from === to) return { from, to, logsMoved: 0, itemsMoved: 0, dryRun }

  const collisions = findCollisions(db, from, to)
  if (collisions.length) {
    const err = new Error(`日志重名，迁移会违反唯一索引：${collisions.join(', ')}`)
    err.code = 'LOG_NAME_COLLISION'
    err.collisions = collisions
    throw err
  }

  const result = tx(
    db,
    () => {
      const logs = db.prepare('UPDATE logs SET group_id = ? WHERE group_id = ?').run(to, from)
      const items = db.prepare('UPDATE log_items SET group_id = ? WHERE group_id = ?').run(to, from)
      return { logsMoved: Number(logs.changes || 0), itemsMoved: Number(items.changes || 0) }
    },
    { dryRun }
  )
  return { from, to, ...result, dryRun }
}
