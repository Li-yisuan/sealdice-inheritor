import { existsSync } from 'node:fs'
import { openDb, assertSchema, assertLogSchema } from './db.mjs'
import { backupDb } from './backup.mjs'
import { Store } from './store.mjs'
import { migrateUser } from './migrate.mjs'
import {
  listCharacters,
  listOwners,
  removeMigrated,
  findMigratedCardsOfGroup,
  bindCard,
  copyPlayerRow,
  countCharacters,
  findGroupSheets,
} from './cards.mjs'
import { listGroups, buildMemberIndex, resolveMatches } from './groups.mjs'
import { migrateLogs, countLogs, findCollisions, normalizeGroup } from './logs.mjs'
import { sheetId, oldUserOf } from './ids.mjs'
import { sendMail, maskEmail } from './smtp.mjs'
import { Verifier } from './verify.mjs'

export class Bridge {
  constructor({ dbPath, logsPath = '', storePath, mailer = sendMail, requireVerify = true, verifier } = {}) {
    this.dbPath = dbPath
    this.db = openDb(dbPath)
    assertSchema(this.db)

    this.logsPath = logsPath
    this.logs = null
    if (logsPath) {
      if (!existsSync(logsPath)) throw new Error(`日志库不存在：${logsPath}`)
      this.logs = openDb(logsPath)
      assertLogSchema(this.logs)
    }
    this.store = new Store(storePath)
    this.mailer = mailer
    this.requireVerify = requireVerify
    this.verifier = verifier || new Verifier()
    this.smtp = null
  }

  close() {
    for (const db of [this.db, this.logs]) {
      try {
        db?.close()
      } catch {
        /* ignore */
      }
    }
  }

  requireLogs() {
    if (!this.logs) throw new Error('未配置日志库（--logs-db / SD_LOGS_DB）')
    return this.logs
  }

  health() {
    return {
      ok: true,
      db: this.dbPath,
      logs: this.logsPath || null,
      requireVerify: this.requireVerify,
      smtp: Boolean(this.smtp),
    }
  }

  state() {
    return {
      dbPath: this.dbPath,
      logsPath: this.logsPath || null,
      requireVerify: this.requireVerify,
      smtp: this.smtp ? { host: this.smtp.host, port: this.smtp.port, from: maskEmail(this.smtp.from) } : null,
      bindings: this.store.snapshot(),
      owners: listOwners(this.db),
      groups: this.groups(),
    }
  }

  inspect({ openid = '', owner = '', group = '' } = {}) {
    const binding = openid ? this.store.user(openid) : null
    const target = owner || binding?.owner || openid
    const cards = target ? listCharacters(this.db, target) : []
    let sheet = null
    if (group && target) {
      const id = sheetId(group, target)
      sheet =
        this.db
          .prepare('SELECT id, binding_sheet_id AS binding, name, is_hidden AS hidden FROM attrs WHERE id = ?')
          .get(id) || { id, binding: '', missing: true }
    }
    return { openid, owner: target, binding, cards, sheet, groups: this.groups() }
  }

  setSmtp(cfg = {}) {
    const host = String(cfg.smtp_host || '').trim()
    const port = Number(cfg.smtp_port || 465)
    const from = String(cfg.sender_email || '').trim()
    const pass = String(cfg.smtp_password || '')
    if (!host || !port || !from || !pass) throw new Error('SMTP 配置不完整（发件邮箱 / 服务器 / 端口 / 授权码）')
    if (!from.includes('@')) throw new Error('发件邮箱格式不正确')
    this.smtp = { host, port, secure: cfg.smtp_ssl !== false, from, user: String(cfg.smtp_user || from), pass }
    return { ok: true, host, port, from: maskEmail(from) }
  }

