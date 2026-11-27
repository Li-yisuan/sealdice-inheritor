import { createServer } from 'node:http'

function send(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) return reject(new Error('请求体过大'))
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

export function createServerFor({ bridge, token = '' }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname

    if (path.startsWith('/api/') && token) {
      const auth = req.headers.authorization || ''
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-token']
      if (given !== token) return send(res, 401, { error: 'token 不正确' })
    }

    try {
      if (req.method === 'GET' && path === '/api/health') {
        return send(res, 200, bridge.health())
      }
      if (req.method === 'GET' && path === '/api/state') {
        return send(res, 200, bridge.state())
      }
      if (req.method === 'GET' && path === '/api/inspect') {
        return send(res, 200, {
          ...bridge.inspect({
            openid: url.searchParams.get('openid') || '',
            owner: url.searchParams.get('owner') || '',
            group: url.searchParams.get('group') || '',
          }),
        })
      }
      if (req.method === 'POST' && path === '/api/bind/request') {
        return send(res, 200, await bridge.requestBind(await readBody(req)))
      }
      if (req.method === 'POST' && path === '/api/bind/verify') {
        return send(res, 200, await bridge.verifyBind(await readBody(req)))
      }
      if (req.method === 'POST' && path === '/api/smtp') {
        return send(res, 200, bridge.setSmtp(await readBody(req)))
      }
      if (req.method === 'POST' && path === '/api/bind') {
        const body = await readBody(req)
        if (!body.admin) return send(res, 403, { error: '直接绑定需要 admin:true' })
        return send(res, 200, bridge.bind(body))
      }
      if (req.method === 'POST' && path === '/api/unbind') {
        return send(res, 200, bridge.unbind(await readBody(req)))
      }
      if (req.method === 'GET' && path === '/api/groups') {
        return send(res, 200, bridge.groups())
      }
      if (req.method === 'POST' && path === '/api/groups/map') {
        const body = await readBody(req)
        if (!body.admin) return send(res, 403, { error: '群映射需要管理员' })
        return send(res, 200, bridge.mapGroup(body))
      }
      if (req.method === 'GET' && path === '/api/logs') {
        return send(res, 200, {
          ...bridge.previewLogs({
            group: url.searchParams.get('group') || '',
            oldGroup: url.searchParams.get('oldGroup') || '',
          }),
        })
      }
      if (req.method === 'POST' && path === '/api/logs') {
        const body = await readBody(req)
        return send(res, 200, body.all ? bridge.migrateAllLogs(body) : bridge.migrateLogsFor(body))
      }
      return send(res, 404, { error: 'not found' })
    } catch (err) {
      return send(res, err.code === 'LOG_NAME_COLLISION' ? 409 : 400, {
        error: err.message,
        code: err.code || 'BAD_REQUEST',
        collisions: err.collisions,
      })
    }
  })
}


