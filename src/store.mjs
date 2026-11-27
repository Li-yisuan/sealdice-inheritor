import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EMPTY = { users: {}, maps: {} }

/**
 * 绑定与群映射的持久化。
 *   users[openid] = { qq, owner, primary, at }
 *   maps[旧群ID]  = 新群ID     // 只给日志迁移用
 */
export class Store {
  constructor(file) {
    this.file = file
    this.data = this.#load()
  }

  #load() {
    if (!existsSync(this.file)) return structuredClone(EMPTY)
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      return {
        users: raw.users && typeof raw.users === 'object' ? raw.users : {},
        maps: raw.maps && typeof raw.maps === 'object' ? raw.maps : {},
      }
    } catch (err) {
      throw new Error(`绑定文件解析失败：${this.file}（${err.message}）`)
    }
  }

  #save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = join(dirname(this.file), `.${Date.now()}.tmp`)
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  user(openid) {
    return this.data.users[openid] ?? null
  }

  setUser(openid, record) {
    this.data.users[openid] = record
    this.#save()
    return record
  }

  deleteUser(openid) {
    const existed = Boolean(this.data.users[openid])
    delete this.data.users[openid]
    if (existed) this.#save()
    return existed
  }

  maps() {
    return { ...this.data.maps }
  }

  setMap(oldId, newId) {
    this.data.maps[oldId] = newId
    this.#save()
  }

  deleteMap(oldId) {
    const existed = Boolean(this.data.maps[oldId])
    delete this.data.maps[oldId]
    if (existed) this.#save()
    return existed
  }

  snapshot() {
    return structuredClone(this.data)
  }
}
