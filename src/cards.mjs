import { now } from './db.mjs'
import { LEGACY_MARK, sheetId, groupShort } from './ids.mjs'

const COLUMNS =
  'id, attrs_type, binding_sheet_id, name, owner_id, sheet_type, is_hidden, created_at, updated_at, data'

export function countCharacters(db, owner) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM attrs WHERE owner_id = ? AND attrs_type = 'character'")
    .get(owner).n
}

export function listCharacters(db, owner) {
  return db
    .prepare(
      `SELECT id, name, sheet_type AS sheetType, is_hidden AS isHidden, updated_at AS updatedAt
       FROM attrs WHERE owner_id = ? AND attrs_type = 'character'
       ORDER BY updated_at DESC, name`
    )
    .all(owner)
}

export function listOwners(db, limit = 50) {
  return db
    .prepare(
      `SELECT owner_id AS owner, COUNT(*) AS cards, MAX(updated_at) AS updatedAt
       FROM attrs WHERE attrs_type = 'character'
       GROUP BY owner_id ORDER BY updatedAt DESC LIMIT ?`
    )
    .all(limit)
}

function uniqueName(db, owner, base) {
  const stmt = db.prepare('SELECT 1 AS ok FROM attrs WHERE owner_id = ? AND name = ? LIMIT 1')
  let name = base
  if (!stmt.get(owner, name)) return name
  for (let i = 2; i < 1000; i++) {
    name = `${base}-${i}`
    if (!stmt.get(owner, name)) return name
  }
  return `${base}-${Date.now()}`
}

/** 普通角色卡：复制并命名 原名-旧QQ */
export function copyCharacters(db, { oldUser, newUser, qq, dryRun = false }) {
  const rows = db
    .prepare("SELECT * FROM attrs WHERE owner_id = ? AND attrs_type = 'character' ORDER BY updated_at DESC")
    .all(oldUser)

  const copied = []
  for (const card of rows) {
    const targetId = `${card.id}${LEGACY_MARK}${newUser}`
    const existing = db.prepare('SELECT id, name FROM attrs WHERE id = ?').get(targetId)
    if (existing) {
      copied.push({ id: existing.id, name: existing.name, status: 'exists' })
      continue
    }
    const base = String(card.name || '').trim() || '角色卡'
    const name = uniqueName(db, newUser, `${base}-${qq}`)
    if (!dryRun) {
      db.prepare(`INSERT INTO attrs (${COLUMNS}) VALUES (?, 'character', '', ?, ?, ?, ?, ?, ?, ?)`).run(
        targetId,
        name,
        newUser,
        card.sheet_type || '',
        card.is_hidden ?? 0,
        card.created_at || now(),
        now(),
        card.data ?? Buffer.from('{}')
      )
    }
    copied.push({ id: targetId, name, status: dryRun ? 'created(dryRun)' : 'created' })
  }
  return copied
}

/** 群内属性表：id = <群ID>-<用户ID>；attrs_type 可能是空 */
export function findGroupSheets(db, oldUser) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM attrs
       WHERE id LIKE ? AND (attrs_type IS NULL OR attrs_type = '' OR attrs_type = 'group_user')
       ORDER BY updated_at DESC`
    )
    .all(`%-${oldUser}`)
}

function isEmptyData(buf) {
  if (!buf) return true
  const s = Buffer.from(buf).toString('utf8').trim()
  return s === '' || s === '{}' || s === 'null'
}

/** 群内表转全局卡；表绑过卡时用被绑卡的数据，空表跳过。 */
export function sheetToCard(db, { sheet, oldGroup, newUser, dryRun = false }) {
  const targetId = `${sheet.id}${LEGACY_MARK}${newUser}`
  const existing = db.prepare('SELECT id, name FROM attrs WHERE id = ?').get(targetId)
  if (existing) return { id: existing.id, name: existing.name, from: oldGroup, status: 'exists' }

  let name = String(sheet.name || '').trim()
  let data = sheet.data
  let sheetType = sheet.sheet_type || ''
  let viaBound = false

  const boundId = String(sheet.binding_sheet_id || '')
  if (boundId) {
    const bound = db.prepare('SELECT name, data, sheet_type FROM attrs WHERE id = ?').get(boundId)
    if (bound && !isEmptyData(bound.data)) {
      name = String(bound.name || name)
      data = bound.data
      sheetType = bound.sheet_type || sheetType
      viaBound = true
    }
  }

  if (isEmptyData(data)) return { id: null, name: null, from: oldGroup, status: 'skipped-empty', viaBound }

  const finalName = uniqueName(db, newUser, `${name || '角色卡'}-${groupShort(oldGroup)}`)

  if (!dryRun) {
    db.prepare(`INSERT INTO attrs (${COLUMNS}) VALUES (?, 'character', '', ?, ?, ?, 0, ?, ?, ?)`).run(
      targetId,
      finalName,
      newUser,
      sheetType,
      sheet.created_at || now(),
      now(),
      data
    )
  }
  return { id: targetId, name: finalName, from: oldGroup, status: dryRun ? 'created(dryRun)' : 'created', viaBound }
}

/** 群映射时顺带把玩家档案（昵称、名片模板、面数）搬过去 */
export function copyPlayerRow(db, { oldGroup, oldUser, newGroup, newUser, dryRun = false }) {
  let src
  try {
    src = db
      .prepare('SELECT * FROM group_player_info WHERE group_id = ? AND user_id = ? ORDER BY id LIMIT 1')
      .get(oldGroup, oldUser)
  } catch {
    return { status: 'no-table' }
  }
  if (!src) return { status: 'none' }
  const exists = db
    .prepare('SELECT id FROM group_player_info WHERE group_id = ? AND user_id = ? LIMIT 1')
    .get(newGroup, newUser)
  if (exists) return { status: 'exists' }
  if (dryRun) return { status: 'created(dryRun)' }

  const cols = db
    .prepare('PRAGMA table_info(group_player_info)')
    .all()
    .map((c) => c.name)
    .filter((c) => c !== 'id')
  const values = cols.map((c) => (c === 'user_id' ? newUser : c === 'group_id' ? newGroup : src[c] ?? null))
  db.prepare(
    `INSERT INTO group_player_info (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...values)
  return { status: 'created' }
}

