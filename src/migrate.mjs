import { tx } from './db.mjs'
import { oldUserOf, groupOfSheet } from './ids.mjs'
import { copyCharacters, findGroupSheets, sheetToCard, copyUserSheet, bindCard, copyPlayerRow } from './cards.mjs'

/** 用户映射：角色卡与群内表转全局卡；已映射的群直接绑卡并复制玩家档案。 */
export function migrateUser(db, { qq, newUser, maps = {}, dryRun = false }) {
  const oldUser = oldUserOf(qq)
  if (!newUser) throw new Error('缺少 openid')
  if (oldUser === newUser) throw new Error('新旧身份相同')

  return tx(
    db,
    () => {
      const copied = copyCharacters(db, { oldUser, newUser, qq, dryRun })
      const sheets = findGroupSheets(db, oldUser)

      const converted = []
      const skippedSheets = []
      for (const sheet of sheets) {
        const card = sheetToCard(db, {
          sheet,
          oldGroup: groupOfSheet(sheet.id, oldUser),
          newUser,
          dryRun,
        })
        if (card.status === 'skipped-empty') skippedSheets.push(card.from)
        else converted.push(card)
      }

      const bound = []
      const players = []
      for (const card of converted) {
        const newGroup = maps[card.from]
        if (!newGroup) continue
        const status = bindCard(db, { group: newGroup, user: newUser, cardId: card.id, dryRun })
        bound.push({ from: card.from, group: newGroup, card: card.id, name: card.name, status })
      }
      for (const [oldGroup, newGroup] of Object.entries(maps)) {
        const p = copyPlayerRow(db, { oldGroup, oldUser, newGroup, newUser, dryRun })
        if (p.status !== 'none' && p.status !== 'no-table') players.push({ from: oldGroup, to: newGroup, ...p })
      }

      const userSheet = copyUserSheet(db, { oldUser, newUser, dryRun })
      const primary = converted[0] || copied[0] || null

      return { oldUser, newUser, copied, converted, skippedSheets, bound, players, userSheet, primary, dryRun }
    },
    { dryRun }
  )
}
