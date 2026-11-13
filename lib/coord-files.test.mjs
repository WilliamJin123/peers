// node lib/coord-files.test.mjs — the file store through the port cases (WA-1369), plus two processes racing one take.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coordContract } from './coord.contract.mjs'
import { fileStore } from './coord-files.mjs'

const root = mkdtempSync(join(tmpdir(), 'peers-coord-'))
const results = (await coordContract({ name: 'files', make: ns => fileStore({ dir: join(root, ns) }) })).map(r => [r.name, r.ok, r.got, r.want])
// across processes: 8 takers, 3 items → 3 winners, each item once
const dir = join(root, 'procs')
await fileStore({ dir }).queueAdd(['P-1', 'P-2', 'P-3'], { lane: 'dev' })
const take = `import { fileStore } from ${JSON.stringify(new URL('./coord-files.mjs', import.meta.url).href)}; const r = await fileStore({ dir: ${JSON.stringify(dir)} }).queueTake({ lanes: '*' }, 'm/' + process.pid, 60000); console.log(r?.id ?? '')`
const got = await Promise.all(
  Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', take]).then(r => r.stdout.trim())),
)
results.push(['files: 8 processes, 3 items: each taken once', JSON.stringify(got.filter(Boolean).sort()) === '["P-1","P-2","P-3"]', got, ['P-1', 'P-2', 'P-3']])
rmSync(root, { recursive: true, force: true })
let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
