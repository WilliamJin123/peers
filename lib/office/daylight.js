// Day and night from the real clock (WA-1226). The sun's height and bearing come from the date, the time and the place:
// latitude from ?lat= (else 40), longitude from the time zone. Height picks the light, the sky, stars, lamps and window tint.
import * as THREE from 'three'

const RAD = Math.PI / 180
// sun height (deg) and compass bearing (deg, 0 = north) at a local time
export function sunAt(d, lat = 40) {
  const y = d.getFullYear(), n = Math.floor((d - new Date(y, 0, 0)) / 864e5)
  const B = (2 * Math.PI * (n - 81)) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B) // min
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset()) // min west, no DST
  const utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  const h = (utc - std / 60 + eot / 60 - 12) * 15 * RAD
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10)) * RAD, f = lat * RAD
  const alt = Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(h))
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(f) - Math.tan(dec) * Math.cos(f)) // from south, west +
  return { alt: alt / RAD, az: (az / RAD + 540) % 360 }
}

// keyframes by sun height; the day sky is the look's own
const K = [
  { a: -14, sky: ['#141836', '#1f2350', '#2e2c63'], hemi: ['#7480d8', '#24203f', 0.75], sun: ['#a9b8ff', 0.5], star: 1, lamp: 1, win: '#39417c', cloud: '#5a5f8e', fly: 1 },
  { a: -5, sky: ['#2d3270', '#9a6fa6', '#ff9f86'], hemi: ['#c3a3dc', '#4a3a5f', 0.85], sun: ['#ff9a7a', 0.65], star: 0.35, lamp: 0.85, win: '#8a78b8', cloud: '#d9b4c8', fly: 0.6 },
  { a: 3, sky: ['#ffc79a', '#ff9fa0', '#b7a6f0'], hemi: ['#ffd9c4', '#c9a8e0', 1.05], sun: ['#ffa66b', 1.4], star: 0, lamp: 0.3, win: '#ffd9c0', cloud: '#ffe0d2', fly: 0 },
  { a: 22, sky: null, hemi: ['#fff4ec', '#d6c0ff', 1.25], sun: ['#ffe0c0', 1.9], star: 0, lamp: 0, win: '#ffffff', cloud: '#ffffff', fly: 0 },
].map((k) => ({ ...k, sky: k.sky?.map((c) => new THREE.Color(c)), hemi: [new THREE.Color(k.hemi[0]), new THREE.Color(k.hemi[1]), k.hemi[2]], sun: [new THREE.Color(k.sun[0]), k.sun[1]], win: new THREE.Color(k.win), cloud: new THREE.Color(k.cloud) }))
// crescent moon, cut on its own canvas so the sky behind stays clean
const MOON = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 40
  const g = c.getContext('2d'); g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(20, 20, 13, 0, 7); g.fill()
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(27, 15, 12, 0, 7); g.fill()
  return c
})()
const smooth = (k) => k * k * (3 - 2 * k)
const minsOf = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60

