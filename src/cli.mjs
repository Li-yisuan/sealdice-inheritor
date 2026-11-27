#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Bridge } from './service.mjs'
import { createServerFor } from './server.mjs'

function parseFlags(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

function config(flags) {
  const dbPath = flags.db || process.env.SD_DB
  const storePath = flags.store || process.env.SD_STORE || 'data/bindings.json'
  if (!dbPath) throw new Error('缺少数据库路径：--db <path> 或 SD_DB')
  if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`)
  const logsPath = flags['logs-db'] || process.env.SD_LOGS_DB || join(dirname(dbPath), 'data-logs.db')
  return { dbPath, logsPath, storePath }
}

const HELP = `用法：node src/cli.mjs <命令> [选项]

命令：
  serve                         起本地 HTTP 服务（插件用）
  state                         绑定表 + 卡分布 + 群映射建议
  inspect --openid <id> [--group <gid>] [--owner <id>]
  bind --openid <id> --qq <qq> [--group <gid>] [--owner <id>]
                                一次迁移：旧卡 + 群内表转全局卡 + 补默认绑定
  unbind --openid <id>          删除迁移出来的卡
  groups                        日志用的群映射建议
  map --old <旧群ID> --new <新群ID>
  logs [--all] [--group <gid>] [--old-group <id>] [--dry-run]

通用：
  --db <path>      海豹 data.db（或 SD_DB）
  --logs-db <path> 海豹 data-logs.db（默认同目录，或 SD_LOGS_DB）
  --store <path>   绑定文件（默认 data/bindings.json，或 SD_STORE）
  --dry-run        只演练不落库
  --no-backup      跳过写前备份（默认会备份）
  --no-verify      serve 时关闭邮箱验证（仅限受控内网环境）
  --port <n>       serve 端口（默认 8787，或 SD_PORT）
  --token <str>    API token（或 SD_TOKEN）`

const [cmd, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP)
  process.exit(0)
}

let bridge
try {
  const { dbPath, logsPath, storePath } = config(flags)
  const useLogs = existsSync(logsPath)
  if (!useLogs) console.warn(`未找到日志库 ${logsPath}，日志功能禁用（可用 --logs-db 指定）`)
  bridge = new Bridge({
    dbPath,
    logsPath: useLogs ? logsPath : '',
    storePath,
    requireVerify: !flags['no-verify'],
  })

  if (cmd === 'serve') {
    const port = Number(flags.port || process.env.SD_PORT || 8787)
    const host = String(flags.host || '127.0.0.1')
    const token = String(flags.token || process.env.SD_TOKEN || '')
    createServerFor({ bridge, token }).listen(port, host, () => {
      console.log(`bridge 已启动：http://${host}:${port}`)
      console.log(`数据库：${dbPath}`)
      console.log(`日志库：${useLogs ? logsPath : '(禁用)'}`)
      console.log(`绑定文件：${storePath}`)
      if (!token) console.warn('未设置 token，仅建议监听 127.0.0.1')
    })
    const stop = () => {
      bridge.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } else if (cmd === 'state') {
    console.log(JSON.stringify(bridge.state(), null, 2))
    bridge.close()
  } else if (cmd === 'inspect') {
    console.log(
      JSON.stringify(
        bridge.inspect({ openid: flags.openid || '', owner: flags.owner || '', group: flags.group || '' }),
        null,
        2
      )
    )
    bridge.close()
  } else if (cmd === 'bind') {
    console.log(
      JSON.stringify(
        bridge.bind({
          openid: flags.openid,
          qq: flags.qq,
          group: flags.group || '',
          owner: flags.owner || '',
          dryRun: Boolean(flags['dry-run']),
          backup: !flags['no-backup'],
        }),
        null,
        2
      )
    )
    bridge.close()
  } else if (cmd === 'unbind') {
    console.log(JSON.stringify(bridge.unbind({ openid: flags.openid, dryRun: Boolean(flags['dry-run']) }), null, 2))
    bridge.close()
  } else if (cmd === 'groups') {
    console.log(JSON.stringify(bridge.groups(), null, 2))
    bridge.close()
  } else if (cmd === 'map') {
    console.log(JSON.stringify(bridge.mapGroup({ oldId: flags.old, newId: flags.new }), null, 2))
    bridge.close()
  } else if (cmd === 'logs') {
    const out = flags.all
      ? bridge.migrateAllLogs({ dryRun: Boolean(flags['dry-run']) })
      : flags['dry-run']
        ? bridge.previewLogs({ group: flags.group, oldGroup: flags['old-group'] })
        : bridge.migrateLogsFor({ group: flags.group, oldGroup: flags['old-group'], dryRun: false })
    console.log(JSON.stringify(out, null, 2))
    bridge.close()
  } else {
    console.error(`未知命令：${cmd}`)
    process.exit(2)
  }
} catch (err) {
  if (bridge) bridge.close()
  console.error(`[bridge] ${err.message}`)
  if (err.collisions) console.error(`冲突：${err.collisions.join(', ')}`)
  process.exit(1)
}





