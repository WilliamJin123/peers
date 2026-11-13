// node lib/view.test.mjs — the view server's lifecycle: a newer client stops an older server and starts its own.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { older, oneRun } from './view.mjs'

const PORT = String(16000 + Math.floor(Math.random() * 2000))
const BIN = fileURLToPath(new URL('../bin/peers.mjs', import.meta.url))
const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version
const env = { ...process.env, PEERS_VIEW_PORT: PORT }
const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (path, opts = {}) =>
  new Promise(ok => {
    const r = request(`http://127.0.0.1:${PORT}${path}`, { agent: false, ...opts }, res => {
      let body = ''
      res.on('data', d => (body += d))
      res.on('end', () => ok({ code: res.statusCode, body, headers: res.headers }))
    })
    r.on('error', () => ok(null))
    r.end()
  })
const ping = async () => {
  const r = await call('/api/ping')
  return r?.code === 200 ? JSON.parse(r.body) : null
}

check('older: 0.16.6 < 0.16.7', older('0.16.6', '0.16.7'), true)
check('older: 0.16.10 > 0.16.9', older('0.16.10', '0.16.9'), false)
check('older: equal', older('0.16.7', '0.16.7'), false)

// oneRun: a run with no await must not keep the slot (11-13 freeze); calls in flight share one run
{
  let runs = 0
  const sync = oneRun(() => ++runs)
  await sync()
  await sync()
  check('oneRun: a run with no await frees the slot', runs, 2)
  let open
  const slow = oneRun(() => new Promise(r => (open = r)).then(() => ++runs))
  const a = slow(), b = slow()
  check('oneRun: callers in flight share one run', a === b, true)
  await Promise.resolve()
  open()
  await a
  check('oneRun: the next call after a slow run starts a new one', slow() !== a, true)
  open()
}

// An old server, as a plugin update leaves it running.
spawn(process.execPath, [BIN, 'view', '--serve'], { env: { ...env, PEERS_VIEW_VERSION: '0.0.1' }, stdio: 'ignore', detached: true, windowsHide: true }).unref()
for (let i = 0; i < 50 && !(await ping()); i++) await sleep(100)
const old = await ping()
check('ping: version and pid', [old?.app, old?.version, typeof old?.pid, old?.keep], ['peers', '0.0.1', 'number', false])
check('stop: refused without the header', (await call('/api/stop', { method: 'POST' }))?.code, 403)
check('stop: refused as GET', (await call('/api/stop', { headers: { 'x-peers': 'stop' } }))?.code, 403)

// A client on this version: the old server stops, a new one answers.
spawnSync(process.execPath, [BIN, 'view', '--no-open'], { env, stdio: 'ignore', windowsHide: true, timeout: 15000 })
const now = await ping()
check('ensure: the server is this version', now?.version, VERSION)
check('ensure: a new process', !!now && now.pid !== old?.pid, true)

// A client on the same version leaves it alone.
spawnSync(process.execPath, [BIN, 'view', '--no-open'], { env, stdio: 'ignore', windowsHide: true, timeout: 15000 })
check('ensure: same version, same server', (await ping())?.pid, now?.pid)

// The office: page, its modules and the vendored three.js, all from this server (no CDN).
const o = await call('/office?only=wren')
check('office: /office goes to /office/ with its query', [o?.code, o?.headers.location], [301, '/office/?only=wren'])
const page = await call('/office/')
check('office: page and import map', [page?.code, /"three":"\.\.\/vendor\/three\/three\.module\.min\.js"/.test(page?.body ?? '')], [200, true])
for (const f of ['office.js', 'live.js', 'demo.js', 'model.js', 'kit.js', 'theme.js', 'hud.js', 'dock.js'])
  check(`office: ${f}`, (await call(`/office/${f}`))?.code, 200)
for (const f of ['three/three.module.min.js', 'three/addons/controls/OrbitControls.js', 'three/addons/effects/OutlineEffect.js', 'fonts/fredoka.woff2'])
  check(`office: vendor ${f}`, (await call(`/vendor/${f}`))?.code, 200)
check('office: only its own files', (await call('/office/view.mjs'))?.code === 200, false)

check('stop: with the header', (await call('/api/stop', { method: 'POST', headers: { 'x-peers': 'stop' } }))?.code, 200)
for (let i = 0; i < 30 && (await ping()); i++) await sleep(100)
check('stop: gone', await ping(), null)

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
