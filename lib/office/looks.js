// Office looks (WA-1226, from Vireo peers-view batch 6): office (toon flat, #130), campus (#152), loft (#155).
// One scene holds all three. A look = colours per role + prop groups. A shift tweens the role colours and swaps the props
// as a wave from the back corner to the front: the old ones sink, the new ones grow in. Generic props only, no brands.
import * as THREE from 'three'
import { ease, easeOutBack, reduced } from './kit.js'

export const NAMES = ['office', 'campus', 'loft']
export const TITLE = { office: 'Office', campus: 'Campus', loft: 'Loft' }
// roles a look recolours; everything else keeps the theme colour
const ROLES = ['floor', 'wall', 'part', 'trim', 'rug', 'sofa', 'main', 'lid', 'desk', 'leg', 'pot']
const OUT = 0.4, IN = 0.65, WAVE = 0.9, GAP = 0.35, PAL = 1.6 // s

const rnd = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)
const at = (o, x, y, z) => (o.position.set(x, y, z), o)
const cyl = (c, rt, rb, h, m, seg = 20) => { const g = new THREE.Mesh(c.geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m); g.castShadow = g.receiveShadow = true; return g }
const ball = (c, r, m, det = 1) => { const g = new THREE.Mesh(c.geo(`ic${r},${det}`, () => new THREE.IcosahedronGeometry(r, det)), m); g.castShadow = true; return g }

function leaves(c, into, n, { x0, x1, y, r, seed, cols }) {
  const R = rnd(seed)
  for (let k = 0; k < n; k++) into.add(at(ball(c, r * (0.7 + R() * 0.6), c.M(cols[k % cols.length])), x0 + (x1 - x0) * R(), y + R() * 0.25, 0))
}
function table(c, { w, d, h = 1, top, leg }) {
  const t = new THREE.Group()
  t.add(at(c.bx(w, 0.12, d, c.M(top)), 0, h, 0))
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) t.add(at(c.bx(0.12, h, 0.12, c.M(leg)), x * (w / 2 - 0.15), h / 2, z * (d / 2 - 0.15)))
  return t
}
function stool(c, col, h = 0.75) { const s = new THREE.Group(); s.add(at(cyl(c, 0.26, 0.26, 0.1, c.M(col)), 0, h, 0), at(cyl(c, 0.05, 0.05, h, c.M('#4a4038')), 0, h / 2, 0)); return s }
// bulb on a cord; c.bulb glows at night (daylight.js)
function pendant(c, col, len) {
  const p = new THREE.Group()
  p.add(at(c.bx(0.03, len, 0.03, c.M(c.C.ink)), 0, -len / 2, 0))
  const shade = cyl(c, 0.12, 0.42, 0.36, c.M(col), 24); shade.position.y = -len - 0.1; p.add(shade)
  p.add(at(ball(c, 0.12, c.bulb), 0, -len - 0.26, 0))
  return p
}
let brick = null
function brickTex() {
  if (brick) return brick
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128
  const g = cv.getContext('2d'), R = rnd(7)
  g.fillStyle = '#e9dccb'; g.fillRect(0, 0, 256, 128)
  for (let r = 0; r < 8; r++) for (let k = -1; k < 9; k++) {
    const x = k * 32 + (r % 2) * 16, l = 52 + R() * 14
    g.fillStyle = `hsl(${10 + R() * 8} ${48 + R() * 10}% ${l - 12}%)`; g.fillRect(x + 1.5, r * 16 + 1.5, 29, 13)
  }
  brick = new THREE.CanvasTexture(cv); brick.colorSpace = THREE.SRGBColorSpace; brick.wrapS = brick.wrapT = THREE.RepeatWrapping
  return brick
}
// back walls sit at -H (x and z); a prop row along both, clear of the clock, board and shelves
const alongWalls = (H, step, fn) => { for (let p = -H + 2; p < H - 1.5; p += step) { if (Math.abs(p - 0.2) > 2.4 && Math.abs(p - 6.5) > 1.6) fn(p, 0); if (Math.abs(p - 0.2) > 1.6) fn(p, 1) } }
// side 0 = the x wall (z = -H), side 1 = the z wall (x = -H)
const onWall = (o, H, side, p, y, off = 0.25) => (side ? o.position.set(-H + off, y, p) : o.position.set(p, y, -H + off), o)

