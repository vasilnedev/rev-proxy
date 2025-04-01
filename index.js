import fs from 'fs'
import https from 'https'
import express from 'express'
import proxy from 'express-http-proxy'
import cors from 'cors'

/* 
  This is a simple reverse proxy server that forwards requests to multiple micro-services within a VPN to
  enable secure (SSL) access to the folowing services:
  * BIM fornt-end application and models stored in MinIO server at http://bim-app.server:9000
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

// Redirect the main route to /bim-app
app.get('/', (req, res) => {
  res.redirect('/bim-app/index.html');
});

// Proxy to 'bim-app' bucket 
app.use('/bim-app', 
  allowOnlyGet, 
  proxy('http://bim-app.server:9000', {
    proxyReqPathResolver: req => { return `/bim-app${req.url}` }
  })
)

// Proxy to 'models' bucket
app.use('/models', 
  allowOnlyGet, 
  proxy('http://bim-app.server:9000', {
    proxyReqPathResolver: req => { return `/models${req.url}` }
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
.listen( port , () => console.log(`Server running on port ${port}`))
