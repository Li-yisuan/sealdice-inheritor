/** 所有 ID 约定集中在这里，避免各处手拼字符串 */

export const LEGACY_MARK = '--qqlegacy--'

/** 旧接入的用户 ID */
export function oldUserOf(qq) {
  return `QQ:${String(qq).trim()}`
}

/** 旧接入的群 ID；传纯数字则补前缀 */
export function oldGroupOf(value) {
  const s = String(value ?? '').trim()
  if (!s) throw new Error('缺少旧群号')
  return s.includes(':') ? s : `QQ-Group:${s}`
}

/** group_user 表的 id：<群ID>-<用户ID> */
export function sheetId(group, user) {
  return `${group}-${user}`
}

/** 从 `<群ID>-<用户ID>` 反推群 ID */
export function groupOfSheet(id, user) {
  const suffix = `-${user}`
  const s = String(id)
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : ''
}

/** 群号短名：QQ-Group:789012 -> 789012 */
export function groupShort(groupId) {
  const s = String(groupId || '')
  const i = s.lastIndexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}

/** 官方接入的 ID 以 OpenQQ 开头 */
export function isOfficial(id) {
  return /^OpenQQ/i.test(String(id || ''))
}

export function isLegacyUser(id) {
  return /^QQ:/.test(String(id || ''))
}
