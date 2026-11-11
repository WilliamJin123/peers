// The work queue's files (lib/queue.mjs has the rules): the CLI's, under the board lock.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (path, v) => {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v))
  renameSync(tmp, path)
}

export const store = claimDir => {
  const qPath = join(claimDir, 'queue.json')
  const sDir = join(claimDir, 'serve')
  const sPath = s => join(sDir, `${s}.json`)
  return {
    read: () => {
      const q = readJson(qPath)
      return Array.isArray(q?.items) ? q.items : []
    },
    write: items => (mkdirSync(claimDir, { recursive: true }), writeJson(qPath, { items })),
    lanes: s => readJson(sPath(s))?.lanes ?? null,
    serve: (s, lanes) => (mkdirSync(sDir, { recursive: true }), writeJson(sPath(s), { session: s, lanes })),
    unserve: s => rmSync(sPath(s), { force: true }),
    // session -> lanes, every serve file
    serving: () => {
      const out = new Map()
      try {
        for (const f of readdirSync(sDir).filter(f => f.endsWith('.json'))) {
          const v = readJson(join(sDir, f))
          if (v?.session) out.set(v.session, v.lanes)
        }
      } catch {}
      return out
    },
  }
}

