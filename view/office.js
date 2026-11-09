// Shared office scene (batch 4): rooms per repo, desks, the task board, strings card → desk. A theme sets the look.
// theme: see themes.js. Same sim, same layout in every style; only materials, light, post and pace change.
import { createSim, REPOS } from './sim.js'
import { createHud } from './hud.js'
import { createDock } from './dock.js'
import { THREE, stage, box, goTo, flights, arc, ease, textPlane, navigate, easeOutBack, stepped, figure, stride, turnTo, act, emote, codeScreen, paperPlane, confetti } from './kit.js'

export async function office(T) {
  if (T.gfont) await new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?${T.gfont}&display=block`; l.onload = l.onerror = ok; document.head.append(l) })
  const fonts = [T.font, T.hand, T.mono].filter((f) => f && !f.startsWith('ui-'))
  await Promise.all(fonts.map((f) => document.fonts.load(`600 40px "${f}"`).catch(() => {})))
  const F = (f) => (f && !f.startsWith('ui-') ? `"${f}",ui-sans-serif,sans-serif` : 'ui-sans-serif,-apple-system,sans-serif')
  const font = F(T.font), hand = F(T.hand ?? T.font)
  const st = document.createElement('style')
  st.textContent = `:root{${T.css}}html,body{margin:0;height:100%;overflow:hidden;background:${T.bg}}canvas{display:block${T.pixel ? ';image-rendering:pixelated' : ''}}`
  document.head.append(st)

  const C = T.c, ALERT = T.alert
  const sim = createSim()
  const hud = createHud(sim, { title: `peers · ${T.title}` })
  const dock = createDock(sim, { tasks: true, tab: 'tasks', onPick: (s) => pick(s, true) })
  addEventListener('resize', () => location.reload())
  const span = dock.side ? 33 : 29
  const S = stage({ bg: T.bg, span, inset: dock.inset, fov: T.fov ?? 0, shadows: T.shadows !== false })
  const { scene, camera, renderer } = S
  if (T.pixel) renderer.setPixelRatio(1)
  if (T.tone) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = T.tone }
  if (T.fov) {
    // perspective: back off so `span` fits the short side
    const a = camera.aspect, half = a < 1 ? span / 2 / a : span / 2
    camera.position.set(1, 0.93, 1).normalize().multiplyScalar((half / Math.tan((T.fov * Math.PI) / 360)) * 1.02)
    camera.lookAt(0, 0, 0)
  }
  const onStep = (f) => S.onFrame(stepped(T.fps, f))
  const fly = flights(scene, onStep)
  const M = (color, extra) => T.mat(color, extra)
  T.lights(scene, S)

  // floor, rooms, walls
  const floor = box(27, 0.5, 27, M(C.floor)); floor.position.y = -0.25; scene.add(floor)
  const ROOM = { wren: [-6.6, -6.6], peers: [6.6, -6.6], vireo: [-6.6, 6.6], engine: [6.6, 6.6] }
  const label = (s, o = {}) => textPlane(s, { color: C.label, font: hand, weight: T.hand ? 700 : 600, ...o })
  for (const r of REPOS) {
    const [x, z] = ROOM[r.id]
    const f = box(11.4, 0.06, 11.4, M(C.tint[r.id])); f.position.set(x, 0.03, z); scene.add(f)
    const l = label(r.id); l.position.set(x - 3.4, 0.08, z + 4.9); scene.add(l)
  }
  const wallM = M(C.wall), partM = M(C.part ?? C.wall)
  const wall = (w, d, x, z, h = 2.2, m = wallM) => { const b = box(w, h, d, m); b.position.set(x, h / 2, z); scene.add(b); return b }
  wall(27, 0.4, 0, -13.3); wall(0.4, 27, -13.3, 0)
  for (const s of [-1, 1]) { wall(0.3, 6.5, 0, s * 9.75, 0.9, partM); wall(6.5, 0.3, s * 9.75, 0, 0.9, partM) }
  if (T.windows) for (const [x, z, ry] of [[-3, -13.08, 0], [3.4, -13.08, 0], [9.6, -13.08, 0], [-13.08, -3, Math.PI / 2], [-13.08, 3.4, Math.PI / 2], [-13.08, 9.6, Math.PI / 2]]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.15), new THREE.MeshBasicMaterial({ map: windowTex(T.windows, x + z), toneMapped: false }))
    w.material.color.setScalar(T.windows === 'night' ? 1.6 : 1)
    w.position.set(x, 1.35, z); w.rotation.y = ry; scene.add(w)
    const sill = box(4.4, 0.08, 0.18, M(C.trim ?? C.desk)); sill.position.set(x + (ry ? 0.05 : 0), 0.74, z + (ry ? 0 : 0.05)); sill.rotation.y = ry; scene.add(sill)
  }

  // plaza: main dropbox, sofas, plants
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.05, 48), M(C.rug)); rug.position.y = 0.05; rug.receiveShadow = true; scene.add(rug)
  const main = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.1, 32), M(C.main)); base.position.y = 0.55; base.castShadow = true
  const lid = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 12, 32), M(C.lid, { emissive: T.glow ?? '#ffb36b', emissiveIntensity: 0 }))
  lid.rotation.x = Math.PI / 2; lid.position.y = 1.12
  main.add(base, lid); scene.add(main)
  const ml = label('main', { size: 56 }); ml.scale.setScalar(0.6); ml.position.set(-0.5, 0.09, 1.6); scene.add(ml)
  const SOFA = [[-2.2, 2.2], [2.2, -2.2]]
  const sofas = SOFA.map(([x, z]) => {
    const s = new THREE.Group(), m = M(C.sofa)
    s.add(box(2.4, 0.5, 1, m)); const back = box(2.4, 0.6, 0.3, m); back.position.set(0, 0.45, -0.38); s.add(back)
    for (const e of [-1, 1]) { const arm = box(0.28, 0.4, 1, m); arm.position.set(e * 1.2, 0.3, 0); s.add(arm) }
    s.position.set(x, 0.25, z); s.lookAt(0, 0.25, 0); scene.add(s); return s
  })
  const plants = [[12, -12], [-12, 12], [12, 12], [2.6, 2.6], [-2.6, -2.6]].map(([x, z], i) => {
    const p = new THREE.Group()
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.55, 20), M(C.pot)); pot.position.y = 0.28; pot.castShadow = true; p.add(pot)
    const leaves = new THREE.Group(); leaves.position.y = 0.55; p.add(leaves)
    for (let k = 0; k < 3; k++) {
      const l = new THREE.Mesh(T.leaf === 'cone' ? new THREE.ConeGeometry(0.42 - k * 0.1, 0.6, 7) : new THREE.IcosahedronGeometry(0.36 - k * 0.06, T.flat ? 0 : 1), M(k % 2 ? C.leaf2 ?? C.leaf : C.leaf))
      l.position.set(Math.sin(k * 2.1) * 0.12, 0.3 + k * 0.32, Math.cos(k * 2.1) * 0.12); l.castShadow = true; leaves.add(l)
    }
    p.position.set(x, 0, z); p.userData = { leaves, ph: i * 1.7 }; scene.add(p); return p
  })

  // desks + figures
  const SLOTS = { wren: [[-2.6, 0], [2.6, 0]], peers: [[0, 0]], vireo: [[0, 0]], engine: [[-2.6, 0], [2.6, 0]] }
  const used = {}, W = {}
  const paperM = M(C.paper), alertM = M(ALERT)
  const deskM = M(C.desk), legM = M(C.leg), bezelM = M(C.bezel)
  for (const x of sim.sessions) {
    const i = (used[x.repo] = (used[x.repo] ?? -1) + 1)
    const [rx, rz] = ROOM[x.repo], [ox, oz] = SLOTS[x.repo][i]
    const dx = rx + ox, dz = rz + oz
    const desk = new THREE.Group()
    const top = box(2.6, 0.12, 1.2, deskM); top.position.y = 1.0; desk.add(top)
    for (const [lx, lz] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]]) { const l = box(0.1, 1, 0.1, legM); l.position.set(lx, 0.5, lz); desk.add(l) }
    // monitor: bezel + a code face on each side (readable from the chair and from the camera)
    const mon = new THREE.Group(); mon.position.set(-0.55, 1.52, -0.3)
    const bez = box(1.2, 0.78, 0.06, bezelM); mon.add(bez)
    const stand = box(0.08, 0.4, 0.08, bezelM); stand.position.y = -0.5; mon.add(stand)
    const code = codeScreen(x.id + x.repo, { ...T.screen, accent: x.color, font: T.mono })
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.66), code.mat); f.position.z = s * 0.035; if (s < 0) f.rotation.y = Math.PI; mon.add(f) }
    desk.add(mon)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), M(C.lamp, { emissive: ALERT, emissiveIntensity: 0 }))
    lamp.position.set(1.05, 1.2, -0.35); desk.add(lamp)
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.18, 14), M(x.color)); mug.position.set(0.55, 1.15, -0.4); mug.castShadow = true; desk.add(mug)
    let light = null
    if (T.deskLight) { light = new THREE.PointLight(T.deskLight, 0, 7, 1.6); light.position.set(0.2, 2.2, -0.2); desk.add(light) }
    desk.position.set(dx, 0, dz); scene.add(desk)
    const b = figure(x.color, { mat: M, kind: T.figure, ink: C.ink, rim: C.rim })
    b.scale.setScalar(1.25)
    const home = new THREE.Vector3(dx, 0, dz - 1.15)
    b.position.copy(home); scene.add(b)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 40), new THREE.MeshBasicMaterial({ color: ALERT, transparent: true, opacity: 0, toneMapped: false }))
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; b.add(ring)
    const emo = {}
    for (const [k, s] of [['blocked', '!'], ['idle', 'zz'], ['wait', '…']]) {
      const e = emote(s, k === 'blocked' ? { color: '#fff', bg: ALERT, font } : { color: C.ink, bg: C.bubble, ring: C.bubbleRing, font })
      e.visible = false; scene.add(e); emo[k] = e
    }
    W[x.id] = { x, b, desk, code, lamp, light, ring, emo, home, stacks: new Map(), errand: false, shake: 0, sofa: SOFA[i % 2], was: null }
    for (const [f, n] of x.holds) setStack(W[x.id], f, n)
  }

  function setStack(w, file, lines) {
    let s = w.stacks.get(file)
    if (!s) {
      s = new THREE.Group()
      const p = box(0.36, 1, 0.46, paperM); p.position.y = 0.5; s.add(p)
      const band = box(0.38, 0.05, 0.48, M(w.x.color)); s.add(band)
      s.userData = { p, band, bump: 0.6, grow: 0 }
      w.desk.add(s); w.stacks.set(file, s)
      let i = 0
      for (const q of w.stacks.values()) { q.position.set(0.05 + (i % 4) * 0.42, 0, 0.25 - Math.floor(i / 4) * 0.5); i++ }
    }
    s.userData.h = Math.min(0.08 + lines / 120, 0.9)
  }
  function clearStacks(w) {
    // stacks shrink away, then go
    for (const s of w.stacks.values()) s.userData.gone = 1
    w.stacks = new Map()
  }

  // board: billboard over the back corner
  const COLS = ['In Progress', 'Blocked', 'To Do', 'Done']
  const BW = 13, BH = 4.6
  const board = new THREE.Group(); board.position.set(-11.6, 0.9, -11.6); board.lookAt(30, 28.9, 30); scene.add(board)
  const cork = box(BW, BH, 0.14, M(C.cork)); cork.position.y = BH / 2; board.add(cork)
  const frame = box(BW + 0.3, BH + 0.3, 0.1, M(C.frame)); frame.position.set(0, BH / 2, -0.08); board.add(frame)
  const colX = (i) => -BW / 2 + BW / 8 + i * BW / 4
  COLS.forEach((c, i) => {
    const h = textPlane(c, { w: 3, size: 64, color: c === 'Blocked' ? ALERT : C.head, font: hand, weight: 700 }); h.rotation.x = 0; h.position.set(colX(i) - 0.35, BH - 0.32, 0.09); board.add(h)
    if (i) { const d = box(0.04, BH - 0.3, 0.02, M(C.frame)); d.position.set(colX(i) - BW / 8, BH / 2 - 0.1, 0.08); board.add(d) }
  })
  const CARD = {}
  for (const t of sim.tasks) {
    const g = new THREE.Group()
    const mat = M(C.card[t.status], { emissive: '#000000', emissiveIntensity: 0 })
    const c = box(1.6, 0.78, 0.05, mat); g.add(c)
    const a = textPlane(t.id, { w: 1.5, size: 70, color: C.ink, font, weight: 700 }); a.rotation.x = 0; a.position.set(0, 0.17, 0.035); g.add(a)
    const b = textPlane(t.title, { w: 1.5, size: 50, color: C.sub, font }); b.rotation.x = 0; b.position.set(0, -0.15, 0.035); g.add(b)
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), M(t.status === 'Blocked' ? ALERT : C.pin)); pin.position.set(0, 0.33, 0.06); g.add(pin)
    g.userData = { pick: { task: t.id }, mat, pin, to: new THREE.Vector3(), from: new THREE.Vector3(), k: 1, lift: 0, status: t.status }
    board.add(g); CARD[t.id] = g
  }
  function layoutCards(snap) {
    const n = {}
    for (const t of sim.tasks) {
      const i = COLS.indexOf(t.status), k = (n[t.status] = (n[t.status] ?? -1) + 1)
      const g = CARD[t.id], u = g.userData
      const to = new THREE.Vector3(colX(i) + (k % 2 ? 0.85 : -0.85), BH - 1.0 - Math.floor(k / 2) * 0.92, 0.12)
      if (snap) { g.position.copy(to); u.to.copy(to); continue }
      if (to.distanceTo(u.to) > 0.01) { u.from.copy(g.position); u.to.copy(to); u.k = 0 }
      if (u.status !== t.status) {
        u.status = t.status
        u.mat.color.set(C.card[t.status]); u.pin.material.color.set(t.status === 'Blocked' ? ALERT : C.pin)
        if (t.status === 'Done') setTimeout(() => confetti(fly, board.localToWorld(to.clone()), T.confetti, { n: 18, up: 2.6, out: 1.2, size: 0.08 }), 800)
      }
    }
  }
  layoutCards(true)

  // strings: held card → holder's lamp; draw in on claim, sway a little
  const STR = new Map()
  const pts = 40
  function syncStrings() {
    const want = new Set()
    for (const t of sim.tasks) for (const h of t.holders ?? []) {
      if (!W[h]) continue
      const key = `${t.id}|${h}`; want.add(key)
      if (!STR.has(key)) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts * 3), 3))
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: W[h].x.color, transparent: true, opacity: 0.9, toneMapped: false }))
        line.frustumCulled = false; scene.add(line)
        STR.set(key, { line, task: t.id, who: h, k: 0, ph: Math.random() * 6 })
      }
    }
    for (const [key, s] of STR) if (!want.has(key)) s.drop = true
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3()
  function drawStrings(dt, t) {
    for (const [key, s] of STR) {
      s.k = s.drop ? s.k - dt * 2 : Math.min(1, s.k + dt * 1.2)
      if (s.k <= 0 && s.drop) { scene.remove(s.line); STR.delete(key); continue }
      const g = CARD[s.task]
      board.localToWorld(A.copy(g.position).setY(g.position.y - 0.38))
      W[s.who].lamp.getWorldPosition(B)
      const arr = s.line.geometry.attributes.position.array
      const sag = 1.1 + Math.sin(t * 1.3 + s.ph) * 0.12
      for (let i = 0; i < pts; i++) {
        const k = i / (pts - 1)
        P.lerpVectors(A, B, k); P.y -= Math.sin(Math.PI * k) * sag
        arr[i * 3] = P.x; arr[i * 3 + 1] = P.y; arr[i * 3 + 2] = P.z
      }
      s.line.geometry.attributes.position.needsUpdate = true
      s.line.geometry.setDrawRange(0, Math.ceil(ease(Math.max(0, s.k)) * pts))
      const on = !picked || picked.task === s.task || picked.session === s.who
      s.line.material.opacity = on ? 0.9 : 0.15
    }
  }
  syncStrings()

  const RUG = {}
  for (const w of Object.values(W)) {
    const r = box(3.6, 0.03, 3.2, M(w.x.color, { transparent: true, opacity: 0.22 })); r.position.set(w.desk.position.x, 0.075, w.desk.position.z - 0.35); r.castShadow = false; scene.add(r); RUG[w.x.id] = r
    w.desk.userData.pick = { session: w.x.id }; w.b.userData.pick = { session: w.x.id }
  }
  const held = (id) => !!sim.byId[id].taskId && sim.taskById[sim.byId[id].taskId].holders?.includes(id)

  // pencil edges (paper) / outline opt-outs (toon)
  if (T.edges) {
    const em = new THREE.LineBasicMaterial({ color: T.edges, transparent: true, opacity: 0.75 })
    scene.traverse((o) => {
      if (!o.isMesh || o.material.isMeshBasicMaterial || o.geometry.type === 'PlaneGeometry' || o.geometry.type === 'RingGeometry') return
      o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 35), em))
    })
  }
  const noOutline = (root) => root.traverse((o) => { if (o.isMesh && (o.material.isMeshBasicMaterial || o.material.transparent)) o.material.userData.outlineParameters = { visible: false } })
  noOutline(scene)

  // grow in: things pop up in a wave from the plaza
  const grow = []
  const addGrow = (o, d) => { grow.push({ o, d, s: o.scale.clone() }); o.scale.setScalar(0.0001) }
  addGrow(main, 0); sofas.forEach((s, i) => addGrow(s, 0.15 + i * 0.1)); plants.forEach((p, i) => addGrow(p, 0.4 + i * 0.12))
  Object.values(W).forEach((w, i) => { addGrow(w.desk, 0.3 + i * 0.12); addGrow(w.b, 0.6 + i * 0.12) })
  addGrow(board, 0.5)

  // pick + nav
  let picked = null
  function pick(s, fromDock) {
    picked = s
    if (!fromDock) dock.inspect(s)
    for (const g of Object.values(CARD)) g.userData.lift = 0
    if (s?.task) { CARD[s.task].userData.lift = 1; nav.flyTo(board.localToWorld(CARD[s.task].userData.to.clone()).setY(2), 1.6) }
    if (s?.session) { const t = sim.byId[s.session].taskId; if (t) CARD[t].userData.lift = 1; nav.flyTo(W[s.session].desk.position.clone().setY(1), 1.6) }
  }
  const tip = (p) => {
    if (p.session) { const x = sim.byId[p.session]; return `<b>${x.name}</b> <span>${x.taskId ?? ''} ${x.task}</span>` }
    const t = sim.taskById[p.task]; return `<b>${t.id} ${t.title}</b><br><span>${t.status}${t.on ? ` · on ${t.on}` : ''} · ${t.files.size} files · ${t.commits.length} commits</span>`
  }
  board.updateMatrixWorld(true)
  const nav = navigate(S, { pickables: () => [...Object.values(CARD), ...Object.values(W).flatMap((w) => [w.desk, w.b])], onPick: (p) => pick(p), tip })
  // intro: swing in from a wider, turned view
  {
    const h = nav.home, r = h.pos.clone().sub(h.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55)
    camera.position.copy(h.target).add(r.multiplyScalar(T.fov ? 1.35 : 1)); camera.zoom = h.zoom * (T.fov ? 1 : 0.72); camera.updateProjectionMatrix()
    nav.flyTo(h.target, h.zoom, h.pos, 2.2)
  }
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)))
  if (Object.keys(q).length) setTimeout(() => pick(q), 2400)

  // post: theme builds the pass chain
  const post = T.post?.(S)
  if (post) S.usePost(post)

  const head = (w) => w.b.position.clone().add(new THREE.Vector3(0, 1.75, 0))
  const lidSpring = { t: 9 }

  sim.on((e) => {
    const w = W[e.who] || W[e.from]
    if (e.type === 'edit') {
      setStack(w, e.file, w.x.holds.get(e.file))
      w.code.flash()
      const s = w.stacks.get(e.file); if (s) s.userData.bump = 1
    }
    if (e.type === 'msg') {
      const to = W[e.to], plane = paperPlane(M(C.plane))
      const a = head(w), b = head(to)
      const tr = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => a.clone())), new THREE.LineBasicMaterial({ color: C.trail, transparent: true, opacity: 0.6, toneMapped: false }))
      tr.frustumCulled = false; scene.add(tr)
      const side = Math.sign((b.x - a.x) * 0.7 - (b.z - a.z)) || 1
      fly(plane, 1.6, (k, o) => {
        const kk = ease(k), p = arc(a, b, kk, 3.2)
        p.addScaledVector(new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize(), Math.sin(Math.PI * kk) * 1.2 * side)
        const prev = o.position.clone()
        o.position.copy(p)
        if (k > 0) { o.lookAt(p.clone().multiplyScalar(2).sub(prev)); o.rotateZ(-side * Math.sin(Math.PI * kk) * 0.7) }
        const arr = tr.geometry.attributes.position.array; arr.copyWithin(3, 0, arr.length - 3); arr[0] = p.x; arr[1] = p.y; arr[2] = p.z
        tr.geometry.attributes.position.needsUpdate = true
      }, () => { fly(tr, 0.5, (k, l) => (l.material.opacity = 0.6 * (1 - k))); to.b.userData.land = 0.6 })
    }
    if (e.type === 'clash') {
      const o = W[e.other]
      w.shake = o.shake = 1.4
      w.b.userData.land = o.b.userData.land = -0.6
      const a = head(w).setY(1.4), b = head(o).setY(1.4)
      const g = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 30 }, (_, i) => arc(a, b, i / 29, 1.2)))
      const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: ALERT, dashSize: 0.25, gapSize: 0.15, transparent: true, toneMapped: false }))
      line.computeLineDistances()
      fly(line, 2.4, (k, l) => { l.material.opacity = 1 - k * k; l.material.dashOffset = -k * 3 })
      const mid = arc(a, b, 0.5, 1.2)
      confetti(fly, mid, [ALERT, '#ffd2b8'], { n: 12, up: 2, out: 1.4, dur: 0.8, size: 0.07 })
      const s = o.stacks.get(e.file); if (s) s.userData.flash = 2.4
    }
    if (e.type === 'claim' || e.type === 'close') { layoutCards(); setTimeout(syncStrings, 700) }
    if (e.type === 'commit' && e.task) {
      const g = CARD[e.task], tag = box(0.3, 0.12, 0.02, M(w.x.color)); const n = sim.taskById[e.task].commits.length
      tag.position.set(-0.65 + ((n - 1) % 5) * 0.32, -0.42, 0.04); tag.scale.setScalar(0.001); g.add(tag); g.userData.lift = Math.max(g.userData.lift, 0.6)
      fly(new THREE.Object3D(), 0.4, (k) => tag.scale.setScalar(Math.max(0.001, easeOutBack(k))))
    }
    if (e.type === 'commit') {
      // anticipation: squash, then the parcel pops over the head
      w.errand = true
      w.b.userData.land = 1
      clearStacks(w)
      setTimeout(() => {
        w.b.userData.land = -0.9
        const parcel = box(0.6, 0.45, 0.6, M(w.x.color)); const ribbon = box(0.62, 0.47, 0.1, M(C.paper)); parcel.add(ribbon)
        parcel.position.set(0, 2.05, 0.1); parcel.scale.setScalar(0.001); w.b.add(parcel)
        fly(new THREE.Object3D(), 0.35, (k) => parcel.scale.setScalar(Math.max(0.001, easeOutBack(k, 2.4))))
        goTo(w.b, 0.9 * Math.sign(w.home.x), 0.9 * Math.sign(w.home.z), () => {
          const wp = parcel.getWorldPosition(new THREE.Vector3()); w.b.remove(parcel)
          const p = parcel.clone(); p.position.copy(wp); p.scale.setScalar(1.25)
          const top = new THREE.Vector3(0, 1.3, 0)
          fly(p, 0.55, (k, o) => { o.position.copy(arc(wp, top, k * k, 0.8)); o.rotation.y = k * 3; o.scale.setScalar(1.25 * (1 - k * 0.8)) }, () => {
            lidSpring.t = 0; lid.material.emissiveIntensity = 2.4
            confetti(fly, new THREE.Vector3(0, 1.3, 0), [w.x.color, ...T.confetti])
          })
          w.b.userData.land = 0.5
          setTimeout(() => goTo(w.b, w.home.x, w.home.z, () => { w.errand = false }), 350)
        })
      }, 280)
    }
    if (e.type === 'state' && !w.errand) {
      if (e.state === 'idle') goTo(w.b, w.sofa[0] * 1.15 + Math.sign(w.home.x) * 0.6, w.sofa[1] * 1.15 + Math.sign(w.home.z) * 0.6)
      else if (w.b.position.distanceTo(w.home) > 0.1) goTo(w.b, w.home.x, w.home.z)
    }
  })

  const camRight = new THREE.Vector3(), tmp = new THREE.Vector3()
  const t0 = performance.now()
  // figures + props run on the theme's pace (stepped for stop-motion / pixel)
  onStep((dt, t) => {
    const born = (performance.now() - t0) / 1000 // wall clock: slow frames still finish the wave
    for (const g of grow) {
      const k = Math.min(1, Math.max(0, (born - g.d) / 0.55))
      g.o.scale.copy(g.s).multiplyScalar(Math.max(0.0001, easeOutBack(k)))
    }
    if (born > 4) grow.length = 0
    lidSpring.t += dt
    const sp = 1 + Math.exp(-5 * lidSpring.t) * Math.sin(lidSpring.t * 22) * 0.35
    lid.scale.set(sp, sp, 1 / sp); base.scale.set(1 / Math.sqrt(sp), sp ** 0.5, 1 / Math.sqrt(sp))
    lid.material.emissiveIntensity *= Math.exp(-dt * 2.5)
    for (const p of plants) p.userData.leaves.rotation.z = Math.sin(t * 0.9 + p.userData.ph) * 0.05
    camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    for (const w of Object.values(W)) {
      const { x, b } = w, u = b.userData
      const moving = stride(b, dt)
      const at = !moving && b.position.distanceTo(w.home) < 0.1
      let mode = moving ? 'walk' : 'stand'
      if (!moving) {
        if (at) turnTo(b, 0, dt)
        if (x.state === 'work' && at) mode = 'type'
        else if (x.state === 'blocked') mode = 'blocked'
        else if (x.state === 'wait') { mode = 'wait'; const o = sim.sessions.find((s) => s.id !== x.id && s.state === 'work' && s.repo === x.repo) || sim.sessions[0]; turnTo(b, Math.atan2(W[o.id].b.position.x - b.position.x, W[o.id].b.position.z - b.position.z), dt, 3) }
        else if (x.state === 'idle') { mode = 'idle'; if (!at) turnTo(b, Math.atan2(-b.position.x, -b.position.z), dt, 3) }
      }
      act(b, mode, t, dt)
      if (u.kind === 'cutout') {
        // card faces the camera; flips to show which way it walks
        const yaw = Math.atan2(camera.position.x - b.position.x, camera.position.z - b.position.z)
        u.rig.rotation.y = yaw - b.rotation.y
        const sx = Math.sin(b.rotation.y - yaw) < -0.2 ? -1 : 1
        u.rig.scale.x += (sx - u.rig.scale.x) * Math.min(1, dt * 12)
      }
      if (w.shake > 0) { w.shake -= dt; u.rig.position.x = Math.sin(t * 60) * 0.05 } else u.rig.position.x = 0
      if (T.boil) u.rig.rotation.z = (Math.random() - 0.5) * T.boil
      const blocked = x.state === 'blocked'
      w.ring.material.opacity = blocked ? 0.55 + Math.sin(t * 6) * 0.35 : 0
      w.ring.scale.setScalar(blocked ? 1 + (t * 0.8 % 1) * 0.35 : 1)
      w.lamp.material.emissiveIntensity = blocked ? 1.6 + Math.sin(t * 6) : 0
      if (w.light) w.light.intensity = damp1(w.light.intensity, x.state === 'work' ? T.deskLux : x.state === 'blocked' ? T.deskLux * 0.7 : T.deskLux * 0.25, dt)
      if (w.light) w.light.color.set(blocked ? ALERT : T.deskLight)
      w.code.step(dt, x.state === 'work' && at ? 2.2 : 0.15)
      // emotes: the state's glyph pops in beside the head and bobs
      const show = blocked ? 'blocked' : x.state === 'idle' && !moving ? 'idle' : x.state === 'wait' ? 'wait' : null
      for (const [k, e] of Object.entries(w.emo)) {
        const d = e.userData
        d.pop = k === show ? Math.min(1, d.pop + dt * 3) : Math.max(0, d.pop - dt * 4)
        e.visible = d.pop > 0.01
        if (!e.visible) continue
        const s = k === show ? easeOutBack(d.pop, 2.2) : d.pop
        const bob = k === 'idle' ? (t * 0.6 % 1) * 0.4 : Math.sin(t * 4 + u.seed) * 0.06
        e.position.copy(b.position).addScaledVector(camRight, 0.2).add(tmp.set(0, 3.25 + bob, 0))
        e.scale.set(d.h * s * 0.914, d.h * s, 1)
        e.material.opacity = k === 'idle' ? 1 - (t * 0.6 % 1) * 0.6 : 1
      }
      for (const [f, s] of w.stacks) stackStep(s, dt, t, f === x.focus)
      for (const s of [...w.desk.children]) if (s.userData.gone) {
        s.userData.gone -= dt * 3
        if (s.userData.gone <= 0) w.desk.remove(s); else s.scale.setScalar(s.userData.gone)
      }
    }
  })
  function stackStep(s, dt, t, focus) {
    const d = s.userData
    d.grow = Math.min(1, d.grow + dt * 3)
    d.bump = Math.max(0, d.bump - dt * 2.2)
    const h = d.h * easeOutBack(d.grow)
    const sq = Math.sin(d.bump * Math.PI) // bump: hop with squash
    d.p.scale.set(1 + sq * 0.12, Math.max(0.01, h * (1 - sq * 0.15)), 1 + sq * 0.12)
    d.p.position.y = 1.06 + (h * (1 - sq * 0.15)) / 2
    d.band.position.y = 1.06 + h * (1 - sq * 0.15) + 0.02
    s.position.y = sq * 0.22
    if (d.flash > 0) { d.flash -= dt; d.p.material = d.flash > 0 && Math.sin(t * 16) > 0 ? alertM : paperM }
    d.band.scale.setScalar(focus ? 1.25 : 1)
  }
  const damp1 = (a, b, dt) => a + (b - a) * (1 - Math.exp(-dt * 4))

  // board cards + strings + tags: smooth every frame
  S.onFrame((dt, t) => {
    for (const [id, g] of Object.entries(CARD)) {
      const u = g.userData
      if (u.k < 1) {
        u.k = Math.min(1, u.k + dt / 0.9)
        const k = ease(u.k)
        g.position.lerpVectors(u.from, u.to, k)
        g.position.y += Math.sin(Math.PI * k) * 0.6
        g.rotation.z = Math.sin(u.k * Math.PI * 3) * (1 - u.k) * 0.3
      } else { g.position.copy(u.to); g.rotation.z = Math.sin(t * 1.4 + id.charCodeAt(5)) * 0.012 }
      g.position.z = u.to.z + u.lift * 0.25 + Math.sin(Math.PI * u.k) * 0.6
      u.mat.emissive.set(u.lift ? T.glow ?? '#ffb36b' : '#000000'); u.mat.emissiveIntensity = u.lift * 0.35
      if (!picked || picked.task !== id) u.lift = Math.max(0, u.lift - dt * 0.5)
    }
    drawStrings(dt, t)
    for (const w of Object.values(W)) {
      RUG[w.x.id].material.opacity = held(w.x.id) ? (picked?.task && picked.task === w.x.taskId ? 0.55 : 0.22) : 0.05
      const [sx, sy, vis] = S.project(head(w))
      hud.place(w.x.id, sx, sy, vis)
    }
    hud.frame()
  })
}

// window pane: day sky with clouds, or a night skyline with lit windows
function windowTex(kind, seed) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 140
  const g = c.getContext('2d')
  let r = Math.abs(Math.floor(seed * 977)) + 7
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const grad = g.createLinearGradient(0, 0, 0, 140)
  if (kind === 'night') {
    grad.addColorStop(0, '#0b1230'); grad.addColorStop(1, '#3a2a5e'); g.fillStyle = grad; g.fillRect(0, 0, 512, 140)
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`; g.fillRect(rnd() * 512, rnd() * 60, 2, 2) }
    let x = 0
    while (x < 512) {
      const w = 30 + rnd() * 50, h = 40 + rnd() * 80
      g.fillStyle = '#121833'; g.fillRect(x, 140 - h, w, h)
      for (let yy = 140 - h + 8; yy < 136; yy += 12) for (let xx = x + 5; xx < x + w - 6; xx += 10) if (rnd() > 0.55) { g.fillStyle = rnd() > 0.3 ? '#ffd28a' : '#9fd4ff'; g.fillRect(xx, yy, 5, 6) }
      x += w + 4
    }
  } else {
    grad.addColorStop(0, '#9fd0f0'); grad.addColorStop(1, '#e4f3fb'); g.fillStyle = grad; g.fillRect(0, 0, 512, 140)
    g.fillStyle = '#ffffff'
    for (let i = 0; i < 4; i++) { const cx = rnd() * 512, cy = 25 + rnd() * 50; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + k * 18, cy + Math.sin(k) * 6, 16 + rnd() * 8, 0, 7); g.fill() } }
    g.fillStyle = '#b9dca0'; g.beginPath(); g.moveTo(0, 140); for (let x = 0; x <= 512; x += 32) g.lineTo(x, 112 + Math.sin(x * 0.02 + seed) * 10); g.lineTo(512, 140); g.fill()
  }
  // mullions
  g.fillStyle = kind === 'night' ? '#2a2f45' : '#ffffff'; for (const x of [0, 170, 340, 508]) g.fillRect(x, 0, 6, 140); g.fillRect(0, 0, 512, 5); g.fillRect(0, 135, 512, 5)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}
