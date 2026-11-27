// ==UserScript==
// @name         旧号桥接
// @author       AcOH
// @version      1.0.0
// @description  旧 QQ 数据迁到官方 OpenID：邮箱验证后迁角色卡；群映射需管理权限并顺带迁日志
// @timestamp    2026-11-28
// @license      MIT
// @homepageURL  https://github.com/AcOH-Li/sealdice-inheritor
// @updateUrl    https://raw.githubusercontent.com/AcOH-Li/sealdice-inheritor/main/plugin/sealdice-inheritor.js
// @sealVersion  >=1.6.0
// ==/UserScript==

;(function () {
  const NAME = '旧号桥接'
  const VERSION = '1.0.0'
  const PENDING = 'pending_bind'

  let ext = seal.ext.find(NAME)
  if (!ext) {
    ext = seal.ext.new(NAME, 'AcOH', VERSION)
    seal.ext.register(ext)
  }

  seal.ext.registerStringConfig(ext, '后端地址', 'http://127.0.0.1:8787', '本地 bridge 地址', '连接')
  seal.ext.registerStringConfig(ext, '后端Token', '', '与 bridge --token 一致；没设就留空', '连接')
  seal.ext.registerStringConfig(ext, '发件邮箱', '', 'SMTP 发件邮箱（QQ 邮箱示例：你的QQ@qq.com）', '邮箱验证')
  seal.ext.registerStringConfig(ext, 'SMTP授权码', '', '不是登录密码，是邮箱设置里生成的授权码', '邮箱验证')
  seal.ext.registerStringConfig(ext, 'SMTP服务器', 'smtp.qq.com', 'QQ 邮箱：smtp.qq.com', '邮箱验证')
  seal.ext.registerIntConfig(ext, 'SMTP端口', 465, '465 一般为 SSL，587 走 STARTTLS', '邮箱验证')
  seal.ext.registerBoolConfig(ext, 'SMTP加密', true, '465 端口保持开启；587 端口请关闭（走 STARTTLS）', '邮箱验证')

  const busy = {}

  function cfg(key, fallback) {
    try {
      return String(seal.ext.getStringConfig(ext, key) || fallback)
    } catch (e) {
      return fallback
    }
  }

  function cfgInt(key, fallback) {
    try {
      return Number(seal.ext.getIntConfig(ext, key))
    } catch (e) {
      return fallback
    }
  }

  function cfgBool(key, fallback) {
    try {
      return Boolean(seal.ext.getBoolConfig(ext, key))
    } catch (e) {
      return fallback
    }
  }

  function base() {
    return cfg('后端地址', '').replace(/\/+$/, '')
  }

  function reply(ctx, msg, text) {
    seal.replyToSender(ctx, msg, String(text).slice(0, 1800))
  }

  function api(path, options) {
    return Promise.resolve().then(() => {
      const root = base()
      if (!root) throw new Error('未配置后端地址')
      const headers = { 'content-type': 'application/json' }
      const token = cfg('后端Token', '')
      if (token) headers.authorization = 'Bearer ' + token
      return fetch(root + path, {
        method: (options && options.method) || 'GET',
        headers,
        body: options && options.body ? JSON.stringify(options.body) : undefined,
      }).then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((data) => {
            if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status)
            return data
          })
      )
    })
  }

  function bg(ctx, msg, promise, onOk) {
    promise
      .then((data) => onOk(data, ctx, msg))
      .catch((err) => reply(ctx, msg, '操作失败：' + err.message))
  }

  function pushSmtp() {
    return api('/api/smtp', {
      method: 'POST',
      body: {
        sender_email: cfg('发件邮箱', ''),
        smtp_password: cfg('SMTP授权码', ''),
        smtp_host: cfg('SMTP服务器', 'smtp.qq.com'),
        smtp_port: cfgInt('SMTP端口', 465),
        smtp_ssl: cfgBool('SMTP加密', true),
      },
    })
  }

  function summary(r) {
    const lines = ['迁移完成']
    lines.push('旧角色卡：' + (Array.isArray(r.copied) ? r.copied.length : 0) + ' 张')
    const made = Array.isArray(r.converted) ? r.converted : []
    if (made.length) {
      lines.push('群内属性表 → 全局卡：' + made.length + ' 张')
      made.slice(0, 8).forEach((x) => lines.push('- ' + x.name))
      if (made.length > 8) lines.push('- …共 ' + made.length + ' 张')
    }
    const bound = Array.isArray(r.bound) ? r.bound : []
    if (bound.length) lines.push('已绑定到 ' + bound.length + ' 个已映射群')
    if (r.skippedSheets && r.skippedSheets.length) lines.push('跳过空表：' + r.skippedSheets.length + ' 张')
    if (r.primary) lines.push('默认卡：' + r.primary.name)
    return lines.join('\n')
  }

  function setPending(value) {
    try {
      ext.storageSet(PENDING, value ? JSON.stringify(value) : '')
    } catch (e) {
      console.log('[旧号桥接] storage 失败', e)
    }
  }

  function getPending() {
    try {
      const raw = ext.storageGet(PENDING) || ''
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  }

  // ---- .qqbind：发起验证 ----
  const cmdBind = seal.ext.newCmdItemInfo()
  cmdBind.name = 'qqbind'
  cmdBind.help = '.qqbind <旧QQ号> [目标owner]：给旧QQ邮箱发验证码，验证后迁移'
  cmdBind.solve = (ctx, msg, args) => {
    const qq = String(args.getArgN(1) || '').trim()
    if (!/^\d{5,12}$/.test(qq)) {
      reply(ctx, msg, '用法：.qqbind <旧QQ号>，例如 .qqbind 123456789')
      return seal.ext.newCmdExecuteResult(true)
    }
    const openid = String(msg.sender.userId)
    if (busy[openid]) {
      reply(ctx, msg, '上一个请求还在处理。')
      return seal.ext.newCmdExecuteResult(true)
    }
    busy[openid] = true
    const owner = String(args.getArgN(2) || '').trim()

    pushSmtp()
      .then(() =>
        api('/api/bind/request', {
          method: 'POST',
          body: { openid, qq, group: String(msg.groupId || ''), owner: owner || undefined },
        })
      )
      .then((r) => {
        delete busy[openid]
        if (r.needCode === false) {
          reply(ctx, msg, summary(r.result))
          return
        }
        setPending({ openid, qq, owner, at: Date.now() })
        reply(
          ctx,
          msg,
          '验证码已发送至 ' + r.email + '，' + Math.round(r.expiresIn / 60) + ' 分钟内有效。\n发 .qqverify <6位验证码> 完成迁移。'
        )
      })
      .catch((err) => {
        delete busy[openid]
        reply(ctx, msg, '发起失败：' + err.message)
      })
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqbind'] = cmdBind

  // ---- .qqverify ----
  const cmdVerify = seal.ext.newCmdItemInfo()
  cmdVerify.name = 'qqverify'
  cmdVerify.help = '.qqverify <验证码>：校验邮箱验证码并完成迁移'
  cmdVerify.solve = (ctx, msg, args) => {
    const code = String(args.getArgN(1) || '').trim()
    if (!/^\d{6}$/.test(code)) {
      reply(ctx, msg, '验证码是 6 位数字。')
      return seal.ext.newCmdExecuteResult(true)
    }
    const pending = getPending()
    const openid = String(msg.sender.userId)
    if (!pending || pending.openid !== openid) {
      reply(ctx, msg, '没有待验证的绑定，请先 .qqbind <旧QQ号>。')
      return seal.ext.newCmdExecuteResult(true)
    }
    if (Date.now() - pending.at > 10 * 60 * 1000) {
      setPending(null)
      reply(ctx, msg, '这次申请已过期，请重新 .qqbind。')
      return seal.ext.newCmdExecuteResult(true)
    }

    bg(
      ctx,
      msg,
      api('/api/bind/verify', {
        method: 'POST',
        body: { openid, qq: pending.qq, code, group: String(msg.groupId || ''), owner: pending.owner || undefined },
      }),
      (r, c, m) => {
        setPending(null)
        reply(c, m, summary(r))
      }
    )
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqverify'] = cmdVerify

  // ---- .qqunbind ----
  const cmdUnbind = seal.ext.newCmdItemInfo()
  cmdUnbind.name = 'qqunbind'
  cmdUnbind.help = '.qqunbind：删除迁移出来的卡（旧数据不动）'
  cmdUnbind.solve = (ctx, msg) => {
    bg(ctx, msg, api('/api/unbind', { method: 'POST', body: { openid: String(msg.sender.userId) } }), (r, c, m) => {
      reply(c, m, r.hadBinding ? '已解绑，删除 ' + r.removed + ' 张迁移卡。旧数据未改动。' : '没有绑定记录。')
    })
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqunbind'] = cmdUnbind

  // ---- .qqstatus ----
  const cmdStatus = seal.ext.newCmdItemInfo()
  cmdStatus.name = 'qqstatus'
  cmdStatus.help = '.qqstatus：查看绑定与卡数'
  cmdStatus.solve = (ctx, msg) => {
    const q =
      '/api/inspect?openid=' +
      encodeURIComponent(String(msg.sender.userId)) +
      '&group=' +
      encodeURIComponent(String(msg.groupId || ''))
    bg(ctx, msg, api(q), (r, c, m) => {
      const lines = ['账号：' + r.openid, '绑定：' + (r.binding ? 'QQ ' + r.binding.qq : '未绑定'), '卡数：' + r.cards.length]
      if (r.sheet) lines.push('本群默认卡：' + (r.sheet.missing ? '未设置' : r.sheet.binding || '未设置'))
      reply(c, m, lines.join('\n'))
    })
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqstatus'] = cmdStatus

  // ---- .qqhealth ----
  const cmdHealth = seal.ext.newCmdItemInfo()
  cmdHealth.name = 'qqhealth'
  cmdHealth.help = '.qqhealth：检查后端与验证配置'
  cmdHealth.solve = (ctx, msg) => {
    bg(ctx, msg, api('/api/health'), (r, c, m) => {
      reply(
        c,
        m,
        '后端正常\n数据库：' + r.db + '\n日志库：' + (r.logs || '(未配置)') + '\n邮箱验证：' + (r.requireVerify ? '开启' : '关闭') + '\nSMTP：' + (r.smtp ? '已配置' : '未配置')
      )
    })
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqhealth'] = cmdHealth

  // ---- .qqmap：管理员，群映射 + 补绑 + 迁日志 ----
  const cmdMap = seal.ext.newCmdItemInfo()
  cmdMap.name = 'qqmap'
  cmdMap.help = '.qqmap [旧群号]：查看/设置群映射（管理员，设置时补绑卡并迁日志）'
  cmdMap.solve = (ctx, msg, args) => {
    if (ctx.privilegeLevel < 50) {
      reply(ctx, msg, '需要管理员权限。')
      return seal.ext.newCmdExecuteResult(true)
    }
    const arg = String(args.getArgN(1) || '').trim()
    if (!arg) {
      bg(ctx, msg, api('/api/groups'), (r, c, m) => {
        const list = Array.isArray(r.matches) ? r.matches : []
        if (!list.length) return reply(c, m, '没有旧群记录。')
        const icon = { mapped: '✅', suggested: '💡', ambiguous: '⚠️', unmapped: '❌' }
        const lines = list.map((x) => {
          let right = x.newId
          if (!right && x.suggestion) right = x.suggestion.newId + '（建议，未生效）'
          return (icon[x.status] || '?') + ' ' + (x.oldName || x.oldId) + ' → ' + (right || x.status)
        })
        reply(c, m, '群映射（只影响日志与补绑）：\n' + lines.join('\n') + '\n\n确认就在对应群发 .qqmap <旧群号>')
      })
    } else {
      const oldId = arg.includes(':') ? arg : 'QQ-Group:' + arg
      bg(
        ctx,
        msg,
        api('/api/groups/map', {
          method: 'POST',
          body: { oldId, newId: String(msg.groupId || ''), admin: true },
        }),
        (r, c, m) => {
          const lines = ['群映射：' + r.oldGroup + ' → ' + r.newGroup, '补绑卡：' + (r.bound ? r.bound.length : 0) + ' 张']
          if (r.players && r.players.length) lines.push('玩家档案：' + r.players.length + ' 条')
          if (r.log) lines.push('日志：' + r.log.logsMoved + ' 个 / 记录 ' + r.log.itemsMoved + ' 条')
          else if (r.logError) lines.push('日志失败：' + r.logError)
          reply(c, m, lines.join('\n'))
        }
      )
    }
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqmap'] = cmdMap

  // ---- .qqlog ----
  const cmdLog = seal.ext.newCmdItemInfo()
  cmdLog.name = 'qqlog'
  cmdLog.help = '.qqlog [all|run]：预览/补迁日志（管理员）'
  cmdLog.solve = (ctx, msg, args) => {
    if (ctx.privilegeLevel < 50) {
      reply(ctx, msg, '需要管理员权限。')
      return seal.ext.newCmdExecuteResult(true)
    }
    const action = String(args.getArgN(1) || '').trim().toLowerCase()
    const group = String(msg.groupId || '')

    if (action === 'all') {
      bg(ctx, msg, api('/api/logs', { method: 'POST', body: { all: true } }), (r, c, m) => {
        const list = Array.isArray(r.results) ? r.results : []
        if (!list.length) return reply(c, m, '还没有任何群映射，先 .qqmap <旧群号>。')
        const lines = list.map((x) =>
          x.status === 'ok'
            ? '✅ ' + (x.oldName || x.oldId) + '：' + x.logsMoved + ' 个日志'
            : '❌ ' + (x.oldName || x.oldId) + '：' + (x.error || x.status)
        )
        reply(c, m, '日志迁移：\n' + lines.join('\n'))
      })
      return seal.ext.newCmdExecuteResult(true)
    }

    if (action === 'run') {
      bg(ctx, msg, api('/api/logs', { method: 'POST', body: { group } }), (r, c, m) =>
        reply(c, m, '已迁移：日志 ' + r.logsMoved + ' 个，记录 ' + r.itemsMoved + ' 条')
      )
      return seal.ext.newCmdExecuteResult(true)
    }

    bg(ctx, msg, api('/api/logs?group=' + encodeURIComponent(group)), (r, c, m) => {
      const lines = [
        '旧群：' + r.from,
        '当前群：' + r.to,
        '旧日志：' + r.before.old.logs + ' 个 / ' + r.before.old.items + ' 条',
        '冲突：' + (r.collisions.length ? r.collisions.join('、') : '无'),
      ]
      reply(c, m, lines.join('\n') + (r.collisions.length ? '' : '\n确认无误后 .qqlog run'))
    })
    return seal.ext.newCmdExecuteResult(true)
  }
  ext.cmdMap['qqlog'] = cmdLog

  ext.onLoad = () => console.log('[旧号桥接] v' + VERSION + ' 后端=' + (base() || '(未配置)'))
})()