// c: colour by role; sky: 3 stops, top to bottom; tints: room floors; dress: props per build spot (shell, part, plaza)
const LOOKS = {
  office: { c: {}, dress: {} },
  campus: {
    sky: ['#fbf1d8', '#e4efd8', '#cfe7e2'],
    tints: ['#ead2a8', '#d3e7bf', '#f1d9b8', '#cbe2cf', '#f3e3b0', '#dcd6bf', '#c6e5d6', '#efd1b2'],
    c: { floor: '#d8b47f', wall: '#4f8a55', part: '#c99561', trim: '#f6ecd6', rug: '#d6e7a9', sofa: '#e2874a', main: '#8fd27e', lid: '#3f8f4e', desk: '#e6c592', leg: '#4a4038', pot: '#c96f3f' },
    dress: {
      // moss: leaf clumps over the back walls
      shell(c) {
        const moss = ['#3f9a4f', '#5cb860', '#2f7d45', '#77c46a'], R = rnd(5)
        alongWalls(c.H, 1.6, (p, side) => { for (let k = 0; k < 6; k++) c.into.add(onWall(ball(c, 0.2 + R() * 0.14, c.M(moss[k % 4])), c.H, side, p + (R() - 0.5) * 1.6, 0.4 + R() * 1.6)) })
      },
      // planters: leaves along each partition top
      part(c) {
        const cols = ['#4fae5c', '#74c46a'], n = 6, { x, z } = c.w.position
        for (let k = 0; k < n; k++) { const t = -c.len / 2 + 0.35 + k * (c.len - 0.7) / (n - 1); c.into.add(at(ball(c, 0.24, c.M(cols[k % 2])), x + (c.vert ? 0 : t), 1.0, z + (c.vert ? t : 0))) }
      },
      // café bar with stools at the back of the plaza, one big tree at the front
      plaza(c) {
        const bar = table(c, { w: 4.2, d: 0.9, h: 1.05, top: '#f6ecd6', leg: '#4a4038' }); bar.add(at(c.bx(0.5, 0.6, 0.45, c.M('#3b3b3b')), -1.4, 1.4, -0.05))
        c.into.add(at(bar, 0, 0, -4.7))
        for (let k = 0; k < 4; k++) c.into.add(at(stool(c, '#e2874a'), -1.5 + k, 0, -3.9))
        const tree = new THREE.Group(); tree.add(at(cyl(c, 0.18, 0.28, 2.6, c.M('#8a5a36')), 0, 1.3, 0))
        leaves(c, tree, 7, { x0: -0.9, x1: 0.9, y: 2.5, r: 0.75, seed: 12, cols: ['#4fae5c', '#3f9a4f', '#74c46a'] })
        for (const m of tree.children.slice(1)) m.position.z = m.position.x * 0.7
        c.into.add(at(tree, 4.6, 0, 4.4))
      },
    },
  },
  loft: {
    sky: ['#f4ece0', '#e9e1d6', '#d6d2cc'],
    tints: ['#cfc9c1', '#d8d0c4', '#c9c6c2', '#d6cdbf', '#cec4b6', '#d3cfc8', '#c8c2b8', '#dbd2c5'],
    c: { floor: '#bdb6ad', wall: '#c4644a', part: '#5c6168', trim: '#3a3d42', rug: '#a3443a', sofa: '#8a5434', main: '#e0a83a', lid: '#3a3d42', desk: '#b8834f', leg: '#2f3135', pot: '#5c6168' },
    dress: {
      // brick faces rise up both back walls in panels (so the wave reads); windows stay in front; steel beams overhead
      shell(c) {
        const W = 3.3
        for (const side of [0, 1]) for (let p = -c.H; p < c.H - 0.01; p += W) {
          const w = Math.min(W, c.H - p), tx = brickTex().clone(); tx.repeat.set(w / 1.6, 1.4); tx.needsUpdate = true
          const b = new THREE.Mesh(c.geo(`brick${w}`, () => new THREE.PlaneGeometry(w, 2.2).translate(0, 1.1, 0)), c.noInk(c.Mx('#ffffff', { map: tx })))
          b.receiveShadow = true
          if (side) { b.rotation.y = Math.PI / 2; b.position.set(-c.H + 0.01, 0, p + w / 2) } else b.position.set(p + w / 2, 0, -c.H + 0.01)
          c.into.add(b)
        }
        for (let k = -c.H + 3; k < c.H; k += 6.6) c.into.add(at(c.bx(0.25, 0.3, c.H * 2, c.M('#3a3d42')), k, 4.6, 0))
      },
      // ping-pong table at the back of the plaza, bulbs on cords over it
      plaza(c) {
        const pp = table(c, { w: 2.8, d: 1.5, h: 0.78, top: '#2e7d5b', leg: '#2f3135' }); pp.add(at(c.bx(0.04, 0.16, 1.6, c.M('#ffffff')), 0, 0.92, 0)); c.into.add(at(pp, 0, 0, -4.6))
        for (const [x, z] of [[-1.4, -1.8], [0, -2.2], [1.4, -1.8], [-0.7, 2.3], [0.9, 2.0]]) c.into.add(at(pendant(c, '#3a3d42', 1.8), x * 1.6, 4.4, z * 1.6))
      },
    },
  },
}

