import { copyFileSync, existsSync } from 'node:fs'

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 写库前备份：VACUUM INTO，失败退回文件复制。 */
export function backupDb(db, path) {
  const target = `${path}.before-${stamp()}.bak`
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    return target
  } catch {
    copyFileSync(path, target)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(path + suffix)) copyFileSync(path + suffix, target + suffix)
    }
    return target
  }
}
