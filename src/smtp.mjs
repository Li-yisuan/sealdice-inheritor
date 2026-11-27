import net from 'node:net'
import tls from 'node:tls'

const CRLF = '\r\n'

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
}

/** 逐行读取 SMTP 响应；等待式实现，调用方按顺序 await */
function makeReader(socket) {
  let buffer = ''
  let wake = null
  let closed = null
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    if (wake) {
      const fn = wake
      wake = null
      fn()
    }
  })
  socket.on('close', () => {
    closed = new Error('SMTP 连接已关闭')
    if (wake) wake()
  })
  socket.on('error', (err) => {
    closed = err
    if (wake) wake()
  })

  async function line() {
    while (!buffer.includes('\n')) {
      if (closed) throw closed
      await new Promise((resolve) => {
        wake = resolve
      })
    }
    const idx = buffer.indexOf('\n')
    const text = buffer.slice(0, idx).replace(/\r$/, '')
    buffer = buffer.slice(idx + 1)
    return text
  }

  async function reply() {
    const lines = []
    for (;;) {
      const text = await line()
      lines.push(text)
      if (/^\d{3} /.test(text)) return { code: Number(text.slice(0, 3)), text: lines.join('\n') }
    }
  }

  return { line, reply }
}

function connect({ host, port, secure, servername }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: servername || host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket))
    socket.once('error', reject)
    socket.setTimeout(30000, () => reject(new Error('SMTP 连接超时')))
  })
}

async function command(socket, reader, text, expect) {
  socket.write(text + CRLF)
  const res = await reader.reply()
  if (expect && res.code !== expect) throw new Error(`SMTP 期望 ${expect}，收到 ${res.code}：${res.text}`)
  return res
}

function buildMessage({ from, to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
  ]
  const body = b64(text)
    .replace(/(.{76})/g, '$1\r\n')
  return headers.join(CRLF) + CRLF + body + CRLF
}

/** SMTP 发送：465 隐式 TLS，25/587 STARTTLS，AUTH LOGIN。 */
export async function sendMail({ host, port, secure = true, user, pass, from, to, subject, text }) {
  if (!host || !port) throw new Error('缺少 SMTP 服务器或端口')
  if (!user || !pass) throw new Error('缺少 SMTP 账号或授权码')

  let socket = await connect({ host, port, secure })
  let reader = makeReader(socket)

  try {
    let res = await reader.reply()
    if (res.code !== 220) throw new Error(`SMTP 握手失败：${res.text}`)

    const ehlo = async () => {
      socket.write(`EHLO sealdice-inheritor${CRLF}`)
      res = await reader.reply()
      if (res.code !== 250) throw new Error(`EHLO 失败：${res.text}`)
      return res.text
    }

    let capabilities = await ehlo()

    if (!secure && /STARTTLS/i.test(capabilities)) {
      await command(socket, reader, 'STARTTLS', 220)
      socket = await new Promise((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: host }, () => resolve(upgraded))
        upgraded.once('error', reject)
      })
      reader = makeReader(socket)
      capabilities = await ehlo()
    }

    if (/AUTH/i.test(capabilities)) {
      await command(socket, reader, 'AUTH LOGIN', 334)
      await command(socket, reader, b64(user), 334)
      await command(socket, reader, b64(pass), 235)
    }

    await command(socket, reader, `MAIL FROM:<${from}>`, 250)
    await command(socket, reader, `RCPT TO:<${to}>`, 250)
    await command(socket, reader, 'DATA', 354)
    const message = buildMessage({ from, to, subject, text })
    socket.write(message + '.' + CRLF)
    res = await reader.reply()
    if (res.code !== 250) throw new Error(`发送失败：${res.text}`)
    await command(socket, reader, 'QUIT', 221).catch(() => {})
  } finally {
    socket.destroy()
  }
}

export function maskEmail(addr) {
  const s = String(addr || '')
  const at = s.indexOf('@')
  if (at <= 0) return '******'
  const local = s.slice(0, at)
  const masked = local.length <= 2 ? local[0] + '*' : local[0] + '*'.repeat(local.length - 2) + local.slice(-1)
  return masked + s.slice(at)
}