  #verifyKey(openid, qq) {
    return `${openid}|${qq}`
  }

  /** 第一段：发验证码（未开启验证时直接迁移） */
  async requestBind({ openid, qq, group = '', owner = '', by = 'self' }) {
    if (!openid) throw new Error('缺少 openid')
    if (!/^\d{5,12}$/.test(String(qq ?? ''))) throw new Error('QQ 号格式不对')

    if (!this.requireVerify) {
      return { needCode: false, result: this.bind({ openid, qq, group, owner, by }) }
    }
    if (!this.smtp) throw new Error('后端未配置 SMTP，无法发送验证码（先在插件里填邮箱设置）')

    const oldUser = oldUserOf(qq)
    const hasData = countCharacters(this.db, oldUser) > 0 || findGroupSheets(this.db, oldUser).length > 0
    if (!hasData) throw new Error('该旧 QQ 在数据库里没有可迁移的数据')

    const { code, expiresIn } = this.verifier.issue(this.#verifyKey(openid, qq))
    const to = `${qq}@qq.com`
    await this.mailer({
      ...this.smtp,
      to,
      subject: '旧号迁移验证码',
      text: [
        '你在海豹上发起了旧 QQ 数据迁移。',
        '',
        `旧 QQ：${qq}`,
        `验证码：${code}`,
        `有效期：${Math.round(expiresIn / 60)} 分钟`,
        '',
        '如果不是你本人操作，请忽略这封邮件。',
      ].join('\n'),
    })
    return { needCode: true, email: maskEmail(to), expiresIn }
  }

  /** 第二段：校验验证码，通过后执行迁移 */
  async verifyBind({ openid, qq, code, group = '', owner = '', by = 'self' }) {
    if (!openid) throw new Error('缺少 openid')
    const result = this.verifier.check(this.#verifyKey(openid, qq), code)
    if (!result.ok) throw new Error(result.reason)
    return this.bind({ openid, qq, group, owner, by })
  }

  bind({ openid, qq, group = '', owner = '', by = 'self', dryRun = false, backup = true }) {
    if (!openid) throw new Error('缺少 openid')
    if (!/^\d{5,12}$/.test(String(qq ?? ''))) throw new Error('QQ 号格式不对')

    const newUser = owner || openid
    const backupPath = !dryRun && backup ? backupDb(this.db, this.dbPath) : null
    const result = migrateUser(this.db, { qq, newUser, maps: this.store.maps(), dryRun })

    if (!dryRun) {
      this.store.setUser(openid, {
        qq: String(qq),
        owner: newUser,
        group,
        by,
        at: Math.floor(Date.now() / 1000),
      })
    }
    return { ...result, backup: backupPath }
  }

  unbind({ openid, dryRun = false }) {
    if (!openid) throw new Error('缺少 openid')
    const binding = this.store.user(openid)
    const owner = binding?.owner || openid
    const backupPath = !dryRun ? backupDb(this.db, this.dbPath) : null
    const result = removeMigrated(this.db, { owner, dryRun })
    if (!dryRun) this.store.deleteUser(openid)
    return { ...result, owner, hadBinding: Boolean(binding), backup: backupPath }
  }

  groups() {
    const all = listGroups(this.db)
    const maps = this.store.maps()
    const matches = resolveMatches({
      groups: all,
      maps,
      memberIndex: buildMemberIndex(this.db, this.store.snapshot().users),
    })
    return { groups: all, maps, matches }
  }

  /** 群映射：记录映射、补绑卡、复制玩家档案、迁移日志。 */
  mapGroup({ oldId, newId, dryRun = false, backup = true }) {
    if (!oldId || !newId) throw new Error('缺少 oldId / newId')
    const oldGroup = normalizeGroup(oldId)
    const newGroup = normalizeGroup(newId)

    const backups = []
    if (!dryRun && backup) backups.push(backupDb(this.db, this.dbPath))

    if (!dryRun) this.store.setMap(oldGroup, newGroup)

    const cards = findMigratedCardsOfGroup(this.db, oldGroup)
    const bound = cards.map((card) => ({
      owner: card.owner,
      name: card.name,
      status: bindCard(this.db, { group: newGroup, user: card.owner, cardId: card.id, dryRun }),
    }))

    const ownerToQq = new Map()
    for (const [openid, info] of Object.entries(this.store.snapshot().users)) {
      ownerToQq.set(info.owner || openid, info.qq)
    }
    const players = []
    for (const card of cards) {
      const qq = ownerToQq.get(card.owner)
      if (!qq) continue
      const p = copyPlayerRow(this.db, {
        oldGroup,
        oldUser: `QQ:${qq}`,
        newGroup,
        newUser: card.owner,
        dryRun,
      })
      if (p.status !== 'none' && p.status !== 'no-table') players.push({ owner: card.owner, ...p })
    }

    let log = null
    let logError = null
    let collisions = null
    try {
      const logsDb = this.requireLogs()
      if (!dryRun && backup) backups.push(backupDb(logsDb, this.logsPath))
      log = migrateLogs(logsDb, { oldGroup, newGroup, dryRun })
    } catch (err) {
      logError = err.message
      collisions = err.collisions || null
    }

    return { oldGroup, newGroup, bound, players, log, logError, collisions, backups, dryRun }
  }

  previewLogs({ group, oldGroup }) {
    const db = this.requireLogs()
    const from = normalizeGroup(oldGroup || this.store.maps()[group])
    const to = normalizeGroup(group)
    return {
      from,
      to,
      collisions: findCollisions(db, from, to),
      before: { old: countLogs(db, from), current: countLogs(db, to) },
    }
  }

  migrateLogsFor({ group, oldGroup, dryRun = false }) {
    const db = this.requireLogs()
    const from = normalizeGroup(oldGroup || this.store.maps()[group])
    const to = normalizeGroup(group)
    return migrateLogs(db, { oldGroup: from, newGroup: to, dryRun })
  }

  migrateAllLogs({ dryRun = false } = {}) {
    const db = this.requireLogs()
    const maps = this.store.maps()
    const names = new Map(listGroups(this.db).map((g) => [g.id, g.name]))
    const results = []
    for (const [oldId, newId] of Object.entries(maps)) {
      try {
        const r = migrateLogs(db, { oldGroup: oldId, newGroup: newId, dryRun })
        results.push({ oldId, oldName: names.get(oldId) || '', newId, status: 'ok', ...r })
      } catch (err) {
        results.push({ oldId, oldName: names.get(oldId) || '', newId, status: 'error', error: err.message, collisions: err.collisions })
      }
    }
    return { dryRun, results }
  }
}
