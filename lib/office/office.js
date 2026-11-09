// The peers office: a room per repo, a desk and a figure per session. Task board, pins and diffs are DOM over the scene (crisp).
// Reactive: rooms and desks come and go with the feed; layout tweens. Base look: theme.js; looks.js shifts it, daylight.js lights it by the clock.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createHud } from './hud.js'
import { createDock } from './dock.js'
import { createDiffCache } from './diffview.js'
import { createViews } from './views.js'
import { createPins, pinId } from './pins.js'
import { createBoard } from './board.js'
import { createYard } from './yard.js'
import { createLooks } from './looks.js'
import { createDaylight } from './daylight.js'
import { createScenePanel } from './scenepanel.js'
import { THREE, stage, geo, shared, flights, free, arc, ease, easeOutBack, textPlane, figure, goTo, stride, turnTo, act, beat, emote, codeScreen, confetti, navigate, reduced } from './kit.js'

const CELL = 13.2, ROOM = 11.4, SHOW = 6
// desk spots in a room by how many sit there (room-local x, z)
const SLOTS = [[], [[0, 0.3]], [[-2.6, 0.3], [2.6, 0.3]], [[-2.6, -2.1], [2.6, -2.1], [0, 2.7]], [[-2.6, -2.1], [2.6, -2.1], [-2.6, 2.7], [2.6, 2.7]],
  [[-3.7, -2.1], [0, -2.1], [3.7, -2.1], [-2.6, 2.7], [2.6, 2.7]], [[-3.7, -2.1], [0, -2.1], [3.7, -2.1], [-3.7, 2.7], [0, 2.7], [3.7, 2.7]]]
// rooms on a g×g grid round the plaza: odd g gives the plaza the middle cell
const cap = (g) => (g % 2 ? g * g - 1 : g * g)
const gridFor = (n) => { let g = 2; while (cap(g) < n) g++; return g }

