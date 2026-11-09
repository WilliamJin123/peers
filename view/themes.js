// Six looks for office.js. Each: palette (c), material maker, lights, post chain, pace, fonts, HUD vars.
import { THREE, clay } from './kit.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js'
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js'
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js'
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js'

// composer: passes, then OutputPass (tone map + sRGB)
function chain(S, passes, onSize) {
  const c = new EffectComposer(S.renderer)
  for (const p of passes) c.addPass(p)
  c.addPass(new OutputPass())
  return { render: () => c.render(), setSize: (w, h) => { c.setSize(w, h); onSize?.(w, h) } }
}
function lights(scene, { sky, ground, hemi, key, color = '#fff1dc', pos = [10, 22, 6], radius = 6, map = 2048 }) {
  scene.add(new THREE.HemisphereLight(sky, ground, hemi))
  const sun = new THREE.DirectionalLight(color, key)
  sun.position.set(...pos); sun.castShadow = true
  sun.shadow.mapSize.set(map, map)
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17 })
  sun.shadow.radius = radius; sun.shadow.bias = -0.0005
  scene.add(sun)
  return sun
}
const hudVars = (bg, fg, dim, line, font, extra = '') => `--hud-bg:${bg};--hud-fg:${fg};--hud-dim:${dim};--hud-line:${line};--hud-alert:#e8622c;--hud-font:${font};${extra}`

const warm = {
  floor: '#e7e0d1', tint: { wren: '#ece4d3', peers: '#e6e6d6', vireo: '#efe1dc', engine: '#e3e1d8' }, label: '#8c8374',
  wall: '#d8cdb8', rug: '#e2d6bf', main: '#cdbfa6', lid: '#b9a98c', sofa: '#b7a98f', pot: '#c9a27e', leaf: '#8fa66e', leaf2: '#7b9560',
  paper: '#fbf8f1', desk: '#cbb89a', leg: '#b3a284', bezel: '#3a3631', lamp: '#e9dfcf', ink: '#2b2722', rim: '#fffdf7',
  bubble: '#fbf9f4', bubbleRing: '#e2dccf', cork: '#c9b08a', frame: '#a89474', head: '#4d463c', sub: '#6f675b', pin: '#8c8374',
  card: { 'In Progress': '#fbf8f1', Blocked: '#fbe4d6', 'To Do': '#f3eee3', Done: '#e3dccd' }, plane: '#fffdf8', trail: '#b9ad99',
}

// 1 · clay: the leader, polished (motion, props, windows off)
export const clayT = {
  title: 'office clay', bg: '#f0eee6', alert: '#e8622c', c: warm,
  css: hudVars('#fbf9f4e6', '#2b2722', '#7a7266', '#e2dccf', 'ui-sans-serif,-apple-system,"Segoe UI",sans-serif'),
  mat: (c, x) => clay(c, x),
  lights: (scene) => lights(scene, { sky: '#fff7ec', ground: '#d6c8af', hemi: 1.25, key: 1.7 }),
  screen: { bg: '#2c2924', fg: '#cfc6b6' }, confetti: ['#f2c14e', '#e8622c', '#fbf8f1', '#7fb2a8'],
}

// 2 · toon: cel bands, ink outlines, saturated pastels on cream
const ramp = (() => { const t = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t })()
export const toon = {
  title: 'office toon', bg: '#fdf4dc', alert: '#ff5a36', gfont: 'family=Fredoka:wght@500;600;700', font: 'Fredoka', windows: 'day',
  c: {
    floor: '#f7e3bd', tint: { wren: '#ffd9a8', peers: '#cfeab0', vireo: '#ffc9d6', engine: '#c9dcff' }, label: '#a0754a',
    wall: '#ffb88a', part: '#ffcf9e', trim: '#fff6e3', rug: '#ffe39a', main: '#7fc8f8', lid: '#3d9ee8', sofa: '#ff8fa3', pot: '#e86f4c', leaf: '#5cc96b', leaf2: '#3fae55',
    paper: '#ffffff', desk: '#f2b46b', leg: '#c98446', bezel: '#2d2a3e', lamp: '#fff3c4', ink: '#2d2a3e', rim: '#ffffff',
    bubble: '#ffffff', bubbleRing: '#2d2a3e', cork: '#e3a868', frame: '#b8743d', head: '#5a3a1e', sub: '#7a5a3e', pin: '#3d9ee8',
    card: { 'In Progress': '#ffffff', Blocked: '#ffd2c4', 'To Do': '#fff3d6', Done: '#d8f0c8' }, plane: '#ffffff', trail: '#ff8fa3',
  },
  css: hudVars('#fffdf4f0', '#2d2a3e', '#8a7a68', '#2d2a3e', '"Fredoka",ui-sans-serif,sans-serif', '--dock-chip:#ffe39a80;'),
  mat: (c, x = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...x }),
  lights: (scene) => lights(scene, { sky: '#ffffff', ground: '#ffe2b8', hemi: 1.1, key: 2.1, radius: 2 }),
  post: (S) => {
    const fx = new OutlineEffect(S.renderer, { defaultThickness: 0.0045, defaultColor: [0.18, 0.16, 0.24], defaultAlpha: 1 })
    return { render: () => fx.render(S.scene, S.camera), setSize: (w, h) => fx.setSize(w, h) }
  },
  screen: { bg: '#2d2a3e', fg: '#e8e2ff' }, confetti: ['#ffd23f', '#ff5a36', '#3d9ee8', '#5cc96b', '#ff8fa3'],
}

