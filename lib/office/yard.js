// Yard: the land round the office. Grass island, trees, clouds, birds, butterflies (idle life);
// commit garden (a flower per commit, in the committer's colour; a seed flies from the main box to its bed).
import { THREE, geo, shared, arc, easeOutBack, textPlane, reduced } from './kit.js'

const GRASS = '#bfe3a4', DIRT = '#eab98c', BED = '#e6ae84', STONE = '#fff1dc', CLOUD = '#ffffff', TRUNK = '#b8743d'
const PETAL = ['#ffd23f', '#fff6e3']
// seeded random: same trees on every load
const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)

export function createYard({ scene, M, bx, fly, label, onFrame }) {
  const root = new THREE.Group(); scene.add(root)
  let land = null, H = 0, beds = [], slots = [], flowers = [], tag = null, tagN = -1
  const clouds = [], flock = [], flies = []
  let birdIn = 6

  // a flower: stem, five petals round a centre; grown from 0
  const stemG = () => geo('stem', () => new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5).translate(0, 0.25, 0))
  const petalG = () => geo('petal', () => new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.45, 1))
  const eyeG = () => geo('fcentre', () => new THREE.SphereGeometry(0.07, 8, 6))
  function flower(color, i) {
    const f = new THREE.Group()
    const stem = new THREE.Mesh(stemG(), M('#4fb35f')); f.add(stem)
    const head = new THREE.Group(); head.position.y = 0.52; f.add(head)
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(petalG(), M(color)); const a = (k / 5) * Math.PI * 2; p.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1); head.add(p) }
    const c = new THREE.Mesh(eyeG(), M(PETAL[i % 2])); c.position.y = 0.03; head.add(c)
    head.rotation.x = -0.35
    f.userData = { grow: 0, ph: Math.random() * 6, h: 1.5 + ((i * 37) % 10) / 14 }
    f.scale.setScalar(0.0001)
    return f
  }

  function build(nh) {
    if (land) { land.removeFromParent() }
    H = nh; land = new THREE.Group(); root.add(land)
    const R = H + 9
    // island: dirt under grass, a lip of grass over the edge
    const dirt = bx(R * 2, 1.4, R * 2, M(DIRT)); dirt.position.y = -1.32; dirt.castShadow = false; land.add(dirt)
    const grass = bx(R * 2 + 0.3, 0.3, R * 2 + 0.3, M(GRASS)); grass.position.y = -0.62; grass.castShadow = false; land.add(grass)
    // path: stones from the front corner out
    for (let k = 0; k < 6; k++) { const s = bx(0.9, 0.08, 0.7, M(STONE)); const d = H + 1.2 + k * 1.15; s.position.set(d, -0.45, d); s.rotation.y = Math.PI / 4 + (k % 2 ? 0.2 : -0.15); land.add(s) }
    // beds along both front edges, a gap at the path
    beds = [[1, 0], [0, 1]].map(([ax, az]) => {
      const len = H * 2 - 3.2, b = bx(ax ? len : 1.05, 0.16, az ? len : 1.05, M(BED))
      const off = H + 1.35
      b.position.set(ax ? -0.8 : off, -0.42, az ? -0.8 : off); land.add(b)
      return { ax, az, len, off }
    })
    // slots: 2 rows per bed, front row first, from the path inward
    slots = []
    const STEP = 0.62
    for (let k = 0; k * STEP < beds[0].len - 0.6; k++) for (const row of [0.26, -0.26]) for (const bd of beds) {
      const along = H - 2.5 - k * STEP
      slots.push(bd.ax ? [along, bd.off + row] : [bd.off + row, along])
    }
    // trees: outside floor + beds, not on the path
    const r = rng(7)
    for (let i = 0, n = 0; i < 400 && n < 26; i++) {
      const x = (r() * 2 - 1) * (R - 1.2), z = (r() * 2 - 1) * (R - 1.2)
      const inside = Math.max(Math.abs(x), Math.abs(z)) < H + 2.8 && x < H + 2.8 && z < H + 2.8 && x > -H - 1.6 && z > -H - 1.6
      if (inside || Math.abs(x - z) < 2.2 && x > H && z > H) continue
      land.add(tree(r, x, z)); n++
    }
    land.traverse((o) => { if (o.isMesh) o.receiveShadow = true })
    land.updateMatrixWorld(true); land.traverse((o) => (o.matrixAutoUpdate = false))
    // flowers keep their seat
    flowers.forEach((f, i) => place(f, i))
    if (!clouds.length) makeClouds()
  }
  function tree(r, x, z) {
    const t = new THREE.Group(); t.position.set(x, -0.47, z)
    const s = 0.8 + r() * 0.7
    const trunk = new THREE.Mesh(geo('trunk', () => new THREE.CylinderGeometry(0.12, 0.18, 1, 6).translate(0, 0.5, 0)), M(TRUNK)); trunk.castShadow = true; t.add(trunk)
    if (r() < 0.45) {
      // pine: three cones
      for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(geo(`cone${k}`, () => new THREE.ConeGeometry(0.9 - k * 0.22, 1.1, 7)), M(k % 2 ? '#3fae55' : '#4fbf68')); c.position.y = 1.1 + k * 0.6; c.castShadow = true; t.add(c) }
    } else {
      const tones = ['#5cc96b', '#7ad37f', '#3fae55']
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(geo(`blob${k}`, () => new THREE.IcosahedronGeometry(0.7 - k * 0.12, 1)), M(tones[k])); b.position.set(Math.sin(k * 2.3) * 0.32, 1.35 + k * 0.32, Math.cos(k * 2.3) * 0.32); b.castShadow = true; t.add(b) }
    }
    t.scale.setScalar(s); t.rotation.y = r() * 6
    return t
  }
  function makeClouds() {
    const r = rng(19)
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Group()
      for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(geo(`puffc${k}`, () => new THREE.SphereGeometry(1 - k * 0.15, 12, 9)), M(CLOUD)); b.position.set(k * 0.9 - 1.4, k % 2 ? 0.35 : 0, (r() - 0.5) * 0.6); c.add(b) }
      c.scale.set(1.4 + r(), 0.75 + r() * 0.3, 1.2)
      c.userData = { v: 0.25 + r() * 0.35, y: 2 + r() * 2.5, lane: r() }
      clouds.push(c); root.add(c)
    }
    spreadClouds(rng(3))
  }
  // clouds drift on a band behind the back walls and over the left; wrap round
  const SPAN = () => H * 2 + 40
  function spreadClouds(r) { for (const c of clouds) { c.userData.s = r() * SPAN(); setCloud(c) } }
  function setCloud(c) {
    const { s, y, lane } = c.userData, L = SPAN()
    const a = (s % L) - L / 2
    // the band runs along the diagonal (screen left → right); lane = how far back
    c.position.set(a - (H + 1 + lane * 4), y, -a - (H + 1 + lane * 4))
  }

  function place(f, i) {
    const s = slots[i % slots.length]; if (!s) return
    f.position.set(s[0], -0.34, s[1])
  }
  // seed n flowers of a colour at once (load)
  function seed(list) {
    for (const color of list) {
      if (flowers.length >= slots.length) break
      const f = flower(color, flowers.length); f.userData.grow = 1; f.scale.setScalar(f.userData.h)
      place(f, flowers.length); flowers.push(f); root.add(f)
    }
    retag()
  }
  // a commit: seed arcs from the main box to the next slot, then the flower grows
  function plant(color, from) {
    // full garden: the oldest wilts, its slot takes the new one
    let i = flowers.length
    if (i >= slots.length) { i = flowers.length % slots.length; const old = flowers[i]; fly(old, 0.4, (k, o) => o.scale.setScalar(old.userData.h * (1 - k))) }
    const f = flower(color, i); place(f, i)
    if (flowers.length < slots.length) flowers.push(f); else flowers[i] = f
    retag()
    const go = () => { root.add(f); f.userData.grow = 0.0001 }
    if (reduced.matches || !from) { go(); f.userData.grow = 1; f.scale.setScalar(f.userData.h); return }
    const s = new THREE.Mesh(geo('seed', () => new THREE.SphereGeometry(0.12, 10, 8)), M(color))
    const to = f.position.clone().setY(0)
    fly(s, 0.9, (k, o) => { o.position.copy(arc(from, to, k, 3.2)); o.rotation.x = k * 8 }, go)
  }
  function retag() {
    const n = flowers.length
    if (n === tagN) return
    tagN = n
    if (tag) { tag.removeFromParent(); tag.material.map?.dispose(); tag.material.dispose() }
    tag = label(n ? `${n} ${n === 1 ? 'commit' : 'commits'} · a flower each` : 'commit garden: a flower per commit', { size: 52 })
    tag.scale.setScalar(1.1); tag.position.set(H - 5.5, -0.44, H + 2.9)
    root.add(tag)
  }

  const birdM = shared(new THREE.MeshBasicMaterial({ color: '#6e5f7f', side: THREE.DoubleSide }))
  function birds() {
    // a flock of three crosses behind the building
    const grp = new THREE.Group(), wingG = geo('wing', () => new THREE.PlaneGeometry(0.5, 0.16).rotateX(-Math.PI / 2).translate(0.25, 0, 0)), m = birdM
    const bs = [0, 1, 2].map((k) => {
      const b = new THREE.Group(); const l = new THREE.Mesh(wingG, m), rr = new THREE.Mesh(wingG, m); rr.rotation.y = Math.PI
      b.add(l, rr); b.position.set(-k * 0.9, k * 0.2, (k % 2 ? 1 : -1) * k * 0.7); grp.add(b); return { l, rr, ph: k }
    })
    const L = H * 2 + 30, y = 9 + Math.random() * 3, back = H + 4 + Math.random() * 6
    const a0 = new THREE.Vector3(-L / 2 - back, y, L / 2 - back), a1 = new THREE.Vector3(L / 2 - back, y + 1.5, -L / 2 - back)
    grp.position.copy(a0); grp.lookAt(a1)
    fly(grp, 16, (k, o) => {
      o.position.lerpVectors(a0, a1, k)
      for (const b of bs) { const f = Math.sin(performance.now() / 110 + b.ph) * 0.7; b.l.rotation.z = f; b.rr.rotation.z = f }
    })
  }
  function butterflies() {
    const wingG = geo('bwing', () => new THREE.CircleGeometry(0.13, 8).rotateX(-Math.PI / 2).translate(0.12, 0, 0))
    for (const c of ['#ff8fa3', '#ffd23f', '#9b7fe0']) {
      const m = shared(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })), b = new THREE.Group()
      const l = new THREE.Mesh(wingG, m), r = new THREE.Mesh(wingG, m); r.rotation.y = Math.PI; b.add(l, r)
      b.userData = { l, r, ph: Math.random() * 6, at: new THREE.Vector3(), to: new THREE.Vector3(), wait: 0 }
      root.add(b); flies.push(b)
    }
  }
  butterflies()
  function nextSpot(v) {
    // over a flower if any, else over a bed
    const f = flowers.length ? flowers[Math.floor(Math.random() * flowers.length)] : null
    const s = f ? [f.position.x, f.position.z] : slots[Math.floor(Math.random() * slots.length)] ?? [H, H]
    v.set(s[0] + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.9, s[1] + (Math.random() - 0.5) * 0.6)
  }

  onFrame((dt, t) => {
    if (!H) return
    const still = reduced.matches
    for (const f of flowers) {
      const u = f.userData
      if (u.grow < 1 && f.parent) { u.grow = Math.min(1, u.grow + dt * 1.6); f.scale.setScalar(Math.max(0.0001, u.h * easeOutBack(u.grow, 2.6))) }
      if (!still) f.rotation.z = Math.sin(t * 1.3 + u.ph) * 0.08
    }
    if (still) return
    for (const c of clouds) { c.userData.s += c.userData.v * dt; setCloud(c) }
    if ((birdIn -= dt) <= 0) { birdIn = 14 + Math.random() * 14; birds() }
    for (const b of flies) {
      const u = b.userData
      if (u.at.lengthSq() === 0) { nextSpot(u.at); b.position.copy(u.at); nextSpot(u.to) }
      if ((u.wait -= dt) > 0) { const f = 0.5 + Math.sin(t * 3 + u.ph) * 0.4; u.l.rotation.z = f; u.r.rotation.z = f; continue }
      const d = u.to.clone().sub(b.position), L = d.length()
      if (L < 0.05) { u.wait = 0.8 + Math.random() * 2.5; nextSpot(u.to); continue }
      b.position.addScaledVector(d, Math.min(1, (dt * 1.1) / L)); b.position.y += Math.sin(t * 9 + u.ph) * 0.012
      b.rotation.y = Math.atan2(d.x, d.z)
      const f = 0.15 + Math.abs(Math.sin(t * 13 + u.ph)) * 1.2; u.l.rotation.z = f; u.r.rotation.z = f
    }
  })

  return { build, seed, plant, count: () => flowers.length }
}
