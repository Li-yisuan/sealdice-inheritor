import { isOfficial } from './ids.mjs'

export function listGroups(db) {
  const rows = db.prepare('SELECT id, data FROM group_info').all()
  return rows.map((row) => {
    let name = ''
    try {
      const json = JSON.parse(Buffer.from(row.data || []).toString('utf8'))
      name = json.groupName || json.group_name || ''
    } catch {
      /* 坏 JSON 当作没有名字 */
    }
    return { id: row.id, name, official: isOfficial(row.id) }
  })
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

/** 成员重叠索引：用于日志迁移的群匹配建议。 */
export function buildMemberIndex(db, users = {}) {
  let rows = []
  try {
    rows = db.prepare('SELECT DISTINCT group_id, user_id FROM group_player_info').all()
  } catch {
    rows = []
  }
  const old = new Map()
  const neu = new Map()
  const push = (map, key, qq) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(String(qq))
  }
  for (const row of rows) {
    if (isOfficial(row.group_id)) {
      const binding = users[row.user_id]
      if (binding?.qq) push(neu, row.group_id, binding.qq)
    } else if (/^QQ:/.test(String(row.user_id))) {
      push(old, row.group_id, String(row.user_id).slice(3))
    }
  }
  return { old, new: neu }
}

/** 计算群匹配状态与建议，不写库。 */
export function resolveMatches({ groups, maps = {}, memberIndex = null }) {
  const olds = groups.filter((g) => !g.official)
  const news = groups.filter((g) => g.official)
  const byName = new Map()
  for (const g of news) {
    const key = norm(g.name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(g.id)
  }

  return olds.map((old) => {
    if (maps[old.id]) return { oldId: old.id, oldName: old.name, newId: maps[old.id], status: 'mapped' }

    const suggestions = []
    if (memberIndex) {
      const oldSet = memberIndex.old.get(old.id) || new Set()
      for (const [newId, newSet] of memberIndex.new) {
        if (newSet.size < 2) continue
        let hit = 0
        for (const qq of newSet) if (oldSet.has(qq)) hit++
        if (hit >= 2 && hit / newSet.size >= 0.5)
          suggestions.push({ newId, reason: 'members', score: Math.round((hit / newSet.size) * 100) / 100, hit })
      }
    }

    if (!suggestions.length) {
      const hits = byName.get(norm(old.name)) || []
      if (hits.length === 1) suggestions.push({ newId: hits[0], reason: 'name', score: 0.3 })
      else if (hits.length > 1)
        return { oldId: old.id, oldName: old.name, status: 'ambiguous', candidates: hits.map((newId) => ({ newId, reason: 'name' })) }
    }

    suggestions.sort((a, b) => b.score - a.score)
    if (!suggestions.length) return { oldId: old.id, oldName: old.name, status: 'unmapped' }
    return { oldId: old.id, oldName: old.name, status: 'suggested', suggestion: suggestions[0], candidates: suggestions }
  })
}