// 3 · pixel: low-res render, edge-detected, figures move on 8 fps
export const pixel = {
  title: 'office pixel', bg: '#2b2440', alert: '#ff6b3d', pixel: true, fps: 8, flat: true, windows: 'day',
  gfont: 'family=Silkscreen:wght@400;700', font: 'Silkscreen', mono: 'Silkscreen',
  c: {
    floor: '#c9a37a', tint: { wren: '#d9b98f', peers: '#b8c48a', vireo: '#d9a3a0', engine: '#a9b3c9' }, label: '#5a4632',
    wall: '#8a5f4a', part: '#a3745a', trim: '#6b4a3a', rug: '#a35f5f', main: '#5fa3a3', lid: '#3f7f7f', sofa: '#6b5fa3', pot: '#a35f3f', leaf: '#4fa35f', leaf2: '#3f7f4a',
    paper: '#f4ecd8', desk: '#9a6a42', leg: '#6b4a2e', bezel: '#2b2440', lamp: '#f4ecd8', ink: '#1e1a2e', rim: '#ffffff',
    bubble: '#f4ecd8', bubbleRing: '#1e1a2e', cork: '#b98a55', frame: '#6b4a2e', head: '#2b2440', sub: '#4a3f5a', pin: '#3f7f7f',
    card: { 'In Progress': '#f4ecd8', Blocked: '#ffb08a', 'To Do': '#e0d0b0', Done: '#a9c98a' }, plane: '#f4ecd8', trail: '#f4ecd8',
  },
  css: hudVars('#1e1a2ef0', '#f4ecd8', '#a99cc0', '#4a3f6a', '"Silkscreen",ui-monospace,monospace', '--dock-chip:#ffffff14;'),
  mat: (c, x = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...x }),
  lights: (scene) => lights(scene, { sky: '#ffe9c4', ground: '#6a5a8a', hemi: 1.5, key: 1.6, radius: 1, map: 1024 }),
  post: (S) => chain(S, [new RenderPixelatedPass(4, S.scene, S.camera, { normalEdgeStrength: 0.5, depthEdgeStrength: 0.6 })]),
  screen: { bg: '#1e1a2e', fg: '#9fe0a8' }, confetti: ['#ffd23f', '#ff6b3d', '#5fa3a3', '#f4ecd8'],
}

// 4 · paper: cut card on grain, pencil edges, flat cut-out people, stop-motion at 10 fps
const grain = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d'), d = g.createImageData(256, 256)
  for (let i = 0; i < d.data.length; i += 4) { const v = 225 + Math.random() * 30; d.data[i] = d.data[i + 1] = v; d.data[i + 2] = v - 6; d.data[i + 3] = 255 }
  g.putImageData(d, 0, 0)
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(120,100,70,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 6, 1) }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
  return t
})()
export const paper = {
  title: 'office paper', bg: '#efe8d8', alert: '#d9542b', fps: 10, boil: 0.05, figure: 'cutout', edges: '#4a3f33',
  gfont: 'family=Caveat:wght@500;700&family=Kalam:wght@400;700', font: 'Kalam', hand: 'Caveat',
  c: {
    floor: '#e9dfc9', tint: { wren: '#e8d6b0', peers: '#d6dcc0', vireo: '#ecd0c4', engine: '#cfd6dc' }, label: '#6b5a44',
    wall: '#d9c9a8', rug: '#e0cfa8', main: '#c2b08c', lid: '#a8946c', sofa: '#b8a07a', pot: '#c08a62', leaf: '#8aa070', leaf2: '#76905e',
    paper: '#fffcf3', desk: '#d4bc94', leg: '#b39c76', bezel: '#4a3f33', lamp: '#f4ead4', ink: '#3a3026', rim: '#fffcf3',
    bubble: '#fffcf3', bubbleRing: '#4a3f33', cork: '#c9a978', frame: '#a08a66', head: '#4a3f33', sub: '#6b5a44', pin: '#8c6a4a',
    card: { 'In Progress': '#fffcf3', Blocked: '#f6d6c4', 'To Do': '#f2e8d2', Done: '#dcd6c0' }, plane: '#fffcf3', trail: '#8c7a60',
  },
  css: hudVars('#fffcf3eb', '#3a3026', '#7a6a54', '#cbbd9f', '"Kalam",ui-sans-serif,sans-serif'),
  mat: (c, x = {}) => new THREE.MeshLambertMaterial({ color: c, map: grain, ...x }),
  lights: (scene) => lights(scene, { sky: '#fffaf0', ground: '#e0d4b8', hemi: 2.1, key: 0.95, pos: [6, 22, 12], radius: 10 }),
  screen: { bg: '#3a3026', fg: '#e8dcc4' }, confetti: ['#d9542b', '#e8b84a', '#6a8caf', '#fffcf3'],
}