// looks: its live sky (3 colours); out: materials to tint (windows, clouds, bulbs), set by the scene as it builds
export function createDaylight({ scene, looks, lat = 40, at = null }) {
  const hemi = new THREE.HemisphereLight('#fff4ec', '#d6c0ff', 1.25)
  const sun = new THREE.DirectionalLight('#ffe0c0', 1.9)
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 1; sun.shadow.bias = -0.0005
  scene.add(hemi, sun)
  const fit = (half) => { Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix() }
  fit(20)

  // sky: gradient, stars and a moon on a canvas behind the scene; drawn again only when it changes
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex
  let r = 41; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647
  const STARS = Array.from({ length: 90 }, () => [rnd() * 512, rnd() * 300, 0.6 + rnd() * 1.3, rnd()])
  let skyKey = ''
  function drawSky(cols, star) {
    const key = cols.map((c) => c.getHexString()).join() + star.toFixed(2)
    if (key === skyKey) return
    skyKey = key
    const gr = g.createLinearGradient(0, 0, 0, 512)
    cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), `#${c.getHexString()}`))
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512)
    if (star > 0.01) {
      g.fillStyle = '#ffffff'
      for (const [x, y, s, b] of STARS) { g.globalAlpha = star * (0.35 + b * 0.65) * (1 - y / 360); g.beginPath(); g.arc(x, y, s, 0, 7); g.fill() }
      g.globalAlpha = star; g.drawImage(MOON, 380, 44)
    }
    g.globalAlpha = 1
    tex.needsUpdate = true
  }

  const out = { windows: [], clouds: [], flies: [], bulbs: [] }
  const st = { alt: 30, az: 180, lamp: 0, star: 0, dark: false, mins: minsOf(new Date()) }
  let preview = at // minutes, or null = the clock
  const sky = [new THREE.Color(), new THREE.Color(), new THREE.Color()]
  const S0 = new THREE.Vector3(1, 0, 0.25).normalize(), UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), moon = new THREE.Vector3()
  const lerpC = (o, a, b, k) => o.lerpColors(a, b, k)
  const tmpC = new THREE.Color(), flyDay = new Map()

  function apply() {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(st.mins)
    const { alt, az } = sunAt(d, lat)
    st.alt = alt; st.az = az
    let i = 0; while (i < K.length - 2 && alt > K[i + 1].a) i++
    const A = K[i], B = K[i + 1], k = smooth(Math.min(1, Math.max(0, (alt - A.a) / (B.a - A.a))))
    const skyA = A.sky ?? looks.sky, skyB = B.sky ?? looks.sky
    sky.forEach((c, j) => lerpC(c, skyA[j], skyB[j], k))
    lerpC(hemi.color, A.hemi[0], B.hemi[0], k); lerpC(hemi.groundColor, A.hemi[1], B.hemi[1], k); hemi.intensity = A.hemi[2] + (B.hemi[2] - A.hemi[2]) * k
    lerpC(sun.color, A.sun[0], B.sun[0], k); sun.intensity = A.sun[1] + (B.sun[1] - A.sun[1]) * k
    st.star = A.star + (B.star - A.star) * k; st.lamp = A.lamp + (B.lamp - A.lamp) * k
    const fly = A.fly + (B.fly - A.fly) * k
    lerpC(tmpC, A.win, B.win, k); for (const m of out.windows) m.color.copy(tmpC)
    lerpC(tmpC, A.cloud, B.cloud, k); for (const m of out.clouds) m.color.copy(tmpC)
    for (const m of out.flies) { if (!flyDay.has(m)) flyDay.set(m, m.color.clone()); m.color.lerpColors(flyDay.get(m), FIREFLY, fly) }
    for (const m of out.bulbs) m.color.lerpColors(BULB_OFF, BULB_ON, Math.max(0.15, st.lamp))
    drawSky(sky, st.star)
    // sun from its bearing (south = front right of the screen); below the horizon the moon takes over, high in the back
    const ang = (az - 180) * RAD, el = Math.max(alt, 12) * RAD
    dir.copy(S0).applyAxisAngle(UP, -ang).multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el))
    moon.copy(S0).applyAxisAngle(UP, -ang + Math.PI).multiplyScalar(Math.cos(40 * RAD)).addScaledVector(UP, Math.sin(40 * RAD))
    dir.lerp(moon, smooth(Math.min(1, Math.max(0, (-2 - alt) / 8)))).normalize()
    sun.position.copy(dir).multiplyScalar(30)
    const dark = alt < -2
    if (dark !== st.dark) { st.dark = dark; document.body.classList.toggle('dusk', dark) }
  }

  // clock or preview; the shown time eases to the target, the short way round midnight
  let since = 9
  function frame(dt) {
    const target = preview ?? minsOf(new Date())
    let d = target - st.mins; if (d > 720) d -= 1440; if (d < -720) d += 1440
    const moving = Math.abs(d) > 0.2
    st.mins = moving ? (st.mins + d * (1 - Math.exp(-dt * 4)) + 1440) % 1440 : target
    since += dt
    if (moving || since > 2 || looks.busy) { since = 0; apply() }
  }
  apply()
  return {
    sun, hemi, fit, out, frame, st, apply,
    get preview() { return preview },
    set preview(m) { preview = m == null ? null : ((m % 1440) + 1440) % 1440 },
  }
}
const FIREFLY = new THREE.Color('#fff2a0'), BULB_OFF = new THREE.Color('#d9d2c0'), BULB_ON = new THREE.Color('#fff1b8')
