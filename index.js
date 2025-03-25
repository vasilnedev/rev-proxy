import express from 'express'
import proxy from 'express-http-proxy'

/* 
  This is a simple reverse proxy server that forwards requests to multiple micro-services within a VPN e.g.:
  * BIM application and its models stored in MinIO server at http://bim-app.server:9000
*/

const app = express()
const port = 3000

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

// Proxy for /bim-app
app.use('/bim-app', 
  allowOnlyGet, 
  proxy('http://bim-app.server:9000', {
    proxyReqPathResolver: req => { return `/bim-app${req.url}` }
  })
)

// Proxy for /models
app.use('/models', 
  allowOnlyGet, 
  proxy('http://bim-app.server:9000', {
    proxyReqPathResolver: req => { return `/models${req.url}` }
  })
)

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK')
})

app.listen( port , () => {
  console.log(`Server running on port ${port}`)
})
