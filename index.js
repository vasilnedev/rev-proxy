import fs from 'fs'
import https from 'https'
import { randomUUID } from 'crypto'
import express from 'express'
import proxy from 'express-http-proxy'
import cors from 'cors'
import pino from 'pino'
import pinoHttp from 'pino-http'

/*
  This is a simple reverse proxy server, including SSL, that forwards requests to multiple micro-services within a VPN.
*/

const app = express()
const port = 443 // Default SSL port

/*
  Logging
  Structured JSON is written to stdout. Grafana Alloy collects it from the Docker logs and ships it to Loki
  (see compose.yml and alloy/config.alloy).
*/
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: { level: label => ({ level: label }) }, // "info" instead of 30, easier to query in Loki
  timestamp: pino.stdTimeFunctions.isoTime
})

// Path prefixes that are proxied below; keep in sync when adding a service
const knownServices = new Set(['blog', 'thoughts'])

// Registered first, so that every response (including 405s, redirects and CORS preflights) is logged
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = randomUUID() // Always generated here, never trusted from the client at the edge
    res.setHeader('X-Request-Id', id)
    return id
  },
  customLogLevel: (req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  // Upstream service name from the first path segment. Unknown paths (e.g. bot scans for /.env) are grouped
  // as "other" to keep the Loki label low-cardinality.
  customProps: req => {
    const segment = req.originalUrl.split('/')[1].split('?')[0]
    return { service: segment === '' ? 'root' : knownServices.has(segment) ? segment : 'other' }
  },
  serializers: {
    req: req => ({
      id: req.id,
      method: req.method,
      path: req.url.split('?')[0], // Query strings are left out of the logs
      ip: req.remoteAddress,
      ua: req.headers['user-agent'],
      referer: req.headers['referer']
    }),
    res: res => ({
      status: res.statusCode,
      bytes: res.headers?.['content-length']
    })
  }
}))

// Enable CORS for all routes
app.use( cors())

// Middleware to allow only GET requests
const allowOnlyGet = (req, res, next) => {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed')
  }
  next()
}

// Shared proxy error handler: respond with 502 and attach the error to the access log line
const onProxyError = (err, res, next) => {
  res.err = err // pino-http logs this with the "request errored" entry
  if (!res.headersSent) res.status(502).send('Bad Gateway')
}

const proxyTimeout = 10000 // ms

// Redirect the main route to /blog
app.get('/', (req, res) => {
  res.redirect('/blog')
})

// Proxy to blog url
app.use('/blog',
  allowOnlyGet,
  proxy('http://blog.server', {
    timeout: proxyTimeout,
    proxyErrorHandler: onProxyError,
    proxyReqPathResolver: req => req.url === '/' ? '/blog' : `/blog${req.url}`
  })
)

// Proxy to thoughts url
app.use('/thoughts',
  (req, res, next) => {
    // Nuxt Content fetches page data with POST
    if (req.method === 'POST' && req.url.startsWith('/__nuxt_content/')) return next()
    allowOnlyGet(req, res, next)
  },
  proxy('http://thoughts.server:3000', {
    timeout: proxyTimeout,
    proxyErrorHandler: onProxyError,
    // originalUrl keeps the full path, including the trailing slash, so there's no redirect loop
    proxyReqPathResolver: req => req.originalUrl
  })
)


/*
  SSL configuration
*/
const options = {
  key: fs.readFileSync("certs/server.key"),
  cert: fs.readFileSync("certs/certificate.crt"),
  ca: fs.readFileSync('certs/intermediate.crt')
}

https.createServer( options, app)
.listen( port , () => logger.info({ port }, 'server started'))

process.on('unhandledRejection', err => logger.error({ err }, 'unhandled rejection'))
process.on('uncaughtException', err => {
  logger.fatal({ err }, 'uncaught exception')
  process.exit(1)
})