export function copyUserSheet(db, { oldUser, newUser, dryRun = false }) {
  const src = db
    .prepare("SELECT * FROM attrs WHERE id = ? AND (attrs_type IS NULL OR attrs_type = '' OR attrs_type = 'user')")
    .get(oldUser)
  if (!src) return { status: 'none' }
  if (db.prepare('SELECT id FROM attrs WHERE id = ?').get(newUser)) return { status: 'exists' }
  if (dryRun) return { status: 'created(dryRun)' }

  db.prepare(`INSERT INTO attrs (${COLUMNS}) VALUES (?, 'user', '', ?, ?, ?, 1, ?, ?, ?)`).run(
    newUser,
    src.name || '',
    src.owner_id || '',
    src.sheet_type || '',
    src.created_at || now(),
    now(),
    src.data ?? Buffer.from('{}')
  )
  return { status: 'created' }
}

/** 把指定卡绑到某个 群-用户 槽位；已有绑定不覆盖 */
export function bindCard(db, { group, user, cardId, dryRun = false }) {
  const id = sheetId(group, user)
  const ts = now()
  const row = db.prepare('SELECT id, binding_sheet_id FROM attrs WHERE id = ?').get(id)
  if (!row) {
    if (!dryRun) {
      db.prepare(`INSERT INTO attrs (${COLUMNS}) VALUES (?, 'group_user', ?, '', '', '', 1, ?, ?, ?)`).run(
        id,
        cardId,
        ts,
        ts,
        Buffer.from('{}')
      )
    }
    return 'created'
  }
  if (row.binding_sheet_id) return 'kept'
  if (!dryRun) db.prepare('UPDATE attrs SET binding_sheet_id = ?, updated_at = ? WHERE id = ?').run(cardId, ts, id)
  return 'bound'
}

/** 找出从指定旧群迁移出来的卡。 */
export function findMigratedCardsOfGroup(db, oldGroup) {
  const suffix = `-${groupShort(oldGroup)}`
  return db
    .prepare(
      `SELECT id, name, owner_id AS owner FROM attrs
       WHERE attrs_type = 'character' AND id LIKE ? AND name LIKE ?
       ORDER BY owner_id`
    )
    .all(`%${LEGACY_MARK}%`, `%${suffix}`)
}

/** 解绑：删迁移卡 + 清指向它们的绑定 */
export function removeMigrated(db, { owner, dryRun = false }) {
  const ids = db
    .prepare("SELECT id FROM attrs WHERE owner_id = ? AND attrs_type = 'character' AND id LIKE ?")
    .all(owner, `%${LEGACY_MARK}%`)
    .map((r) => r.id)

  if (!dryRun) {
    for (const id of ids) {
      db.prepare('UPDATE attrs SET binding_sheet_id = ? WHERE binding_sheet_id = ?').run('', id)
    }
    db.prepare("DELETE FROM attrs WHERE owner_id = ? AND attrs_type = 'character' AND id LIKE ?").run(
      owner,
      `%${LEGACY_MARK}%`
    )
  }
  return { removed: ids.length, dryRun }
}
