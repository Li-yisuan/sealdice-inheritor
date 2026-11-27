import { randomInt, timingSafeEqual } from 'node:crypto'

/** 内存验证码：5 分钟有效、限次、限频。 */
export class Verifier {
  constructor({ ttl = 300, maxAttempts = 5, minInterval = 60, maxPerHour = 5 } = {}) {
    this.ttl = ttl
    this.maxAttempts = maxAttempts
    this.minInterval = minInterval
    this.maxPerHour = maxPerHour
    this.pending = new Map()
    this.rate = new Map()
  }

  #rateOk(key) {
    const now = Date.now()
    const r = this.rate.get(key)
    if (!r || now - r.window > 3600_000) {
      this.rate.set(key, { window: now, count: 1, last: now })
      return true
    }
    if (now - r.last < this.minInterval * 1000) return false
    if (r.count >= this.maxPerHour) return false
    r.count++
    r.last = now
    return true
  }

  /** 发码；返回 { code, expiresIn }，由调用方负责投递 */
  issue(key) {
    if (!this.#rateOk(key)) throw new Error('发送太频繁，请稍后再试')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.pending.set(key, {
      code,
      expires: Date.now() + this.ttl * 1000,
      attempts: 0,
    })
    return { code, expiresIn: this.ttl }
  }

  /** 校验；成功即销毁，失败累计次数 */
  check(key, input) {
    const item = this.pending.get(key)
    if (!item) return { ok: false, reason: '没有待验证的请求，请先发 .qqbind' }
    if (Date.now() > item.expires) {
      this.pending.delete(key)
      return { ok: false, reason: '验证码已过期，请重新获取' }
    }
    item.attempts++
    if (item.attempts > this.maxAttempts) {
      this.pending.delete(key)
      return { ok: false, reason: '错误次数过多，请重新获取' }
    }
    const a = Buffer.from(String(input).padEnd(item.code.length).slice(0, item.code.length))
    const b = Buffer.from(item.code)
    const same = a.length === b.length && timingSafeEqual(a, b)
    if (!same) {
      return { ok: false, reason: `验证码错误，还可以试 ${Math.max(0, this.maxAttempts - item.attempts)} 次` }
    }
    this.pending.delete(key)
    return { ok: true }
  }

  has(key) {
    return this.pending.has(key)
  }
}
