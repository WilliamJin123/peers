// A file's text in suggestion style, line by line: what `peers view` and the /peers pane both draw.
//   k  '=' unchanged, '+' added, '-' removed, '~' changed in place (runs: a word diff, t '=' '+' '-')
//   a  the author's session id, or null
//   pre  the Markdown prefix (list marker, heading, quote) kept outside the marks
//   g  set on lines that go in one block (a run of whole added or removed lines); else inline
//   fence  inside a code fence
import { diffLines, diffWordsWithSpace } from './vendor/diff.mjs'
import { key } from './lines.mjs'

export const isDoc = rel => /\.(md|mdx|markdown)$/i.test(rel)
const prefix = line => /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|\s*#{1,6}\s+|\s*>\s*)?/.exec(line)[0]
const item = line => /^\s*([-*+]|\d+[.)])\s/.test(line)
const split = text => text.replace(/\n$/, '').split('\n')

export const docLines = (old, now, authors) => {
  const by = (side, line) => authors[side][key(line)] ?? null
  const out = []
  let fence = false
  let g = 0
  const push = x => {
    x.fence = fence
    if (x.k !== '-' && /^\s*(```|~~~)/.test(x.s)) fence = !fence
    out.push(x)
  }
  // Whole lines: a line too plain to own (a brace, a blank) takes its neighbour's author.
  const whole = (k, ls, block) => {
    const id = block ? ++g : undefined
    let prev = null
    for (const s of ls) {
      const a = by(k === '+' ? 'added' : 'removed', s) ?? (key(s) ? null : prev)
      prev = a
      push({ k, s, a, pre: prefix(s), g: id })
    }
  }
  const parts = diffLines(old, now)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p.added && !p.removed) {
      for (const s of split(p.value)) push({ k: '=', s, a: null })
      continue
    }
    const next = parts[i + 1]
    if (p.removed && next?.added) {
      i++
      const a = split(p.value)
      const b = split(next.value)
      const n = Math.min(a.length, b.length)
      // Line pairs get a word diff; the rest of a list stays in the list, other leftovers go in a block.
      if (a.length === b.length || (a.slice(n).every(item) && b.slice(n).every(item))) {
        for (let j = 0; j < n; j++) {
          const pre = prefix(b[j])
          const runs = diffWordsWithSpace(a[j].slice(prefix(a[j]).length), b[j].slice(pre.length)).map(w => ({
            t: w.added ? '+' : w.removed ? '-' : '=',
            s: w.value,
          }))
          push({ k: '~', s: b[j], a: by('added', b[j]) ?? by('removed', a[j]), pre, runs })
        }
        whole('+', b.slice(n), false)
        whole('-', a.slice(n), false)
      } else {
        whole('-', a, true)
        whole('+', b, true)
      }
      continue
    }
    const ls = split(p.value)
    whole(p.added ? '+' : '-', ls, p.removed || ls.length !== 1 || !ls[0].trim())
  }
  return out
}

// When each changed line came in: the newest ledger edit that named its key (an edit keeps up to 4 keys).
// A line no edit named takes the time of its run (same author, next to each other). kOf(x) → '' for unchanged.
export const editTimes = (ledgers, rel) => {
  const m = new Map()
  for (const l of ledgers) for (const e of l.files?.[rel]?.edits ?? []) for (const k of e.k ?? []) if (!(m.get(k) >= e.at)) m.set(k, e.at)
  return m
}
export const stamp = (lines, times, kOf, sOf = x => x.s) => {
  if (!times.size) return lines
  let run = []
  const flush = () => {
    const at = Math.max(0, ...run.map(x => x.at ?? 0))
    if (at) for (const x of run) x.at ??= at
    run = []
  }
  for (const x of lines) {
    const k = kOf(x)
    if (!k) { flush(); continue }
    const t = times.get(key(sOf(x)))
    if (t) x.at = t
    if (run.length && run[run.length - 1].a !== x.a) flush()
    run.push(x)
  }
  flush()
  return lines
}
