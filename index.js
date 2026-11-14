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
const port = 443 // Default SSL poert

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

// Proxy to 'documents' bucket
app.use('/documents', 
  allowOnlyGet, 
  proxy('http://bim-app.server:9000', {
    proxyReqPathResolver: req => { return `/documents${req.url}` }
  })
)

/* 
  For SSL store certificates in 'certs' folder.
  If SSL is not required, replace 'https.createServer' with 'app' to run Express
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