export async function office(feed, T) {
  const C = T.c, ALERT = T.alert, font = `"${T.font}",ui-sans-serif,-apple-system,sans-serif`
  await Promise.all([`600 40px "${T.font}"`, `400 40px "${T.font}"`].map((f) => document.fonts.load(f).catch(() => {})))
  const hud = createHud(feed)
  const cache = createDiffCache(feed), views = createViews(feed, cache)
  const dock = createDock(feed, { onPick: (s) => pick(s, true), views, cache, onPin: (s) => pinSel(s) })
  const note = createNote()
  let S
  try { S = stage({ bg: T.bg, span: 33, fov: T.fov, inset: dock.inset }) } catch {
    // no WebGL: the dock is the view
    document.body.classList.add('no-gl'); note.set('noGl'); dock.full(note.el); return
  }
  const { scene, camera, renderer } = S
  hud.area = S.size
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); note.set('lost') })
  renderer.domElement.addEventListener('webglcontextrestored', () => location.reload())

  // materials: cached ones are shared; Mx = fresh, for one that changes per object
  const mats = new Map()
  const noInk = (m) => ((m.userData.outlineParameters = { visible: false }), m)
  const M = (color, extra) => { const k = color + (extra ? JSON.stringify(extra) : ''); let m = mats.get(k); if (!m) { m = shared(T.mat(color, extra)); mats.set(k, m) } return m }
  const Mx = (color, extra) => T.mat(color, extra)
  const basic = (o) => noInk(new THREE.MeshBasicMaterial({ toneMapped: false, ...o }))
  const bx = (w, h, d, m) => { const r = Math.min(T.round, Math.min(w, h, d) * 0.45); const g = new THREE.Mesh(geo(`rb${w},${h},${d}`, () => new RoundedBoxGeometry(w, h, d, 2, r)), m); g.castShadow = g.receiveShadow = true; return g }
  const freeze = (o) => { o.updateMatrixWorld(true); o.traverse((x) => (x.matrixAutoUpdate = false)) }
  // looks: role colours + props for office, campus, loft; R(role) = a material that follows the look
  const bulb = shared(basic({ color: '#d9d2c0' }))
  const looks = createLooks(T, { M, Mx, bx, basic, geo, noInk, C, T, bulb, make: (hex) => shared(T.mat(hex)) })
  const R = looks.mat
  // lights + sky from the clock
  const sun = createDaylight({ scene, looks, view: renderer.domElement, lat: +new URLSearchParams(location.search).get('lat') || 40 })
  sun.out.bulbs.push(bulb)
  const fly = flights(scene, (f) => S.onFrame(f))
  const tmp = new THREE.Vector3(), camRight = new THREE.Vector3()
  const label = (s, o = {}) => textPlane(s, { color: C.label, font, weight: 600, ...o })
  const yard = createYard({ scene, M, bx, fly, label, onFrame: (f) => S.onFrame(f), night: () => sun.st.dark })
  sun.out.clouds.push(yard.mats.cloud); sun.out.flies.push(...yard.mats.flies)

  // plaza: main dropbox, sofas, two plants; never moves
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.05, 48), R('rug')); rug.position.y = 0.05; rug.receiveShadow = true; scene.add(rug)
  const main = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.1, 32), R('main')); base.position.y = 0.55; base.castShadow = true
  const lid = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 12, 32), Mx(C.lid, { emissive: T.glow, emissiveIntensity: 0 }))
  lid.rotation.x = Math.PI / 2; lid.position.y = 1.12; looks.track(lid.material, 'lid')
  main.add(base, lid); main.userData.pick = { main: true }; scene.add(main)
  const ml = label('main', { size: 56 }); ml.scale.setScalar(0.6); ml.position.set(-0.5, 0.09, 1.6); scene.add(ml)
  const SOFA = [[-2.2, 2.2], [2.2, -2.2]]
  const sofas = SOFA.map(([x, z]) => {
    const s = new THREE.Group(), m = R('sofa')
    s.add(bx(2.4, 0.5, 1, m)); const back = bx(2.4, 0.6, 0.3, m); back.position.set(0, 0.45, -0.38); s.add(back)
    for (const e of [-1, 1]) { const arm = bx(0.28, 0.4, 1, m); arm.position.set(e * 1.2, 0.3, 0); s.add(arm) }
    s.position.set(x, 0.25, z); s.lookAt(0, 0.25, 0); scene.add(s); return s
  })
  const plant = (i) => {
    const p = new THREE.Group()
    const pot = new THREE.Mesh(geo('pot', () => new THREE.CylinderGeometry(0.34, 0.26, 0.55, 20)), R('pot')); pot.position.y = 0.28; pot.castShadow = true; p.add(pot)
    const leaves = new THREE.Group(); leaves.position.y = 0.55; p.add(leaves)
    for (let k = 0; k < 3; k++) {
      const l = new THREE.Mesh(geo(`leaf${k}`, () => new THREE.IcosahedronGeometry(0.36 - k * 0.06, 1)), M(k % 2 ? C.leaf2 : C.leaf))
      l.position.set(Math.sin(k * 2.1) * 0.12, 0.3 + k * 0.32, Math.cos(k * 2.1) * 0.12); l.castShadow = true; leaves.add(l)
    }
    p.userData = { leaves, ph: i * 1.7 }; scene.add(p); return p
  }
  const plants = [0, 1, 2, 3, 4].map(plant)
  plants[3].position.set(2.6, 0, 2.6); plants[4].position.set(-2.6, 0, -2.6)
  looks.dress('plaza', scene)

  // shell: floor, back walls, windows, clock, shelves, partitions, board spot; built again when the grid size changes
  let g = 0, H = 0, shell = null, clock = null
  const winM = [windowTex(3), windowTex(11)].map((map) => shared(basic({ map })))
  sun.out.windows.push(...winM)
  function buildShell(ng) {
    if (shell) { shell.removeFromParent(); free(shell) }
    g = ng; H = (g * CELL + 0.6) / 2
    shell = new THREE.Group(); scene.add(shell)
    const floor = bx(H * 2, 0.5, H * 2, R('floor')); floor.position.y = -0.25; shell.add(floor)
    const wall = (w, d, x, z, h = 2.2, m = R('wall')) => { const b = bx(w, h, d, m); b.position.set(x, h / 2, z); shell.add(b); return b }
    wall(H * 2, 0.4, 0, -H - 0.2); wall(0.4, H * 2, -H - 0.2, 0)
    // windows along both back walls; the board corner and the clock stay clear
    for (let k = -H + 9.6; k < H - 2.4; k += 6.4) {
      for (const side of [0, 1]) {
        if (side === 0 && Math.abs(k - 0.2) < 2.6) continue
        const w = new THREE.Mesh(geo('win', () => new THREE.PlaneGeometry(4.2, 1.15)), winM[(side + Math.round(k)) & 1])
        const sill = bx(4.4, 0.08, 0.18, R('trim'))
        if (side === 0) { w.position.set(k, 1.35, -H + 0.02); sill.position.set(k, 0.74, -H + 0.07) }
        else { w.position.set(-H + 0.02, 1.35, k); w.rotation.y = Math.PI / 2; sill.position.set(-H + 0.07, 0.74, k); sill.rotation.y = Math.PI / 2 }
        shell.add(w, sill)
      }
    }
    clock = new THREE.Group(); clock.position.set(0.2, 1.55, -H + 0.04)
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 32), M(C.paper)); face.rotation.x = Math.PI / 2; clock.add(face)
    clock.add(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 32), M(C.bezel)))
    const hand = (l, w, m = M(C.bezel)) => { const h = new THREE.Group(); const b = bx(w, l, 0.02, m); b.position.y = l / 2; h.add(b); h.position.z = 0.06; clock.add(h); return h }
    clock.userData = { h: hand(0.22, 0.05), m: hand(0.33, 0.035), s: hand(0.36, 0.015, M(ALERT)) }
    shell.add(clock)
    const books = [...T.tints.slice(0, 4), C.sofa, C.main, C.lid, C.pot]
    for (const [x, z, ry] of [[-H + 0.45, 0.2, Math.PI / 2], [6.5, -H + 0.45, 0]]) {
      const sh = new THREE.Group(); sh.position.set(x, 0, z); sh.rotation.y = ry
      const fr = bx(1.8, 1.9, 0.5, R('desk')); fr.position.y = 0.95; sh.add(fr)
      for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) {
        const h = 0.36 + ((k * 7 + r * 3) % 5) * 0.04
        const b = bx(0.18, h, 0.36, M(books[(k + r * 3) % books.length])); b.position.set(-0.66 + k * 0.22, 0.2 + r * 0.6 + h / 2, 0.12); b.rotation.z = k === 6 ? -0.18 : 0; sh.add(b)
      }
      shell.add(sh)
    }
    plants[0].position.set(H - 1.3, 0, -H + 1.3); plants[1].position.set(-H + 1.3, 0, H - 1.3); plants[2].position.set(H - 1.3, 0, H - 1.3)
    sun.fit(H + 6)
    yard.build(H)
    freeze(shell)
    // the clock's hands turn: they keep their own matrices
    clock.traverse((x) => (x.matrixAutoUpdate = true))
    looks.dress('shell', shell, { H })
    partitions = null; partKey = ''
  }
  // half walls between neighbour rooms: the outer half of each shared edge
  let partitions = null, partKey = ''
  function buildPartitions(cells) {
    const key = [...cells.keys()].sort().join(',')
    if (partitions && key === partKey) return
    partKey = key
    if (partitions) { partitions.removeFromParent(); free(partitions) }
    partitions = new THREE.Group(); shell.add(partitions)
    const used = new Set(cells.keys()), items = []
    const mid = (g - 1) / 2, plaza = (i, j) => g % 2 === 1 && i === mid && j === mid
    for (let i = 0; i < g - 1; i++) for (let j = 0; j < g; j++) for (const vert of [true, false]) {
      const a = vert ? [i, j] : [j, i], b = vert ? [i + 1, j] : [j, i + 1]
      if (plaza(...a) || plaza(...b) || (!used.has(a.join(':')) && !used.has(b.join(':')))) continue
      const line = (i + 1 - g / 2) * CELL, m = (j - mid) * CELL, at = m + Math.sign(m || 1) * CELL / 4
      const w = bx(vert ? 0.3 : CELL / 2 - 0.1, 0.9, vert ? CELL / 2 - 0.1 : 0.3, R('part'))
      w.position.set(vert ? line : at, 0.45, vert ? at : line); partitions.add(w)
      items.push({ w, vert, len: CELL / 2 - 0.1 })
    }
    freeze(partitions)
    looks.dress('part', partitions, {}, items)
  }

  // world state
  const ROOMS = new Map() // id → { grp, floor, name, more, cell, to }
  const W = new Map() // session id → desk + figure
  let picked = null, ready = false, pins = null, board = null
  const t0 = performance.now()
  const grow = [] // { o, s, at, out?, done? }
  const addGrow = (o, delay = 0, out = false, done) => {
    // a new grow replaces one still running on the same object
    const i = grow.findIndex((q) => q.o === o); if (i >= 0) grow.splice(i, 1)
    grow.push({ o, s: o.userData.scale0 ?? (o.userData.scale0 = o.scale.clone()), at: performance.now() + delay * 1000, out, done }); if (!out) o.scale.setScalar(0.0001)
  }

  function addRoom(id, i) {
    const grp = new THREE.Group()
    const floor = bx(ROOM, 0.06, ROOM, R(`tint${i % T.tints.length}`)); floor.position.y = 0.03; grp.add(floor)
    const name = label(id); name.position.set(-ROOM / 2 + 2.3, 0.08, ROOM / 2 - 0.8); grp.add(name)
    grp.userData = { to: new THREE.Vector3() }
    scene.add(grp)
    const r = { id, grp, floor, more: null, cell: null, n: 0 }
    ROOMS.set(id, r)
    if (ready) addGrow(grp)
    return r
  }
  function setMore(r, n) {
    if (r.n === n) return
    r.n = n
    if (r.more) { r.more.removeFromParent(); free(r.more); r.more = null }
    if (n > 0) { r.more = label(`+${n} more in the list`, { size: 48 }); r.more.position.set(ROOM / 2 - 2.3, 0.08, ROOM / 2 - 0.8); r.grp.add(r.more) }
  }

  const poolM = shared(basic({ map: glowTex(), color: '#ffc46b', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
  const WARM = new THREE.Color('#ffb84d'), ALERT_C = new THREE.Color(ALERT)
  const paperM = M(C.paper), alertM = M(ALERT), deskM = R('desk'), legM = R('leg'), bezelM = M(C.bezel)
  function addDesk(x) {
    const desk = new THREE.Group()
    const top = bx(2.6, 0.12, 1.2, deskM); top.position.y = 1.0; desk.add(top)
    for (const [lx, lz] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]]) { const l = bx(0.1, 1, 0.1, legM); l.position.set(lx, 0.5, lz); desk.add(l) }
    // monitor: a code face on each side (read from the chair and from the camera)
    const mon = new THREE.Group(); mon.position.set(-0.55, 1.52, -0.3)
    mon.add(bx(1.2, 0.78, 0.06, bezelM))
    const stand = bx(0.08, 0.4, 0.08, bezelM); stand.position.y = -0.5; mon.add(stand)
    const code = codeScreen(x.id, { ...T.screen, accent: x.color })
    noInk(code.mat)
    for (const s of [-1, 1]) { const f = new THREE.Mesh(geo('screen', () => new THREE.PlaneGeometry(1.08, 0.66)), code.mat); f.position.z = s * 0.035; if (s < 0) f.rotation.y = Math.PI; mon.add(f) }
    desk.add(mon)
    const lamp = new THREE.Mesh(geo('lamp', () => new THREE.SphereGeometry(0.16, 14, 14)), Mx(C.lamp, { emissive: ALERT, emissiveIntensity: 0 }))
    lamp.position.set(1.05, 1.2, -0.35); desk.add(lamp)
    const mug = new THREE.Mesh(geo('mug', () => new THREE.CylinderGeometry(0.09, 0.08, 0.18, 14)), M(x.color)); mug.position.set(0.55, 1.15, -0.4); mug.castShadow = true; desk.add(mug)
    const rug = new THREE.Mesh(geo('deskrug', () => new THREE.BoxGeometry(3.6, 0.03, 3.2)), basic({ color: x.color, transparent: true, opacity: 0.22, depthWrite: false }))
    rug.position.set(0, 0.075, -0.35); desk.add(rug)
    // lamp light on the floor after dark
    const pool = new THREE.Mesh(geo('pool', () => new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2)), poolM)
    pool.position.set(0.7, 0.09, -0.1); pool.visible = false; desk.add(pool)
    desk.userData = { pick: { session: x.id }, to: new THREE.Vector3() }
    scene.add(desk)
    const b = figure(x.color, { mat: M, ink: C.ink })
    b.scale.setScalar(1.25); b.userData.scale0 = b.scale.clone()
    b.userData.pick = { session: x.id }
    scene.add(b)
    const ring = new THREE.Mesh(geo('ring', () => new THREE.RingGeometry(0.6, 0.78, 40)), basic({ color: ALERT, transparent: true, opacity: 0, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; b.add(ring)
    const emo = {
      blocked: emote('!', { color: '#fff', bg: ALERT, font }),
      idle: emote('zz', { color: C.ink, bg: C.bubble, ring: C.bubbleRing, font }),
    }
    for (const e of Object.values(emo)) { e.visible = false; noInk(e.material); scene.add(e) }
    const w = { x, b, desk, code, lamp, pool, rug, ring, emo, home: new THREE.Vector3(), stacks: new Map(), errand: false, shake: 0, idleAt: null, placed: false }
    W.set(x.id, w)
    hud.add(x)
    if (ready) { addGrow(desk); addGrow(b, 0.2) }
    return w
  }
  function dropDesk(id) {
    const w = W.get(id)
    if (!w) return
    W.delete(id)
    hud.remove(id)
    for (const e of Object.values(w.emo)) { e.removeFromParent(); e.material.dispose() }
    const gone = () => { w.desk.removeFromParent(); w.b.removeFromParent(); free(w.desk); free(w.b); w.code.dispose() }
    if (reduced.matches) return gone()
    addGrow(w.desk, 0, true, gone); addGrow(w.b, 0, true)
  }

  // paper stacks on a desk: one per held file, height by lines
  function setStack(w, key, lines) {
    let s = w.stacks.get(key)
    if (!s) {
      s = new THREE.Group()
      const p = bx(0.36, 1, 0.46, paperM); s.add(p)
      const band = bx(0.38, 0.05, 0.48, M(w.x.color)); s.add(band)
      s.userData = { p, band, bump: 0.6, grow: 0 }
      w.desk.add(s); w.stacks.set(key, s)
    }
    s.userData.h = Math.min(0.08 + lines / 120, 0.9)
  }
  function syncStacks(w) {
    for (const [k, n] of w.x.holds) setStack(w, k, n)
    for (const [k, s] of w.stacks) if (!w.x.holds.has(k)) { s.userData.gone = 1; w.stacks.delete(k) }
    // 8 shown, 4 to a row; the rest are in the dock
    let i = 0
    for (const s of w.stacks.values()) { s.visible = i < 8; s.position.set(0.05 + (i % 4) * 0.42, 0, 0.25 - Math.floor(i / 4) * 0.5); i++ }
  }

  // layout: grid size, room cells, desks in rooms; everything tweens to its spot
  const cellXZ = (key) => { const [i, j] = key.split(':').map(Number), mid = (g - 1) / 2; return [(i - mid) * CELL, (j - mid) * CELL] }
  function cellsFor(n) {
    const mid = (g - 1) / 2, out = []
    for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) if (!(g % 2 && i === mid && j === mid)) out.push([i, j])
    // nearest the plaza first; the back (top of the screen) before the front
    return out.sort((a, b) => Math.hypot(a[0] - mid, a[1] - mid) - Math.hypot(b[0] - mid, b[1] - mid) || a[0] + a[1] - (b[0] + b[1])).slice(0, n).map((c) => c.join(':'))
  }
  function layout() {
    const repos = feed.repos
    const ng = gridFor(repos.length)
    const reshell = ng !== g
    if (reshell) buildShell(ng)
    // keep each room's cell; a new room takes the nearest free one
    const free_ = cellsFor(cap(g)).filter((c) => reshell || ![...ROOMS.values()].some((r) => r.cell === c))
    const cells = new Map()
    repos.forEach((rp, i) => {
      const r = ROOMS.get(rp.id) ?? addRoom(rp.id, i)
      if (reshell || !r.cell) r.cell = free_.shift()
      cells.set(r.cell, r)
      const [x, z] = cellXZ(r.cell)
      r.grp.userData.to.set(x, 0, z)
      if (!r.placed) { r.grp.position.set(x, 0, z); r.placed = true }
    })
    for (const [id, r] of ROOMS) if (!repos.some((x) => x.id === id)) { ROOMS.delete(id); addGrow(r.grp, 0, true, () => { r.grp.removeFromParent(); free(r.grp) }) }
    buildPartitions(cells)
    // desks: up to SHOW per room; one who needs you first, then who already sits, then start order
    const seated = new Set()
    for (const r of ROOMS.values()) {
      const xs = feed.sessions.filter((x) => x.repo === r.id)
      const shown = [...xs].sort((a, b) => (b.state === 'blocked') - (a.state === 'blocked') || W.has(b.id) - W.has(a.id) || xs.indexOf(a) - xs.indexOf(b)).slice(0, SHOW)
      const seat = xs.filter((x) => shown.includes(x))
      setMore(r, xs.length - seat.length)
      const spots = SLOTS[seat.length]
      seat.forEach((x, i) => {
        const w = W.get(x.id) ?? addDesk(x)
        w.x = x; seated.add(x.id)
        const [ox, oz] = spots[i], to = r.grp.userData.to
        w.desk.userData.to.set(to.x + ox, 0, to.z + oz)
        w.home.set(to.x + ox, 0, to.z + oz - 1.15)
        if (!w.placed) { w.desk.position.copy(w.desk.userData.to); w.b.position.copy(w.home); w.placed = true }
        else if (!w.errand && w.x.state !== 'idle') goTo(w.b, w.home.x, w.home.z)
      })
    }
    for (const id of [...W.keys()]) if (!seated.has(id)) dropDesk(id)
    // idle ones sit round the plaza, spread out
    let k = 0
    for (const w of W.values()) if (w.x.state === 'idle') {
      const a = Math.PI * 0.75 + k++ * 0.7, rr = 3.9
      w.idleAt = [Math.cos(a) * rr, Math.sin(a) * rr]
      if (!w.errand) goTo(w.b, w.idleAt[0], w.idleAt[1])
    } else w.idleAt = null
    if (reshell) {
      S.setSpan((H * 2) * (dock.side ? 1.25 : 1.1))
      nav.home.pos.copy(S.homePos()); nav.home.target.set(0, 0, 0)
      if (ready) nav.reset()
    }
  }
  const spanNow = () => (H * 2) * (dock.side ? 1.25 : 1.1)

  function sync() {
    layout()
    for (const w of W.values()) syncStacks(w)
    pins?.redraw()
    note.set(feed.status === 'offline' ? 'offline' : feed.status === 'connecting' ? 'connecting' : !feed.sessions.length ? (feed.only ? 'nomatch' : 'empty') : null, feed.only)
  }

  // pick + nav
  const deskOf = (key) => { const hd = feed.sessions.find((x) => x.holds.has(key)); return hd && W.get(hd.id) }
  function pick(s, fromDock) {
    picked = s
    hud.picked = s?.session ?? null
    if (!fromDock) dock.inspect(s)
    board?.pick(s?.task ?? null)
    const w = s?.session ? W.get(s.session) : s?.task ? W.get(feed.taskById[s.task]?.holders[0]) : s?.file ? deskOf(s.file) : null
    if (w) nav.flyTo(w.desk.position.clone().setY(1), S.span * 1.6)
  }
  // a pin: the session, task or file in a window over the office, wired to its desk
  function pinSel(sel) {
    if (!sel) return
    pins.open({
      id: pinId(sel), sel, w: sel.file ? 520 : 360, h: sel.file ? 360 : 260,
      render: () => { if (!views.alive(sel)) return null; const h = views.head(sel), st = pins.get(pinId(sel)); return { ...h, html: views.body(sel, { all: st?.all, focusDiff: true }) } },
      onBody: (ev, p) => {
        if (ev.target.closest('[data-more]')) { p.all = true; p.draw(); return }
        const f = ev.target.closest('[data-file]'); if (f) { pinSel({ file: f.dataset.file }); return }
      },
    })
  }
  // screen spot of a selection: [x, y, visible, colour]
  const P0 = new THREE.Vector3()
  function anchorOf(sel) {
    let w = null, at = null
    if (sel.session) { w = W.get(sel.session); if (w) at = head(w) }
    else if (sel.task) { w = W.get(feed.taskById[sel.task]?.holders[0]); if (w) at = head(w) }
    else if (sel.file) { w = deskOf(sel.file); const st = w?.stacks.get(sel.file); if (st) { st.getWorldPosition(P0); at = P0.setY(P0.y + 1.2) } else if (w) at = head(w) }
    if (!at) return null
    const [x, y, vis] = S.project(at)
    return [x, y, vis, w.x.color]
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const tip = (p) => {
    if (p.session) { const x = feed.byId[p.session]; return x && `<b>${esc(x.name)}</b> <span>${esc(x.taskId ?? '')} ${esc(x.task || x.about || '')}</span>` }
    if (p.task) { const t = feed.taskById[p.task]; return t && `<b>${esc(t.id)} ${esc(t.title)}</b><br><span>${t.status} · ${t.files.size} files · ${t.commits.length} commits</span>` }
    if (p.main) return '<b>main</b> <span>a commit lands here</span>'
  }
  const nav = navigate(S, { pickables: () => [...[...W.values()].flatMap((w) => [w.desk, w.b]), main], onPick: (p) => pick(p), tip })
  hud.onReset = () => { pick(null); nav.reset() }
  hud.onPick = (p) => pick(p)

  // first scene: built from the feed, then the grow wave and the camera swing
  await feed.ready
  buildShell(gridFor(feed.repos.length))
  sync()
  yard.seed(feed.sessions.flatMap((x) => Array(Math.min(40, x.commits || 0)).fill(x.color)))
  S.setSpan(spanNow())
  nav.home.pos.copy(S.homePos()); nav.home.target.set(0, 0, 0)
  camera.position.copy(nav.home.pos)
  if (!reduced.matches) {
    addGrow(main, 0); sofas.forEach((s, i) => addGrow(s, 0.15 + i * 0.1)); plants.forEach((p, i) => addGrow(p, 0.4 + i * 0.12))
    let i = 0
    for (const r of ROOMS.values()) addGrow(r.grp, 0.1 + i++ * 0.08)
    i = 0
    for (const w of W.values()) { addGrow(w.desk, 0.3 + i * 0.1); addGrow(w.b, 0.6 + i * 0.1); i++ }
    const r = nav.home.pos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55).multiplyScalar(1.35)
    camera.position.copy(r)
    nav.flyTo(nav.home.target, null, nav.home.pos, 2.2)
  }
  ready = true
  S.onResize = () => { S.setSpan(spanNow()); nav.home.pos.copy(S.homePos()) }
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)))
  if (q.session || q.task || q.file) setTimeout(() => pick(q), reduced.matches ? 0 : 2400)

  if (T.post) S.usePost(T.post(S))

  // DOM over the canvas: pins (wired windows), the task board pin; saved pins come back
  pins = createPins({ area: () => S.size, anchor: anchorOf })
  board = createBoard(feed, { pins, views, anchorOf, onPick: (s) => pick(s), reduced })
  for (const sel of pins.saved()) if (sel && views.alive(sel)) pinSel(sel)
  cache.on(() => { pins.redraw(); hud.repeek() })
  hud.board = board; hud.boardOn(board.shown)
  hud.views = { views, cache, pin: pinSel }
  const scenePanel = createScenePanel({ mount: hud.scene, looks, day: sun, every: feed.mode === 'demo' ? 40000 : 15 * 60000 })

  const head = (w) => w.b.position.clone().add(tmp.set(0, 1.75, 0))
  const lidSpring = { t: 9 }

  feed.on((e) => {
    if (e.type === 'sync' || e.type === 'status') return sync()
    const w = W.get(e.who) || W.get(e.from)
    if (e.type === 'edit' && w) {
      w.code.flash()
      const s = w.stacks.get(e.key); if (s) s.userData.bump = 1
    }
    if (e.type === 'msg' && w && W.get(e.to)) planeTo(w, W.get(e.to))
    if (e.type === 'clash' && w && W.get(e.other)) clash(w, W.get(e.other), e.key)
    if (e.type === 'commit' && w) commit(w)
  })

  function planeTo(w, to) {
    if (reduced.matches) return
    const plane = paperPlane(Mx(C.plane, { side: THREE.DoubleSide }))
    const a = head(w), b = head(to)
    const tr = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => a.clone())), noInk(new THREE.LineBasicMaterial({ color: C.trail, transparent: true, opacity: 0.6, toneMapped: false })))
    tr.frustumCulled = false; scene.add(tr)
    const side = Math.sign((b.x - a.x) * 0.7 - (b.z - a.z)) || 1
    const prev = new THREE.Vector3()
    fly(plane, 1.6, (k, o) => {
      const kk = ease(k), p = arc(a, b, kk, 3.2)
      p.addScaledVector(tmp.set(-(b.z - a.z), 0, b.x - a.x).normalize(), Math.sin(Math.PI * kk) * 1.2 * side)
      prev.copy(o.position); o.position.copy(p)
      if (k > 0) { o.lookAt(p.clone().multiplyScalar(2).sub(prev)); o.rotateZ(-side * Math.sin(Math.PI * kk) * 0.7) }
      const arr = tr.geometry.attributes.position.array; arr.copyWithin(3, 0, arr.length - 3); arr[0] = p.x; arr[1] = p.y; arr[2] = p.z
      tr.geometry.attributes.position.needsUpdate = true
    }, () => { fly(tr, 0.5, (k, l) => (l.material.opacity = 0.6 * (1 - k))); to.b.userData.land = 0.6 })
  }
  function clash(w, o, key) {
    w.shake = o.shake = 1.4
    w.b.userData.land = o.b.userData.land = -0.6
    const s = o.stacks.get(key); if (s) s.userData.flash = 2.4
    const s2 = w.stacks.get(key); if (s2) s2.userData.flash = 2.4
    if (reduced.matches) return
    const a = head(w).setY(1.4), b = head(o).setY(1.4)
    const gm = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 30 }, (_, i) => arc(a, b, i / 29, 1.2)))
    const line = new THREE.Line(gm, noInk(new THREE.LineDashedMaterial({ color: ALERT, dashSize: 0.25, gapSize: 0.15, transparent: true, toneMapped: false })))
    line.computeLineDistances()
    fly(line, 2.4, (k, l) => { l.material.opacity = 1 - k * k; l.material.dashOffset = -k * 3 })
    const mid = arc(a, b, 0.5, 1.2)
    confetti(fly, mid, [ALERT, '#ffd2b8'], { n: 12, up: 2, out: 1.4, dur: 0.8, size: 0.07 })
    for (let i = 0; i < 7; i++) {
      const st = emote('✦', { color: i % 2 ? ALERT : '#ffd23f', bg: null, h: 0.7, font }), an = (i / 7) * Math.PI * 2
      fly(st, 0.7, (k, ob) => { ob.position.copy(mid).addScaledVector(camRight, Math.cos(an) * k * 1.6).add(tmp.set(0, Math.sin(an) * k * 1.3, 0)); const sc = 0.7 * easeOutBack(Math.min(1, k * 3)) * (1 - k * k); ob.scale.set(sc, sc, 1) })
    }
  }
  function commit(w) {
    const pop = () => { lidSpring.t = 0; lid.material.emissiveIntensity = 2.4; confetti(fly, new THREE.Vector3(0, 1.3, 0), [w.x.color, ...T.confetti]); yard.plant(w.x.color, new THREE.Vector3(0, 1.3, 0)) }
    // already on an errand, or reduced motion: no walk, only the lid
    if (w.errand || reduced.matches) return pop()
    w.errand = true
    w.b.userData.land = 1
    setTimeout(() => {
      if (!W.has(w.x.id)) return
      w.b.userData.land = -0.9
      const parcel = bx(0.6, 0.45, 0.6, M(w.x.color)); parcel.add(bx(0.62, 0.47, 0.1, paperM))
      parcel.position.set(0, 2.05, 0.1); parcel.scale.setScalar(0.001); w.b.add(parcel)
      fly(new THREE.Object3D(), 0.35, (k) => parcel.scale.setScalar(Math.max(0.001, easeOutBack(k, 2.4))))
      const sx = Math.sign(w.home.x) || 1, sz = Math.sign(w.home.z) || 1
      goTo(w.b, 0.9 * sx, 0.9 * sz, () => {
        const wp = parcel.getWorldPosition(new THREE.Vector3()); parcel.removeFromParent()
        parcel.position.copy(wp); parcel.scale.setScalar(1.25)
        const top = new THREE.Vector3(0, 1.3, 0)
        fly(parcel, 0.55, (k, o) => { o.position.copy(arc(wp, top, k * k, 0.8)); o.rotation.y = k * 3; o.scale.setScalar(1.25 * (1 - k * 0.8)) }, pop)
        w.b.userData.land = 0.5; beat(w.b, 'cheer', 0.9)
        setTimeout(() => { w.errand = false; const at = w.idleAt ?? [w.home.x, w.home.z]; goTo(w.b, at[0], at[1]) }, 350)
      })
    }, 280)
  }

  // per frame: grow wave, figures, beats, stacks, emotes, tags, pins
  let shadowTick = 0, clockAt = 0
  S.onFrame((dt, t) => {
    const now = performance.now()
    for (let i = grow.length - 1; i >= 0; i--) {
      const q = grow[i], k = Math.min(1, Math.max(0, (now - q.at) / (q.out ? 350 : 550)))
      q.o.scale.copy(q.s).multiplyScalar(Math.max(0.0001, q.out ? 1 - ease(k) : easeOutBack(k)))
      if (k >= 1) { grow.splice(i, 1); q.done?.() }
    }
    // rooms and desks slide to new spots
    for (const r of ROOMS.values()) r.grp.position.lerp(r.grp.userData.to, 1 - Math.exp(-dt * 5))
    lidSpring.t += dt
    const sp = 1 + Math.exp(-5 * lidSpring.t) * Math.sin(lidSpring.t * 22) * 0.35
    lid.scale.set(sp, sp, 1 / sp); base.scale.set(1 / Math.sqrt(sp), sp ** 0.5, 1 / Math.sqrt(sp))
    lid.material.emissiveIntensity *= Math.exp(-dt * 2.5)
    for (const p of plants) p.userData.leaves.rotation.z = Math.sin(t * 0.9 + p.userData.ph) * 0.05
    looks.frame(dt); sun.frame(dt); scenePanel.frame()
    poolM.opacity = sun.st.lamp * 0.42
    if (now - clockAt > 1000 && clock) {
      clockAt = now
      const d = new Date(), sec = d.getSeconds(), mn = d.getMinutes() + sec / 60
      clock.userData.s.rotation.z = (-sec / 60) * Math.PI * 2; clock.userData.m.rotation.z = (-mn / 60) * Math.PI * 2; clock.userData.h.rotation.z = (-((d.getHours() % 12) + mn / 60) / 12) * Math.PI * 2
    }
    camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    for (const w of W.values()) {
      const { x, b } = w, u = b.userData
      w.desk.position.lerp(w.desk.userData.to, 1 - Math.exp(-dt * 5))
      const ph0 = u.phase
      const moving = stride(b, dt)
      if (moving && !reduced.matches && Math.floor(u.phase) !== Math.floor(ph0)) {
        const pf = new THREE.Mesh(geo('puff', () => new THREE.SphereGeometry(0.16, 8, 6)), basic({ color: C.puff, transparent: true, opacity: 0.8, depthWrite: false }))
        pf.position.copy(b.position).add(tmp.set(Math.floor(u.phase) % 2 ? 0.2 : -0.2, 0.12, 0))
        fly(pf, 0.55, (k, ob) => { ob.scale.setScalar(0.6 + k * 1.6); ob.position.y = 0.12 + k * 0.25; ob.material.opacity = 0.8 * (1 - k) })
      }
      const at = !moving && b.position.distanceTo(w.home) < 0.1
      let mode = moving ? 'walk' : 'stand'
      if (!moving) {
        if (at) turnTo(b, u.beat?.kind === 'look' ? (u.lookYaw ?? 0) * Math.sin(Math.PI * u.beat.k) : 0, dt)
        if (x.state === 'work' && at) mode = 'type'
        else if (x.state === 'blocked') mode = 'blocked'
        else if (x.state === 'idle') { mode = 'idle'; if (!at) turnTo(b, Math.atan2(-b.position.x, -b.position.z), dt, 3) }
        // back at work but away from the desk (after an errand): walk home
        if (x.state !== 'idle' && !at && !u.target && !w.errand) goTo(b, w.home.x, w.home.z)
      }
      if (!reduced.matches && !moving) fidget(w, mode, dt)
      act(b, mode, t, dt)
      if (w.shake > 0) { w.shake -= dt; u.rig.position.x = Math.sin(t * 60) * 0.05 } else u.rig.position.x = 0
      const blocked = x.state === 'blocked'
      w.ring.material.opacity = blocked ? 0.55 + Math.sin(t * 6) * 0.35 : 0
      w.ring.scale.setScalar(blocked ? 1 + ((t * 0.8) % 1) * 0.35 : 1)
      w.lamp.material.emissive.copy(blocked ? ALERT_C : WARM)
      w.lamp.material.emissiveIntensity = blocked ? 1.6 + Math.sin(t * 6) : sun.st.lamp * 1.1
      w.pool.visible = sun.st.lamp > 0.02
      w.code.step(dt, x.state === 'work' && at ? 2.2 : 0.15)
      const show = blocked ? 'blocked' : x.state === 'idle' && !moving ? 'idle' : null
      for (const [k, e] of Object.entries(w.emo)) {
        const d = e.userData
        d.pop = k === show ? Math.min(1, d.pop + dt * 3) : Math.max(0, d.pop - dt * 4)
        e.visible = d.pop > 0.01
        if (!e.visible) continue
        const s = k === show ? easeOutBack(d.pop, 2.2) : d.pop
        const bob = k === 'idle' ? ((t * 0.6) % 1) * 0.4 : Math.sin(t * 4 + u.seed) * 0.06
        e.position.copy(b.position).addScaledVector(camRight, 0.2).add(tmp.set(0, 3.25 + bob, 0))
        e.scale.set(d.h * s * 0.914, d.h * s, 1)
        e.material.opacity = k === 'idle' ? 1 - ((t * 0.6) % 1) * 0.6 : 1
      }
      const pk = picked && (picked.session === x.id || (picked.task && picked.task === x.taskId))
      w.rug.material.opacity = x.taskId ? (pk ? 0.55 : 0.22) : 0.06
      for (const [k, s] of w.stacks) stackStep(s, dt, t, k === x.focus)
      for (const s of [...w.desk.children]) if (s.userData.gone) {
        s.userData.gone -= dt * 3
        if (s.userData.gone <= 0) { s.removeFromParent(); free(s) } else s.scale.setScalar(s.userData.gone)
      }
    }
    for (const w of W.values()) { const [sx, sy, vis] = S.project(head(w)); hud.place(w.x.id, sx, sy, vis) }
    hud.frame()
    pins?.frame(); board?.frame()
    // shadows: every other frame (the world is mostly still)
    renderer.shadowMap.needsUpdate = (shadowTick++ & 1) === 0
  })
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  // fidgets: a working figure stretches, sips, thinks, looks round; an idle one strolls, stretches, hops
  const pickOf = (a) => a[Math.floor(Math.random() * a.length)]
  function fidget(w, mode, dt) {
    const u = w.b.userData
    u.nextBeat = (u.nextBeat ?? 2 + Math.random() * 4) - dt
    if (u.nextBeat > 0 || u.beat || w.errand) return
    if (mode === 'type') { u.nextBeat = 3.5 + Math.random() * 4; beat(w.b, pickOf(['stretch', 'sip', 'sip', 'think', 'look']), 1.1 + Math.random() * 0.6); if (u.beat.kind === 'look') u.lookYaw = (Math.random() - 0.5) * 1.6 }
    else if (mode === 'idle' && w.idleAt) {
      u.nextBeat = 3 + Math.random() * 4
      const k = Math.random()
      if (k < 0.45) { const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.9; goTo(w.b, w.idleAt[0] + Math.cos(a) * r, w.idleAt[1] + Math.sin(a) * r) }
      else beat(w.b, k < 0.75 ? 'stretch' : k < 0.9 ? 'look' : 'hop', 1.4)
    } else if (mode === 'blocked') { u.nextBeat = 2.5 + Math.random() * 2; beat(w.b, 'hop', 0.9) }
    else u.nextBeat = 2
  }
  function stackStep(s, dt, t, focus) {
    const d = s.userData
    d.grow = Math.min(1, d.grow + dt * 3)
    d.bump = Math.max(0, d.bump - dt * 2.2)
    const h = d.h * easeOutBack(d.grow), sq = Math.sin(d.bump * Math.PI)
    d.p.scale.set(1 + sq * 0.12, Math.max(0.01, h * (1 - sq * 0.15)), 1 + sq * 0.12)
    d.p.position.y = 1.06 + (h * (1 - sq * 0.15)) / 2
    d.band.position.y = 1.06 + h * (1 - sq * 0.15) + 0.02
    s.position.y = sq * 0.22
    if (d.flash > 0) { d.flash -= dt; d.p.material = d.flash > 0 && Math.sin(t * 16) > 0 ? alertM : paperM }
    d.band.scale.setScalar(focus ? 1.25 : 1)
  }
}