// kit: { M, Mx, bx, geo, noInk, C, make(hex) → a shared material, bulb }
export function createLooks(T, kit, start = 'office') {
  const P = {}, SKY = {}
  for (const n of NAMES) {
    const L = LOOKS[n], o = {}
    for (const r of ROLES) o[r] = new THREE.Color(L.c[r] ?? T.c[r])
    ;(L.tints ?? T.tints).forEach((c, i) => (o[`tint${i}`] = new THREE.Color(c)))
    P[n] = o; SKY[n] = (L.sky ?? T.bgGrad).map((c) => new THREE.Color(c))
  }
  let cur = LOOKS[start] ? start : 'office', span = 20, shift = null
  const mats = new Map() // role → [material]
  const sky = SKY[cur].map((c) => c.clone())
  const groups = new Map() // build spot → [group]; one group per look per build

  // a material whose colour follows the look (tints: tint0..tint7)
  function mat(role) {
    let l = mats.get(role)
    if (!l) { l = [kit.make(`#${P[cur][role].getHexString()}`)]; mats.set(role, l) }
    return l[0]
  }
  const track = (m, role) => { if (!mats.has(role)) mat(role); mats.get(role).push(m); m.color.copy(mats.get(role)[0].color) }
  const all = () => [...groups.values()].flat()
  // the group root keeps its own matrix (it never moves); children freeze between shifts
  const freeze = (g, on) => g.traverse((o) => { if (o === g) return; if (on) o.updateMatrix(); o.matrixAutoUpdate = !on })

  // props for one build spot; items: one hook call each (a partition each) into one group per look
  function dress(spot, parent, ctx = {}, items = [{}]) {
    if (spot !== 'plaza') for (const g of groups.get(spot) ?? []) g.removeFromParent()
    if (ctx.H) span = ctx.H
    const out = []
    for (const name of NAMES) {
      const fn = LOOKS[name].dress[spot]; if (!fn) continue
      const g = new THREE.Group(); g.userData.look = name
      for (const it of items) fn({ ...kit, ...ctx, ...it, into: g })
      g.visible = name === cur
      parent.add(g); g.updateMatrixWorld(true); freeze(g, true); out.push(g)
    }
    groups.set(spot, spot === 'plaza' ? [...(groups.get(spot) ?? []), ...out] : out)
  }

  function paint(k, from) {
    for (const [role, l] of mats) for (const m of l) m.color.lerpColors(from[role] ?? P[cur][role], P[cur][role], k)
    SKY[cur].forEach((c, i) => sky[i].lerpColors(from.sky[i], c, k))
  }
  function end() {
    if (!shift) return
    paint(1, shift.from)
    for (const a of shift.anim) a.o.scale.copy(a.o.userData.s0)
    for (const g of all()) { g.visible = g.userData.look === cur; freeze(g, true) }
    shift = null
  }
  // wave order: the back corner (x + z = -2H) first
  const V = new THREE.Vector3()
  const wave = (o) => { o.getWorldPosition(V); return Math.min(1, Math.max(0, (V.x + V.z + 2 * span) / (4 * span))) }

  function set(name, { instant = false } = {}) {
    if (!LOOKS[name] || name === cur) return false
    end()
    const from = { sky: sky.map((c) => c.clone()) }
    for (const [role, l] of mats) from[role] = l[0].color.clone()
    const prev = cur; cur = name
    if (instant || reduced.matches) { paint(1, from); for (const g of all()) g.visible = g.userData.look === cur; return true }
    const anim = []
    for (const g of all()) {
      const look = g.userData.look
      if (look !== prev && look !== cur) continue
      const out = look === prev
      g.visible = true; freeze(g, false)
      for (const o of g.children) {
        o.userData.s0 ??= o.scale.clone()
        const w = wave(o)
        anim.push({ o, out, at: out ? w * WAVE * 0.6 : GAP + w * WAVE })
        if (!out) o.scale.setScalar(0.0001)
      }
    }
    shift = { t: 0, from, anim }
    return true
  }

  function frame(dt) {
    if (!shift) return
    const s = shift
    s.t += Math.min(dt, 0.1)
    paint(ease(Math.min(1, s.t / PAL)), s.from)
    let busy = s.t < PAL
    for (const a of s.anim) {
      const k = (s.t - a.at) / (a.out ? OUT : IN)
      if (k < 1) busy = true
      const c = Math.min(1, Math.max(0, k)), s0 = a.o.userData.s0
      a.o.scale.copy(s0).multiplyScalar(Math.max(0.0001, a.out ? 1 - ease(c) : easeOutBack(c, 2)))
    }
    if (!busy) end()
  }

  return { mat, track, dress, set, frame, sky, get name() { return cur }, get busy() { return !!shift } }
}
