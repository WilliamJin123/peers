// Batch 6 (WA-1224): big-tech office looks on the toon flat base (#6). `?look=<name>` picks one; no name = theme.js.
// A look = palette over the base + dress hooks office.js calls: shell (walls, backdrop), plaza, room, desk, part (each partition), tick.
// Generic props only: no real logos, names or brand marks.
import * as THREE from 'three'

const over = (base, o) => ({ ...base, ...o, c: { ...base.c, ...o.c }, dress: o.dress, sheet: o.sheet })
const rnd = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)
const at = (o, x, y, z) => (o.position.set(x, y, z), o)
const cyl = (c, rt, rb, h, m, seg = 20) => { const g = new c.THREE.Mesh(c.geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m); g.castShadow = g.receiveShadow = true; return g }
const ball = (c, r, m, det = 1) => { const g = new THREE.Mesh(c.geo(`ic${r},${det}`, () => new THREE.IcosahedronGeometry(r, det)), m); g.castShadow = true; return g }
const glow = (c, color) => c.basic({ color })

// leaf clumps: a planter's top, a moss wall
function leaves(c, into, n, { x0, x1, y, z, r = 0.22, seed = 1, cols }) {
  const R = rnd(seed)
  for (let k = 0; k < n; k++) into.add(at(ball(c, r * (0.7 + R() * 0.6), c.M(cols[k % cols.length])), x0 + (x1 - x0) * R(), y + R() * 0.25, z + (R() - 0.5) * 0.2))
}
// a long table with stools: café bar, ping-pong, foosball
function table(c, { w, d, h = 1, top, leg }) {
  const t = new THREE.Group()
  t.add(at(c.bx(w, 0.12, d, c.M(top)), 0, h, 0))
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) t.add(at(c.bx(0.12, h, 0.12, c.M(leg)), x * (w / 2 - 0.15), h / 2, z * (d / 2 - 0.15)))
  return t
}
function stool(c, col, h = 0.75) { const s = new THREE.Group(); s.add(at(cyl(c, 0.26, 0.26, 0.1, c.M(col)), 0, h, 0), at(cyl(c, 0.05, 0.05, h, c.M(c.C.leg)), 0, h / 2, 0)); return s }
function beanbag(c, col) { const b = ball(c, 0.55, c.M(col), 2); b.scale.set(1, 0.6, 1); b.position.y = 0.3; return b }
function pendant(c, col, len = 2.2) {
  const p = new THREE.Group()
  p.add(at(c.bx(0.03, len, 0.03, c.M(c.C.ink)), 0, -len / 2, 0))
  const shade = cyl(c, 0.12, 0.42, 0.36, c.M(col), 24); shade.position.y = -len - 0.1; p.add(shade)
  p.add(at(ball(c, 0.12, glow(c, '#fff3c4')), 0, -len - 0.26, 0))
  return p
}
// a vertical sign in a room's back edge; neon = unlit text in a bright colour, plus a soft halo plane
function sign(c, text, color, { y = 1.7, halo } = {}) {
  const s = c.label(text, { color, size: 64 })
  s.rotation.x = 0; s.position.set(0, y, 0); s.material.toneMapped = false
  const g = new THREE.Group(); g.add(s)
  if (halo) {
    const h = new THREE.Mesh(c.geo('halo', () => new THREE.PlaneGeometry(4.6, 1.5)), c.basic({ color: halo, transparent: true, opacity: 0.18, depthWrite: false }))
    h.position.set(0, y, -0.02); g.add(h)
  }
  return g
}
function brickTex() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128
  const g = cv.getContext('2d'), R = rnd(7)
  g.fillStyle = '#e9dccb'; g.fillRect(0, 0, 256, 128)
  for (let r = 0; r < 8; r++) for (let k = -1; k < 9; k++) {
    const x = k * 32 + (r % 2) * 16, l = 52 + R() * 14
    g.fillStyle = `hsl(${10 + R() * 8} ${48 + R() * 10}% ${l - 12}%)`; g.fillRect(x + 1.5, r * 16 + 1.5, 29, 13)
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
// swap one material on every mesh in a group (the shell's walls)
const swapMat = (root, from, to) => root.traverse((o) => { if (o.isMesh && o.material === from) o.material = to })
// back walls sit at -H (x and z); a prop row along both, skipping the clock and board spots
// (clock + board near 0.2 on the x wall, shelves at 6.5 on it and 0.2 on the z wall)
const alongWalls = (H, step, fn) => { for (let p = -H + 2; p < H - 1.5; p += step) { if (Math.abs(p - 0.2) > 2.4 && Math.abs(p - 6.5) > 1.6) fn(p, 0); if (Math.abs(p - 0.2) > 1.6) fn(p, 1) } }
// a point on a back wall: side 0 = the x wall (z = -H), side 1 = the z wall (x = -H)
const onWall = (o, H, side, p, y, off = 0.25) => (side ? o.position.set(-H + off, y, p) : o.position.set(p, y, -H + off), o)

export const LOOKS = {
  // warm campus: timber floor, moss walls, planter partitions, café bar, a big tree in the plaza
  campus: (b) => over(b, {
    bg: '#e4efd8', bgGrad: ['#fbf1d8', '#e4efd8', '#cfe7e2'],
    tints: ['#ead2a8', '#d3e7bf', '#f1d9b8', '#cbe2cf', '#f3e3b0', '#dcd6bf', '#c6e5d6', '#efd1b2'],
    c: { floor: '#d8b47f', wall: '#4f8a55', part: '#c99561', trim: '#f6ecd6', rug: '#d6e7a9', sofa: '#e2874a', main: '#8fd27e', lid: '#3f8f4e', desk: '#e6c592', leg: '#4a4038', pot: '#c96f3f', label: '#6b5a3a' },
    dress: {
      shell(c) {
        // moss panels: leaf clumps over the back walls
        const moss = ['#3f9a4f', '#5cb860', '#2f7d45', '#77c46a'], R = rnd(5)
        alongWalls(c.H, 1.6, (p, side) => { for (let k = 0; k < 6; k++) c.shell.add(onWall(ball(c, 0.2 + R() * 0.14, c.M(moss[k % 4])), c.H, side, p + (R() - 0.5) * 1.6, 0.4 + R() * 1.6)) })
      },
      // planter boxes: leaves along each partition top
      part(c) { const cols = ['#4fae5c', '#74c46a'], n = 6; for (let k = 0; k < n; k++) { const t = -c.len / 2 + 0.35 + k * (c.len - 0.7) / (n - 1), m = ball(c, 0.24, c.M(cols[k % 2])); c.vert ? at(m, 0, 0.55, t) : at(m, t, 0.55, 0); c.w.add(m) } },
      plaza(c) {
        const bar = table(c, { w: 4.2, d: 0.9, h: 1.05, top: '#f6ecd6', leg: '#4a4038' }); at(bar, 0, 0, -4.7); c.scene.add(bar)
        const mach = c.bx(0.5, 0.6, 0.45, c.M('#3b3b3b')); at(mach, -1.4, 1.4, -4.75); c.scene.add(mach)
        for (let k = 0; k < 4; k++) c.scene.add(at(stool(c, '#e2874a'), -1.5 + k, 0, -3.9))
        const tree = new THREE.Group(); tree.add(at(cyl(c, 0.18, 0.28, 2.6, c.M('#8a5a36')), 0, 1.3, 0))
        leaves(c, tree, 7, { x0: -0.9, x1: 0.9, y: 2.5, z: 0, r: 0.75, seed: 12, cols: ['#4fae5c', '#3f9a4f', '#74c46a'] })
        for (const m of tree.children.slice(1)) m.position.z = (m.position.x * 0.7)
        at(tree, 4.6, 0, 4.4); c.scene.add(tree)
      },
    },
  }),
  // glass tower floor: cool white, glass partitions, dual monitors, a skyline outside the walls
  glass: (b) => over(b, {
    bg: '#dbe8f6', bgGrad: ['#f3f7fc', '#dbe8f6', '#b9cff0'],
    tints: ['#eef3f9', '#e7f1fb', '#f1eef9', '#e8f6f3', '#f6f2ea', '#eaeef6', '#e6f4fa', '#f3efe9'],
    c: { floor: '#f4f6f9', wall: '#e3e9f1', part: '#a9d4ff', trim: '#ffffff', rug: '#dfe7f3', sofa: '#4a6cf7', main: '#4a6cf7', lid: '#1b3fd1', desk: '#ffffff', leg: '#8e99a6', pot: '#ffffff', label: '#58708f', leaf: '#2f9e5a', leaf2: '#227a46', bezel: '#1e2433' },
    partX: { transparent: true, opacity: 0.32, depthWrite: false },
    dress: {
      shell(c) {
        const R = rnd(21), sky = new THREE.Group(), cols = ['#c9d9ef', '#b8cbe8', '#d6e2f3', '#a9bfe2']
        for (let k = -c.H - 4; k < c.H + 4; k += 3.4) for (const side of [0, 1]) {
          const h = 2 + R() * 4.5, w = 1.6 + R() * 0.8, t = c.bx(w, h, w, c.M(cols[(Math.round(k) + side) & 3]))
          side ? at(t, -c.H - 3 - R() * 3, h / 2 - 0.5, k) : at(t, k, h / 2 - 0.5, -c.H - 3 - R() * 3)
          sky.add(t)
        }
        c.shell.add(sky)
      },
      desk(c) {
        const m2 = c.mon.clone(); m2.position.x = 0.62; m2.rotation.y = -0.28; c.desk.add(m2)
        c.mon.rotation.y = 0.18; c.lamp.position.set(1.15, 1.2, 0.3)
      },
      plaza(c) {
        for (const [x, z] of [[4.4, -4.4], [-4.4, 4.4]]) {
          const f = new THREE.Group(); f.add(at(cyl(c, 0.42, 0.34, 0.7, c.M('#ffffff')), 0, 0.35, 0), at(cyl(c, 0.05, 0.06, 1.8, c.M('#8a5a36')), 0, 1.4, 0))
          leaves(c, f, 6, { x0: -0.5, x1: 0.5, y: 2.1, z: 0, r: 0.42, seed: 8 + x, cols: ['#2f9e5a', '#227a46'] })
          for (const m of f.children.slice(2)) m.position.z = m.position.x * -0.8
          c.scene.add(at(f, x, 0, z))
        }
      },
    },
  }),
  // evening neon: dark room, a neon name per room, glow strips, an arcade cabinet and bean bags
  neon: (b) => over(b, {
    bg: '#1b1636', bgGrad: ['#2c2154', '#1b1636', '#0f1b3c'],
    sheet: ':root .hud-title{color:#f3ecff}:root .hud-count{color:#c9b8ff}:root .hud-count b{color:#fff}:root .hud-hint{color:#c9b8ffcc}:root .hud-reset{background:#fffdf4f0}', alert: '#ff3d6e', glow: '#ff4fd8',
    tints: ['#3a2f6a', '#2d3d6a', '#462f62', '#2c4a5e', '#3d3466', '#2f3a58', '#3f2f58', '#2f4a66'],
    c: { floor: '#262247', wall: '#352a5c', part: '#43377a', trim: '#5b4aa0', rug: '#3a2c6e', desk: '#4c3f86', leg: '#221c40', sofa: '#ff4fd8', main: '#29e7ff', lid: '#ff4fd8', label: '#c9b8ff', pot: '#5b4aa0', leaf: '#2fe0a0', leaf2: '#1fb07c', lamp: '#ffe6ff', puff: '#c9b8ff' },
    lights(scene, r) {
      scene.add(new THREE.HemisphereLight('#a99cff', '#2a1f4f', 1.05))
      const sun = new THREE.DirectionalLight('#9fb7ff', 1.15)
      sun.position.set(18, 11, -4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun)
      const fit = (half) => { Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix() }
      fit(r); return { sun, fit }
    },
    dress: {
      shell(c) {
        const cols = ['#ff4fd8', '#29e7ff']
        for (const [i, [w, d, x, z]] of [[c.H * 2, 0.08, 0, -c.H + 0.02], [0.08, c.H * 2, -c.H + 0.02, 0]].entries()) c.shell.add(at(new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), glow(c, cols[i])), x, 2.12, z))
      },
      room(c) {
        const cols = ['#ff4fd8', '#29e7ff', '#ffe14f', '#7dff6b', '#ff8a3d', '#b58cff']
        const col = cols[c.i % cols.length], s = sign(c, c.id, col, { y: 1.9, halo: col })
        s.position.z = -c.ROOM / 2 + 0.15; c.grp.add(s)
        c.grp.add(at(new THREE.Mesh(new THREE.BoxGeometry(c.ROOM - 0.4, 0.05, 0.05), glow(c, col)), 0, 0.09, c.ROOM / 2 - 0.05))
      },
      plaza(c) {
        const cab = new THREE.Group(); cab.add(at(c.bx(1, 2, 0.8, c.M('#2b2350')), 0, 1, 0))
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.56), glow(c, '#29e7ff')); scr.position.set(0, 1.4, 0.41); cab.add(scr)
        cab.add(at(c.bx(0.9, 0.12, 0.3, c.M('#ff4fd8')), 0, 0.95, 0.45)); cab.userData.scr = scr
        c.scene.add(at(cab, -1.2, 0, -4.6)); c.scene.add(at(cab.clone(), 0.2, 0, -4.6))
        for (const [x, z, col] of [[3.6, 3.2, '#ff4fd8'], [4.6, 2.2, '#29e7ff'], [2.6, 4.4, '#ffe14f']]) c.scene.add(at(beanbag(c, col), x, 0, z))
        LOOKS.neon.scr = scr
      },
      tick(t) { const s = LOOKS.neon.scr; if (s) s.material.color.setHSL(0.52 + Math.sin(t * 0.7) * 0.08, 1, 0.55) },
    },
  }),
  // warehouse loft: brick walls, concrete floor, steel partitions, bulbs on cords, a ping-pong table
  loft: (b) => over(b, {
    bg: '#e9e1d6', bgGrad: ['#f4ece0', '#e9e1d6', '#d6d2cc'],
    tints: ['#cfc9c1', '#d8d0c4', '#c9c6c2', '#d6cdbf', '#cec4b6', '#d3cfc8', '#c8c2b8', '#dbd2c5'],
    c: { floor: '#bdb6ad', wall: '#c4644a', part: '#5c6168', trim: '#3a3d42', rug: '#a3443a', sofa: '#8a5434', main: '#e0a83a', lid: '#3a3d42', desk: '#b8834f', leg: '#2f3135', pot: '#5c6168', label: '#5a4a3a' },
    dress: {
      shell(c) {
        const t = brickTex(); t.repeat.set(c.H / 1.6, 1.4)
        const brick = c.noInk(c.Mx('#ffffff', { map: t })); brick.userData.shared = true
        swapMat(c.shell, c.M(c.C.wall), brick)
        for (let k = -c.H + 3; k < c.H; k += 6.6) c.shell.add(at(c.bx(0.25, 0.3, c.H * 2, c.M('#3a3d42')), k, 4.6, 0))
      },
      plaza(c) {
        const pp = table(c, { w: 2.8, d: 1.5, h: 0.78, top: '#2e7d5b', leg: '#2f3135' }); pp.add(at(c.bx(0.04, 0.16, 1.6, c.M('#ffffff')), 0, 0.92, 0)); c.scene.add(at(pp, 0, 0, -4.6))
        for (const [x, z] of [[-1.4, -1.8], [0, -2.2], [1.4, -1.8], [-0.7, 2.3], [0.9, 2.0]]) c.scene.add(at(pendant(c, '#3a3d42', 1.8), x * 1.6, 4.4, z * 1.6))
      },
    },
  }),
  // game floor: primary colours, floor dots, foosball, bean bags, a slide-sized rainbow arch
  play: (b) => over(b, {
    bg: '#fff3dc', bgGrad: ['#fff8e6', '#fff3dc', '#dff1ff'],
    tints: ['#ffe27a', '#9fdcff', '#ffb0b0', '#a8f0b0', '#ffd0f0', '#ffd8a0', '#c8c0ff', '#b0f0e8'],
    c: { floor: '#fffaf0', wall: '#4d7cff', part: '#ff6b6b', trim: '#ffd23f', rug: '#ffd23f', sofa: '#36c46b', main: '#ff5ab4', lid: '#c2187a', desk: '#ffffff', leg: '#4d7cff', label: '#3a3a6a' },
    dress: {
      plaza(c) {
        const cols = ['#ff6b6b', '#4d7cff', '#36c46b', '#ffd23f', '#b58cff']
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, d = new THREE.Mesh(c.geo('dot', () => new THREE.CylinderGeometry(0.42, 0.42, 0.02, 24)), c.M(cols[k % 5])); d.receiveShadow = true; c.scene.add(at(d, Math.cos(a) * 4, 0.035, Math.sin(a) * 4)) }
        const fz = table(c, { w: 1.9, d: 1.1, h: 0.85, top: '#2e9e5b', leg: '#3a3a6a' })
        for (let r = 0; r < 4; r++) { fz.add(at(cyl(c, 0.025, 0.025, 1.7, c.M('#cfd6e0')), -0.6 + r * 0.4, 1.02, 0)); fz.children.at(-1).rotation.x = Math.PI / 2 }
        c.scene.add(at(fz, -0.4, 0, -4.6))
        for (const [x, z, col] of [[3.6, 3.4, '#ff6b6b'], [4.6, 2.4, '#4d7cff'], [2.5, 4.5, '#ffd23f'], [-4.4, -3.4, '#36c46b']]) c.scene.add(at(beanbag(c, col), x, 0, z))
        const arch = new THREE.Group()
        cols.forEach((col, i) => { const t = new THREE.Mesh(c.geo(`arch${i}`, () => new THREE.TorusGeometry(1.9 - i * 0.22, 0.11, 10, 40, Math.PI)), c.M(col)); t.castShadow = true; arch.add(t) })
        arch.position.set(4.3, 0, -3.8); arch.rotation.y = Math.PI / 4; c.scene.add(arch)
      },
    },
  }),
  // nordic: white oak, felt partitions, felt phone booths on the walls, pendants over the plaza
  nordic: (b) => over(b, {
    bg: '#edefe8', bgGrad: ['#f7f6f0', '#edefe8', '#dfe6e3'],
    tints: ['#efe4d0', '#e2e8dc', '#ece2d8', '#dde5e4', '#f1e9d6', '#e5e1d6', '#dfe8e0', '#efe3d6'],
    c: { floor: '#ead9bb', wall: '#f2eee6', part: '#9fb5a8', trim: '#ffffff', rug: '#d8cab0', sofa: '#8fb0c4', main: '#e5a57f', lid: '#b56a45', desk: '#e9d2aa', leg: '#f6f3ee', pot: '#d8cfc2', label: '#6e6656' },
    dress: {
      shell(c) {
        const cols = ['#9fb5a8', '#c9a58a', '#8fa7c0']
        let n = 0
        alongWalls(c.H, 7.2, (p, side) => {
          const pod = new THREE.Group(), col = cols[n++ % 3]
          pod.add(at(c.bx(1.6, 2.1, 1.4, c.M(col)), 0, 1.05, 0))
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), c.basic({ color: '#dff2ff', transparent: true, opacity: 0.55 })); glass.position.set(0, 1.05, 0.71); pod.add(glass)
          pod.add(at(c.bx(1.0, 0.3, 0.5, c.M('#f6f3ee')), 0, 0.5, 0.2))
          onWall(pod, c.H, side, p, 0, 0.95); if (side) pod.rotation.y = Math.PI / 2
          c.shell.add(pod)
        })
      },
      plaza(c) { for (const [x, z] of [[-1.2, -1.2], [1.2, 1.2], [1.4, -1.0], [-1.0, 1.4]]) c.scene.add(at(pendant(c, ['#9fb5a8', '#e5a57f'][(x > 0) | 0], 1.6), x * 1.5, 4.2, z * 1.5)) },
    },
  }),
}

export const lookOf = (base, name) => (LOOKS[name] ? LOOKS[name](base) : base)