// paper plane: nose on +z, folded wings, keel
function paperPlane(mat) {
  const v = [0, 0, 0.36, -0.24, 0.03, -0.2, 0, 0, -0.2, 0, 0, 0.36, 0, 0, -0.2, 0.24, 0.03, -0.2, 0, 0, 0.36, 0, 0, -0.2, 0, -0.1, -0.2]
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals()
  const m = new THREE.Mesh(g, mat); m.castShadow = true
  return m
}

// window pane: day sky, clouds, hills
function windowTex(seed) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 140
  const g = c.getContext('2d')
  let r = seed * 977 + 7
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647
  const grad = g.createLinearGradient(0, 0, 0, 140)
  grad.addColorStop(0, '#9fd0f0'); grad.addColorStop(1, '#e4f3fb'); g.fillStyle = grad; g.fillRect(0, 0, 512, 140)
  g.fillStyle = '#ffffff'
  for (let i = 0; i < 4; i++) { const cx = rnd() * 512, cy = 25 + rnd() * 50; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + k * 18, cy + Math.sin(k) * 6, 16 + rnd() * 8, 0, 7); g.fill() } }
  g.fillStyle = '#b9dca0'; g.beginPath(); g.moveTo(0, 140); for (let x = 0; x <= 512; x += 32) g.lineTo(x, 112 + Math.sin(x * 0.02 + seed) * 10); g.lineTo(512, 140); g.fill()
  g.fillStyle = '#ffffff'; for (const x of [0, 170, 340, 508]) g.fillRect(x, 0, 6, 140); g.fillRect(0, 0, 512, 5); g.fillRect(0, 135, 512, 5)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.shared = true
  return t
}