// 5 · night: late shift. blue dark, desk lamps light their pools, screens and windows glow
export const night = {
  title: 'office night', bg: '#10152a', alert: '#ff6a3d', tone: 1.15, windows: 'night', deskLight: '#ffcf8a', deskLux: 9, glow: '#ffb36b',
  gfont: 'family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400', font: 'Space Grotesk', mono: 'JetBrains Mono',
  c: {
    floor: '#323a5a', tint: { wren: '#394267', peers: '#36445e', vireo: '#433a60', engine: '#383f66' }, label: '#7d88b8',
    wall: '#283050', part: '#38406a', trim: '#3a4266', rug: '#3a3358', main: '#4a5488', lid: '#6a78c0', sofa: '#4a3f70', pot: '#5a4a70', leaf: '#3f7a6a', leaf2: '#35685a',
    paper: '#e8e4f4', desk: '#4a4060', leg: '#2e2a40', bezel: '#14182a', lamp: '#ffe2b0', ink: '#141828', rim: '#e8e4f4',
    bubble: '#e8e4f4', bubbleRing: '#7d88b8', cork: '#5a4a5e', frame: '#3a3050', head: '#e8e4f4', sub: '#4a4462', pin: '#7d88b8',
    card: { 'In Progress': '#f0ecfa', Blocked: '#ffc8b4', 'To Do': '#c8c4dc', Done: '#9a96b4' }, plane: '#f0ecfa', trail: '#9fb4ff',
  },
  css: hudVars('#161b31eb', '#e8e4f4', '#8d94b8', '#2e3558', '"Space Grotesk",ui-sans-serif,sans-serif', '--dock-chip:#ffffff12;'),
  mat: (c, x = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.05, ...x }),
  lights: (scene) => {
    lights(scene, { sky: '#6a7ac8', ground: '#241d40', hemi: 1.0, key: 0.9, color: '#9fb4ff', pos: [-8, 22, 14], radius: 4 })
    // warm wash on the board
    const spot = new THREE.SpotLight('#ffd9a0', 120, 22, 0.6, 0.5, 1.4)
    spot.position.set(-4, 9, -4); spot.target.position.set(-11.6, 3, -11.6); scene.add(spot, spot.target)
  },
  post: (S) => {
    const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.78)
    return chain(S, [new RenderPass(S.scene, S.camera), bloom])
  },
  screen: { bg: '#0e1426', fg: '#a8c4ff', glow: 1.9 }, confetti: ['#ffcf8a', '#9fb4ff', '#ff6a3d', '#c8f0ff'],
}

// 6 · mini: glossy toy office through a long lens, tilt-shift so it reads as a model
export const mini = {
  title: 'office mini', bg: '#dff0f4', alert: '#ff5a2e', fov: 20, tone: 1.05, windows: 'day',
  gfont: 'family=Nunito:wght@600;700;800', font: 'Nunito',
  c: {
    floor: '#f4efe4', tint: { wren: '#ffd166', peers: '#9be29b', vireo: '#ff9fb8', engine: '#8fc7ff' }, label: '#6a5f50',
    wall: '#fafafa', part: '#ffffff', trim: '#e0e0e0', rug: '#ffb347', main: '#2ec4b6', lid: '#1a9e92', sofa: '#ef476f', pot: '#f78c6b', leaf: '#3ecf6e', leaf2: '#22b05a',
    paper: '#ffffff', desk: '#f4f4f4', leg: '#c8c8c8', bezel: '#26262e', lamp: '#fff7d6', ink: '#1e1e26', rim: '#ffffff',
    bubble: '#ffffff', bubbleRing: '#d0d0d8', cork: '#d9a066', frame: '#ffffff', head: '#3a3a44', sub: '#6a6a74', pin: '#ef476f',
    card: { 'In Progress': '#ffffff', Blocked: '#ffd0c0', 'To Do': '#fff4d6', Done: '#d4f4dc' }, plane: '#ffffff', trail: '#2ec4b6',
  },
  css: hudVars('#ffffffeb', '#1e1e26', '#70707c', '#d8dde4', '"Nunito",ui-sans-serif,sans-serif'),
  mat: (c, x = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, ...x }),
  lights: (scene) => lights(scene, { sky: '#ffffff', ground: '#cfe3e8', hemi: 1.0, key: 2.6, pos: [12, 24, 4], radius: 3 }),
  post: (S) => {
    const h = new ShaderPass(HorizontalTiltShiftShader), v = new ShaderPass(VerticalTiltShiftShader)
    const size = (w, H) => { h.uniforms.h.value = 1.5 / w; v.uniforms.v.value = 1.5 / H; h.uniforms.r.value = v.uniforms.r.value = 0.52 }
    size(innerWidth, innerHeight)
    return chain(S, [new RenderPass(S.scene, S.camera), h, v], size)
  },
  screen: { bg: '#1e1e26', fg: '#d8f4ff' }, confetti: ['#ffd166', '#ef476f', '#2ec4b6', '#8fc7ff', '#ffffff'],
}