// soft round glow: lamp light on the floor
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c); t.userData.shared = true
  return t
}

// a centred note over the scene: empty office, no match, connecting, offline, no WebGL
function createNote() {
  const el = document.createElement('div'); el.className = 'office-note'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite')
  document.body.append(el)
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const TEXT = {
    empty: ['No live sessions', 'A session shows here once it edits a file, commits or claims a task.'],
    connecting: ['Connecting to peers view…', ''],
    offline: ['Lost the peers view server', 'It retries by itself. To start it again: <code>peers view</code>'],
    lost: ['Graphics paused', 'The browser reset the GPU. The page reloads when it comes back.'],
    noGl: ['No 3D in this browser', 'WebGL is off or not there. The list shows every session.'],
  }
  let at = null, timer = 0
  return {
    el,
    set(k, only) {
      if (k === at) return
      at = k
      clearTimeout(timer)
      const show = () => {
        if (!k) { el.classList.remove('on'); return }
        const [h, p] = k === 'nomatch'
          ? ['No live session matches', `Asked: ${esc(only.asked.join(', '))}.${only.live.length ? ` Live: ${esc(only.live.join(', '))}.` : ''}`]
          : TEXT[k]
        el.innerHTML = `<b>${h}</b>${p ? `<span>${p}</span>` : ''}`
        el.classList.toggle('alert', k === 'offline' || k === 'lost')
        el.classList.add('on')
      }
      // a quick connect never flashes the note
      if (k === 'connecting') timer = setTimeout(show, 700); else show()
    },
  }
}
