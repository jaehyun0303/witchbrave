// 전투 로직 + 스킬 연출 + 컷신. 로직은 2D 좌표(x,y)로 계산하고 3D 월드(x,z)로 매핑한다.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { MAPS, layoutMap } from './maps.js';
import { RAID_BOSS_HP, RAID_TIME } from './hub.js';
import { isTouch, TOUCH, initTouch, showTouch, updateTouch } from './touch.js';
import { VFX, ease, isDark } from './vfx.js';
import { buildCookie, buildDragon, buildMoon, heartMesh } from './models.js';
import { poseBone } from './dragonglb.js';
import { tex, loadManifest } from './tex.js';
import * as ui from './ui.js';

/* ================= 상수 / 유틸 ================= */
let W = 3400, H = 1900; const PAD = 30, S = .04;                // 로직 좌표 → 월드 (1px = 0.04)
const SIL = 0x0c0a12;   // 사일런트솔트 스킬 이펙트 색 (검정 계열)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const adiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, t) => clamp((t - a) / (b - a), 0, 1);
const W3 = (x, y, h = 0) => new THREE.Vector3((x - W / 2) * S, h, (y - H / 2) * S);
const P3 = (o, h = 0) => W3(o.x, o.y, h);

let SAVE = { coins: 0, unlocked: ['silent'], awake: [], wins: {} };
try { const s = JSON.parse(localStorage.getItem('wb3d_save')); if (s && s.unlocked) SAVE = Object.assign(SAVE, s); } catch (e) {}
const persist = () => { try { localStorage.setItem('wb3d_save', JSON.stringify(SAVE)); } catch (e) {} };

let B = null, world, vfx, camera, canvas;
const foe = f => B.fighters.find(o => o !== f);

/* ================= 데미지 / 상태 ================= */
const dmgMul = f => (f.mindBuff ? 1.05 : 1) * (f.form === 'dragon' ? 1.1 : 1) * (f.soul ? .25 : 1);
const defRed = f => f.mindBuff ? .05 : 0;
const spdMul = f => (f.mindBuff ? 1.15 : 1) * (f.form === 'dragon' ? 1.1 : 1);
const toast = (f, t) => { if (f.ctrl.kind !== 'ai') ui.toast(t); };
const shake = (a, t = .3) => { B.shake = Math.max(B.shake, a); B.shakeT = Math.max(B.shakeT, t); };

function hurt(src, t, n, o = {}) {
  if (t.hp <= 0 || t.st.inv > 0) return;
  let d = n * (src ? dmgMul(src) : 1) * (1 - defRed(t));
  if (t.drT > 0) d *= 1 - t.drV;
  let hpD = d; if (t.shield > 0) { const ab = Math.min(t.shield, d); t.shield -= ab; hpD = d - ab; }
  t.hp = Math.max(0, t.hp - hpD); t.flash = .12;
  if (B.raid && t === B.raid.boss && src === B.fighters[0]) B.raid.dmg += d;
  if (src && src !== t && src.def.ult && !src.hidden) src.gauge = Math.min(100, src.gauge + n / (src.def.ult.need / 100));
  const big = d >= 800;
  if (!o.quiet) {
    ui.pop(P3(t, 2.6), Math.round(d), src ? src.def.color : '#fff', big);
    hitFX(t, src ? (src.def.fx ?? src.def.color) : 0xffffff, big, o.dir);
    if (big) { B.hitstop = Math.max(B.hitstop, .07); shake(.35, .25); }
  }
  if (!o.field && t.cast && t.cast.type === 'field') endField(t);
  if (t.hp <= 0) { if (t.ult && t.ult.armed && !t.soul) enterSoul(t); else onDeath(t); }
}
function hitFX(t, color, big, dir) {
  const p = P3(t, 1.3);
  vfx.burst('spark', p, big ? 26 : 10, { speed: big ? 8 : 5, speed2: big ? 14 : 8, life: .35, life2: .6, size: big ? .55 : .35, c0: 0xffffff, c1: color, drag: 3 });
  vfx.flash(p, { size: big ? 4 : 2.2, color, dur: .2, grow: true });
  if (big) vfx.ring(P3(t), { r0: .4, r1: 3.2, dur: .4, color, alpha: .9 });
}
function onDeath(t) {
  const p = P3(t, 1.2);
  vfx.burst('spark', p, 80, { speed: 6, speed2: 18, life: .8, life2: 1.6, size: .6, c0: 0xffffff, c1: t.def.color, grav: 4 });
  vfx.burst('glow', p, 40, { speed: 3, speed2: 9, life: 1.2, life2: 2, size: 1.2, c0: t.def.color, drag: 1 });
  vfx.ring(P3(t), { r0: 1, r1: 10, dur: .9, color: t.def.color }); shake(.9, .6); B.hitstop = .25;
  ui.flash('#fff', .5, .5);
}
const slowOn = (t, s, f = .5) => { t.st.slow = Math.max(t.st.slow, s); t.st.slowF = f; };
const silenceOn = (t, s) => t.st.silence = Math.max(t.st.silence, s);

/* ================= 투사체 ================= */
const waveGeo = new THREE.PlaneGeometry(1, 1);
function projVisual(p) {
  const g = new THREE.Group(), col = new THREE.Color(p.color);
  const nb = isDark(p.color) ? THREE.NormalBlending : THREE.AdditiveBlending;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: p.color, transparent: true, depthWrite: false, blending: nb }));
  glow.scale.setScalar(p.r * S * 9); g.add(glow);
  if (p.kind === 'wave') {   // 침묵의 검기: 직립 초승달
    const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ map: tex('slash'), color: isDark(p.color) ? p.color : 0xdfe8ff, transparent: true, depthWrite: false, blending: nb, side: THREE.DoubleSide }));
    m.scale.set(p.r * S * 11, p.r * S * 8, 1); m.position.y = .2; g.add(m); g.userData.mesh = m;
    const m2 = m.clone(); m2.material = m.material.clone(); m2.material.color.set(p.color); m2.scale.multiplyScalar(1.25); g.add(m2);
  } else if (p.kind === 'heart') {
    const h = heartMesh(new THREE.MeshStandardMaterial({ color: 0xff6adf, emissive: 0xff2ac0, emissiveIntensity: 1.6, roughness: .3 }), .85); g.add(h); g.userData.mesh = h;
  } else if (p.kind === 'orb') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(p.r * S * 1.3, 16, 12), new THREE.MeshBasicMaterial({ color: p.color })); g.add(m); g.userData.mesh = m;
    const m2 = new THREE.Mesh(new THREE.SphereGeometry(p.r * S * .7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd0d0 })); g.add(m2); glow.scale.setScalar(p.r * S * 12);
  } else if (p.kind === 'beam') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.scale.set(p.r * S * 1.6, p.r * S * 1.6, 9); g.add(m); glow.scale.setScalar(p.r * S * 14);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    c.scale.set(p.r * S * .7, p.r * S * .7, 9); g.add(c);
  }
  g.position.copy(W3(p.x, p.y, 1.2)); g.rotation.y = Math.atan2(p.vx, p.vy); world.scene.add(g);
  return g;
}
function shoot(f, o) {
  const p = Object.assign({ x: f.x, y: f.y, r: 8, life: 1.6, owner: f, hit: new Set(), color: 0xffffff }, o, { vx: Math.cos(o.a) * o.sp, vy: Math.sin(o.a) * o.sp });
  p.vis = projVisual(p); B.projs.push(p);
  vfx.burst('spark', P3(f, 1.2).add(new THREE.Vector3(Math.cos(o.a), 0, Math.sin(o.a)).multiplyScalar(1)), 8, { speed: 3, life: .25, size: .3, c0: p.color });
}
function killProj(p) { p.life = 0; if (p.vis) { world.scene.remove(p.vis); p.vis.traverse(o => { if (o.material) o.material.dispose(); }); p.vis = null; } }
function updProjs(dt) {
  for (const p of B.projs) {
    if (p.homing) { const t = foe(p.owner); if (t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < p.homing) { const want = Math.atan2(t.y - p.y, t.x - p.x), cur = Math.atan2(p.vy, p.vx), d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), na = cur + clamp(d, -p.turn * dt, p.turn * dt), sp = Math.hypot(p.vx, p.vy); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; } }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.life = 0;
    const wp = W3(p.x, p.y, 1.2);
    if (p.vis) {
      p.vis.position.copy(wp);
      if (p.kind === 'heart') { p.vis.userData.mesh.rotation.y += dt * 8; p.vis.userData.mesh.rotation.z = Math.sin(B.time * 14) * .3; }
      if (p.kind === 'wave') p.vis.userData.mesh.material.opacity = .9 + Math.sin(B.time * 30) * .1;
    }
    // 궤적 파티클
    const tr = p.kind === 'wave' ? 3 : p.kind === 'beam' ? 4 : 2;
    for (let i = 0; i < tr; i++) {
      const sp = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(p.kind === 'wave' ? 1.6 : .6);
      vfx.emit(p.kind === 'heart' ? 'heart' : p.kind === 'fire' ? 'smoke' : 'glow', { x: wp.x + sp.x * .3, y: wp.y + sp.y * .4, z: wp.z + sp.z * .3, vx: sp.x - p.vx * S * .08, vy: sp.y * .6, vz: sp.z - p.vy * S * .08, life: p.kind === 'fire' ? .7 : .45, s0: p.kind === 'heart' ? .3 : p.kind === 'fire' ? .9 : .6, s1: 0, c0: p.kind === 'fire' ? 0xffa050 : p.color, c1: p.kind === 'fire' ? 0x3a1060 : 0x6a58ff, a: p.kind === 'fire' ? .6 : .9, drag: 2 });
    }
    for (const t of B.fighters) {
      if (t === p.owner || p.hit.has(t) || t.hp <= 0) continue;
      if (Math.hypot(p.x - t.x, p.y - t.y) < p.r + t.r) {
        p.hit.add(t); hurt(p.owner, t, p.dmg, { dir: Math.atan2(p.vy, p.vx) }); p.onHit && p.onHit(t);
        if (!p.pierce) killProj(p);
      }
    }
    if (!p.pierce && p.life > 0) for (const o of B.objs) if (Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r) {
      vfx.burst('spark', wp, 14, { speed: 5, life: .4, size: .4, c0: p.color }); vfx.flash(wp, { color: p.color, size: 2.5, dur: .2 }); killProj(p);
    }
  }
  B.projs = B.projs.filter(p => { if (p.life <= 0) { killProj(p); return false; } return true; });
}

/* ================= 장판(지정 위치 폭발) ================= */
function zone(f, o) {
  const z = Object.assign({ t: 0, delay: 0, done: false, owner: f }, o);
  const c = P3(z);
  z.tele = vfx.decal(c, { tex: 'rune', r: z.r * S, color: z.color, alpha: .9, spin: 1.5 });
  z.tele2 = vfx.decal(c, { tex: 'ring', r: z.r * S * 1.05, color: z.color, alpha: .8, y: .07 });
  if (z.fancy) z.tele3 = vfx.decal(c, { tex: 'rune', r: z.r * S * .62, color: 0xff8080, alpha: .85, spin: -3, y: .06 });
  if (z.rock) { z.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.9, 0), new THREE.MeshStandardMaterial({ color: 0xff9ad8, emissive: 0xff4fb0, emissiveIntensity: .9, flatShading: true })); z.mesh.scale.set(1, 1.4, 1); z.mesh.position.set(c.x, 22, c.z); world.scene.add(z.mesh); }
  B.zones.push(z);
}
function erupt(pos, r, color, h = 16) {                      // 기둥 폭발 이펙트
  const c = pos.clone(), WH = isDark(color) ? 0x050408 : 0xffffff;
  vfx.column(c, { r: r * 1.0, h, dur: .9, color });
  vfx.column(c, { r: r * .55, h: h * 1.2, dur: .7, color: WH });
  vfx.ring(c, { r0: .5, r1: r * 1.7, dur: .55, color, alpha: 1 });
  vfx.ring(c, { r0: .3, r1: r * 2.4, dur: .8, color: WH, alpha: .6 });
  vfx.decal(c, { tex: 'crack', r: r * 1.3, color, dur: 1.4, alpha: .9, y: .04 });
  vfx.flash(c.clone().setY(1), { size: r * 4, color, dur: .35, grow: true });
  for (let i = 0; i < 70; i++) { // 나선 상승 입자
    const a = rnd(0, 6.283), d = rnd(0, r);
    vfx.emit('glow', { x: c.x + Math.cos(a) * d, y: .2, z: c.z + Math.sin(a) * d, vx: -Math.sin(a) * rnd(2, 5), vy: rnd(8, 22), vz: Math.cos(a) * rnd(2, 5), life: rnd(.5, 1.1), s0: rnd(.4, .9), s1: 0, c0: WH, c1: color, drag: .6 });
  }
  vfx.burst('spark', c.clone().setY(.4), 40, { speed: 6, speed2: 16, life: .6, life2: 1.2, size: .45, c0: WH, c1: color, grav: 8, flat: false });
  shake(.55, .35);
}
function updZones(dt) {
  for (const z of B.zones) {
    z.t += dt;
    const u = Math.min(1, z.t / z.delay);
    if (z.mesh) { z.mesh.position.y = lerp(22, .6, u * u); z.mesh.rotation.y += dt * 6; }
    if (!z.done) { // 예고선: 점점 선명해지고 안쪽에서 입자 모임
      z.tele.obj.material.opacity = .25 + u * .7; z.tele2.obj.scale.setScalar(z.r * S * 2.1 * (1.15 - u * .15));
      if (z.fancy) { const c = P3(z); for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * z.r * S; vfx.emit('glow', { x: c.x + Math.cos(a) * d, y: .3, z: c.z + Math.sin(a) * d, vy: rnd(2, 7), life: rnd(.6, 1), s0: rnd(.5, 1), s1: .15, c0: 0xff5060, c1: 0x800010, a: .95, drag: 0 }); } }
      if (Math.random() < .8) { const a = rnd(0, 6.283), c = P3(z); vfx.emit('glow', { x: c.x + Math.cos(a) * z.r * S, y: .1, z: c.z + Math.sin(a) * z.r * S, vx: -Math.cos(a) * 3, vy: rnd(1, 4), vz: -Math.sin(a) * 3, life: .35, s0: .45, s1: 0, c0: z.color, drag: 0 }); }
    }
    if (!z.done && z.t >= z.delay) {
      z.done = true; vfx.remove(z.tele); vfx.remove(z.tele2); if (z.tele3) vfx.remove(z.tele3);
      if (z.mesh) { world.scene.remove(z.mesh); z.mesh = null; const c = P3(z); vfx.ring(c, { r0: .3, r1: z.r * S * 1.8, dur: .4, color: z.color }); vfx.burst('spark', c.clone().setY(.4), 22, { speed: 5, speed2: 11, life: .5, size: .4, c0: 0xffffff, c1: z.color, grav: 8 }); vfx.flash(c.clone().setY(.8), { size: 3.2, color: z.color, dur: .25, grow: true }); shake(.2, .15); }
      else erupt(P3(z), z.r * S, z.color);
      if (z.fancy) { const c = P3(z); erupt(c, z.r * S * 1.4, z.color, 22); erupt(c, z.r * S * .8, 0xffffff, 28); for (let i = 0; i < 3; i++) vfx.ring(c, { r0: .5, r1: z.r * S * (2 + i), dur: .6 + i * .2, color: i ? 0xff8080 : 0xff2438 }); vfx.burst('spark', c.clone().setY(1), 120, { speed: 8, speed2: 26, life: .9, life2: 1.8, size: .8, c0: 0xffffff, c1: 0xff2030, grav: 5 }); ui.flash('#ff2030', .5, .4); shake(.9, .5); }
      for (const t of B.fighters) if (t !== z.owner && Math.hypot(t.x - z.x, t.y - z.y) < z.r + t.r) { hurt(z.owner, t, z.dmg); z.onHit && z.onHit(t); }
    }
  }
  B.zones = B.zones.filter(z => z.t < z.delay + .3);
}

/* ================= 침묵의 심판 (필드) ================= */
function startField(f) {
  const c = f.cast = { type: 'field', x: f.x, y: f.y, r: 230, t: 0, acc: 0 };
  const p = P3(f), R = c.r * S, col = SIL;
  c.dome = vfx.dome(p, R, col);
  c.rune = vfx.decal(p, { tex: 'rune', r: R * 1.02, color: col, alpha: .85, spin: .25 });
  c.rune2 = vfx.decal(p, { tex: 'rune', r: R * .62, color: SIL, alpha: .7, spin: -.5, y: .06 });
  c.ring = vfx.decal(p, { tex: 'ring', r: R * 1.0, color: SIL, alpha: .95, y: .07 });
  c.col = vfx.column(p, { r: 1.1, h: 40, dur: 0, color: col }); c.col.dur = 0; c.col.fn = (u, ob, dt) => { ob.rotation.y += dt * 2; ob.scale.set(1.1 + Math.sin(B.time * 4) * .1, 40, 1.1); ob.material.opacity = .6; };
  vfx.ring(p, { r0: 1, r1: R * 1.5, dur: .8, color: col }); vfx.ring(p, { r0: 1, r1: R * 1.1, dur: 1.1, color: SIL, alpha: .8 });
  vfx.burst('glow', P3(f, .5), 60, { speed: 4, speed2: 14, life: .8, life2: 1.6, size: 1, c0: 0xffffff, c1: col, flat: true, drag: 1.2 });
  shake(.7, .5); B.hitstop = .1; ui.flash('#07050b', .5, .45); ui.vignette(true);
  f.pose = 'stab';
}
function endField(f) {
  if (!f.cast || f.cast.type !== 'field') return;
  const c = f.cast, s = f.def.skills[f.form].v; f.cast = null; f.cd.v = s.cd; f.pose = null;
  c.dome.closing = true; ['rune', 'rune2', 'ring', 'col'].forEach(k => vfx.remove(c[k]));
  const p = P3(c); vfx.ring(p, { r0: c.r * S, r1: c.r * S * 1.3, dur: .6, color: SIL }); vfx.burst('glow', p.clone().setY(1), 50, { speed: 3, speed2: 12, life: 1, size: .9, c0: SIL, flat: true });
  ui.vignette(false);
}
function updField(f, dt) {
  const c = f.cast; c.t += dt; c.acc += dt;
  const R = c.r * S, p = P3(c);
  // 침묵의 눈송이 (천천히 하강)
  for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R; vfx.emit('glow', { x: p.x + Math.cos(a) * d, y: rnd(8, 14), z: p.z + Math.sin(a) * d, vx: 0, vy: -rnd(2, 4), vz: 0, life: 3.2, s0: rnd(.15, .35), s1: .1, c0: 0x16121f, c1: 0x8fa4ff, a: .8, drag: 0 }); }
  if (Math.random() < .5) { const a = rnd(0, 6.283); vfx.emit('spark', { x: p.x + Math.cos(a) * R, y: .2, z: p.z + Math.sin(a) * R, vy: rnd(3, 8), life: 1, s0: .6, s1: 0, c0: SIL, drag: 0 }); }
  for (const o of B.fighters) {
    if (o === f || o.hp <= 0) continue;
    if (Math.hypot(o.x - c.x, o.y - c.y) < c.r + o.r) {           // 영역 안: 이동·스킬 불가, 초당 500
      o.st.lock = .15; hurt(f, o, 500 * dt, { field: true, quiet: true });
      o.fieldAcc = (o.fieldAcc || 0) + 500 * dt * dmgMul(f);
      if (o.fieldAcc >= 500) { o.fieldAcc -= 500; ui.pop(P3(o, 2.6), '500', '#cfd8ff'); hitFX(o, SIL, false); }
      if (Math.random() < .5) vfx.emit('spark', { x: o.root.position.x + rnd(-.6, .6), y: 1 + rnd(0, 1.6), z: o.root.position.z + rnd(-.6, .6), vy: 2, life: .5, s0: .4, s1: 0, c0: SIL });
    }
  }
}

/* ================= 정신세계 ================= */
function startMind(f) {
  const e = foe(f);
  B.mind = { t: 15, f, ret: B.fighters.map(o => ({ x: o.x, y: o.y })), objs: B.objs };
  const p = P3(f);
  for (let i = 0; i < 3; i++) vfx.ring(p, { r0: .5, r1: 8 + i * 5, dur: .6 + i * .2, color: 0xff6ad8 });
  vfx.burst('heart', P3(f, 1.5), 40, { speed: 5, speed2: 12, life: 1, size: .7, c0: 0xff7ae0, c1: 0xff2ac0 });
  ui.flash('#ff7ad9', .9, .55);
  B.objs = []; B.projs.forEach(killProj); B.projs = []; B.zones.forEach(z => { vfx.remove(z.tele); vfx.remove(z.tele2); }); B.zones = [];
  f.x = W / 2 - 250; f.y = H / 2; e.x = W / 2 + 250; e.y = H / 2; f.mindBuff = true; world.setMind(true); shake(.8, .6);
  [f, e].forEach(o => vfx.burst('heart', P3(o, 1.3), 24, { speed: 4, speed2: 9, life: 1.2, size: .6, c0: 0xff9ae6, c1: 0xff2ac0 }));
  toast(f, '정신세계 진입!');
}
function endMind() {
  const m = B.mind; if (!m) return;
  B.fighters.forEach((o, i) => { o.x = m.ret[i].x; o.y = m.ret[i].y; });
  B.objs = m.objs; m.f.mindBuff = false; B.mind = null; B.projs.forEach(killProj); B.projs = [];
  world.setMind(false); ui.flash('#ff7ad9', .8, .9); shake(.4, .3);
}

/* ================= 근접/연출 도우미 ================= */
function swing(f, range, arc, dmg, color) {
  const a = f.face, p = P3(f, .9);
  vfx.slashGround(p, Math.PI / 2 - a, { len: range * S * 1.15, color, from: f.swingDir = -(f.swingDir || 1), dur: .28 });
  vfx.burst('spark', p.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(range * S * .8)), 6, { speed: 4, life: .3, size: .3, c0: color });
  for (const t of B.fighters) if (t !== f && dist(f, t) < range + t.r && adiff(ang(f, t), a) < arc) hurt(f, t, dmg, { dir: a });
}
function clampRange(f, p, max) { const d = dist(f, p); if (d <= max) return { x: p.x, y: p.y }; const a = ang(f, p); return { x: f.x + Math.cos(a) * max, y: f.y + Math.sin(a) * max }; }
function runScript(f, steps, end, onEnd) { f.script = { t: 0, steps: steps.map(s => ({ ...s, d: false })), end, onEnd }; }
function setAnim(f, name, dur = .3) { f.anim = { n: name, t: 0, d: dur }; }
function shock(f, r, color, dmg, after) {
  const p = P3(f);
  vfx.ring(p, { r0: .5, r1: r * S, dur: .5, color }); vfx.ring(p, { r0: .3, r1: r * S * .7, dur: .7, color: 0xffffff, alpha: .6 });
  vfx.burst('spark', P3(f, 1), 40, { speed: 8, speed2: 20, life: .6, size: .5, c0: 0xffffff, c1: color, flat: true });
  for (const t of B.fighters) if (t !== f && dist(f, t) < r + t.r) { hurt(f, t, dmg); after && after(t); }
}

/* ================= 컷신: 적막의 종언 ================= */
const APEX = new THREE.Vector3(-3, 26, -32);
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 };
// 자유 시점: 우클릭 드래그=회전, 휠=줌, Q/E=회전, T=내 캐릭터 추적 ↔ 둘 다 보기
const cam = { yaw: 0, pitch: .95, dist: 15, fit: false };
function gameCamPose() {
  const [a, b] = B.fighters, sep = dist(a, b) * S;
  const tgt = cam.fit ? W3((a.x + b.x) / 2, (a.y + b.y) / 2, 1) : P3(a, 1);
  const big = a.form === 'dragon' || b.form === 'dragon' ? 1.15 : 1;
  const d = cam.dist * big + (cam.fit ? sep * .45 : 0), cp = Math.cos(cam.pitch);
  return { pos: tgt.clone().add(new THREE.Vector3(Math.sin(cam.yaw) * cp * d, Math.sin(cam.pitch) * d, Math.cos(cam.yaw) * cp * d)), look: tgt, fov: 42 };
}
const camRel = (mx, my) => ({ x: Math.cos(cam.yaw) * mx + Math.sin(cam.yaw) * my, y: -Math.sin(cam.yaw) * mx + Math.cos(cam.yaw) * my });
function startCut(f, name, onHit) {
  const e = foe(f), moon = buildMoon(18);
  moon.group.position.set(0, 36, -72); world.scene.add(moon.group);
  B.cut = { t: 0, dur: 8.2, f, e, name, onHit, moon, home: { x: f.x, y: f.y }, fl: {}, rune: null };
  B.projs.forEach(killProj); B.projs = [];
  world.setCut(true); ui.cinema(true); world.bloom.strength = .8; world.bloom.threshold = .95;
  f.pose = 'raise'; camera.near = .1;
}
function updateCut(dt) {
  const c = B.cut, f = c.f, e = c.e, t = c.t += dt, fl = c.fl;
  const base = W3(c.home.x, c.home.y, 0), M = c.moon.group.position;
  const sword = () => f.root.localToWorld(new THREE.Vector3(0, 0, 0)).setY(f.root.position.y + 2.6);
  let pos, look, fov;
  // ① 0~1.8: 달빛을 모으는 클로즈업
  if (t < 1.8) {
    const u = t / 1.8;
    if (!c.rune) c.rune = vfx.decal(base, { tex: 'rune', r: 5, color: 0x6a86ff, alpha: .55, spin: .8 });
    for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = rnd(3, 7), h = rnd(0, 8); const tp = base.clone().setY(2.8); vfx.emit('glow', { x: base.x + Math.cos(a) * d, y: h, z: base.z + Math.sin(a) * d, vx: (tp.x - base.x - Math.cos(a) * d) * 2.2, vy: (tp.y - h) * 2.2, vz: (tp.z - base.z - Math.sin(a) * d) * 2.2, life: .45, s0: .32, s1: .05, a: .5, c0: 0xcfdcff, c1: 0x5d7bff, drag: 0 }); }
    f.root.position.y = Math.sin(u * 3) * .25 * u;
    pos = new THREE.Vector3(lerp(3.4, 1.4, ease.io(u)) + base.x, lerp(1.4, 2.0, u), base.z + lerp(8.5, 6.2, ease.io(u)));
    look = base.clone().add(new THREE.Vector3(0, lerp(1.6, 2.4, u), 0)); fov = lerp(40, 34, u);
    f.cutGlow = u;
    if (!fl.a) { fl.a = 1; ui.title('', ''); }
  }
  // ② 1.8~3.4: 달을 향해 도약
  else if (t < 3.4) {
    const u = (t - 1.8) / 1.6, e1 = ease.io(u);
    if (!fl.b) { fl.b = 1; vfx.remove(c.rune); vfx.ring(base, { r0: .5, r1: 14, dur: .6, color: 0xaec4ff }); vfx.burst('glow', base.clone().setY(.5), 80, { speed: 6, speed2: 16, life: 1, size: 1, c0: 0xffffff, c1: 0x7d9bff, flat: true }); shake(.5, .3); f.pose = 'leap'; }
    const target = APEX;
    const np = base.clone().lerp(target, e1); np.y += Math.sin(u * Math.PI) * 5 + 2.4 * u;
    const prev = f.root.position.clone(); f.root.position.copy(np);
    vfx.line('glow', prev, np, 8, { size: 1.2, size1: .2, c0: 0xffffff, c1: 0x7d9bff, life: .6, rad: .3 });
    const camA = new THREE.Vector3(base.x + .5, 1.8, base.z + 3.2), camB = new THREE.Vector3(2, 6, 34);
    pos = camA.clone().lerp(camB, ease.io(sstep(0, .75, u))); look = np.clone().lerp(M, sstep(.3, 1, u)); fov = lerp(30, 46, ease.io(u));
  }
  // ③ 3.4~4.4: 정적 → 베기
  else if (t < 4.4) {
    const u = (t - 3.4) / 1.0;
    f.root.position.copy(APEX);
    f.pose = 'slashhi';
    pos = new THREE.Vector3(lerp(2, 0, u), lerp(6, 11, u), lerp(34, 29, u)); look = M.clone().add(new THREE.Vector3(-1, -2, 0)); fov = 46;
    if (!fl.c) { fl.c = 1; ui.vignette(true); }
    // 0.55~0.85: 베기 선이 달을 가른다
    const L = c.moon.line; const lu = sstep(.55, .85, u);
    L.material.opacity = lu > 0 ? 1 : 0; L.scale.set(.25 + (1 - lu) * 1.2, c.moon.R * 2.6 * ease.out(lu) + .01, 1); L.position.y = (1 - lu) * c.moon.R * 1.3 - 0;
    if (u > .85 && !fl.d) { // 일섬
      fl.d = 1; ui.flash('#ffffff', .6, 1); shake(1, .8); B.hitstop = .12;
      vfx.burst('spark', M.clone().add(new THREE.Vector3(0, 0, 18)), 120, { speed: 10, speed2: 40, life: .8, life2: 1.6, size: 1.4, c0: 0xffffff, c1: 0x9fb8ff, drag: 1 });
    }
  }
  // ④ 4.4~6.3: 달이 갈라진다
  else if (t < 6.3) {
    const u = (t - 4.4) / 1.9, sp = ease.out(Math.min(1, u * 1.4));
    c.moon.halves[0].position.x = -sp * 11; c.moon.halves[1].position.x = sp * 11;
    c.moon.halves[0].rotation.z = sp * .12; c.moon.halves[1].rotation.z = -sp * .12;
    c.moon.line.material.opacity = Math.max(0, 1 - u * 4);
    c.moon.glow.material.opacity = .55 + sp * .5; c.moon.glow.scale.setScalar(c.moon.R * (5 + sp * 5));
    f.root.position.y -= dt * 2; f.pose = 'leap';
    // 갈라진 틈에서 새어 나오는 빛과 달 파편
    for (let i = 0; i < 10; i++) {
      const lp = new THREE.Vector3(0, rnd(-c.moon.R, c.moon.R), rnd(-2, 8)).applyEuler(c.moon.tilt.rotation).add(M);
      vfx.emit('glow', { x: lp.x, y: lp.y, z: lp.z, vx: rnd(-14, 14), vy: rnd(-14, 14), vz: rnd(5, 22), life: rnd(.7, 1.6), s0: rnd(1, 2.4), s1: 0, c0: 0xfff0b0, c1: 0x7d9bff, drag: .8 });
    }
    if (!fl.e) { fl.e = 1; ui.title(c.name, 'SILENT SALT COOKIE'); }
    pos = new THREE.Vector3(lerp(0, 3, u), lerp(11, 9, u), lerp(29, 22, ease.out(u))); look = M.clone().add(new THREE.Vector3(0, -3, 0)); fov = lerp(46, 52, u);
    B.shake = Math.max(B.shake, .15); B.shakeT = .2;
  }
  // ⑤ 6.3~7.5: 아레나로 낙뢰(월광 참격)
  else if (t < 7.5) {
    const u = (t - 6.3) / 1.2;
    if (!fl.f) {
      fl.f = 1; f.root.position.copy(base); f.pose = 'stab2'; ui.title('', '');
      c.moon.group.visible = true;
      vfx.column(new THREE.Vector3(0, 0, 0), { r: 4, h: 70, dur: 1.6, color: 0x8fa8ff, alpha: .55 });
      vfx.column(new THREE.Vector3(0, 0, 0), { r: 2, h: 80, dur: 1.4, color: 0xffffff, alpha: .5 });
    }
    if (u > .22 && !fl.g) {
      fl.g = 1; c.onHit(); shake(1.2, .9); B.hitstop = .2; ui.flash('#e6efff', .9, .55);
      for (let i = 0; i < 4; i++) vfx.ring(new THREE.Vector3(0, 0, 0), { r0: 1, r1: 20 + i * 12, dur: .7 + i * .25, color: i % 2 ? 0xffffff : 0x9fb8ff, alpha: .6 });
      vfx.burst('spark', new THREE.Vector3(0, .5, 0), 200, { speed: 8, speed2: 40, life: .8, life2: 2, size: .9, c0: 0xffffff, c1: 0x7d9bff, grav: 6 });
      vfx.burst('glow', new THREE.Vector3(0, 1, 0), 80, { speed: 4, speed2: 18, life: 1.5, life2: 2.5, size: 2, c0: 0xcfdcff, c1: 0x3a46aa, flat: true });
      setAnim(e, 'hit', .7);
    }
    pos = new THREE.Vector3(lerp(-6, 4, u), lerp(10, 7, u), lerp(24, 20, u)); look = new THREE.Vector3(0, 2, 0); fov = lerp(55, 46, u);
    for (const h of c.moon.halves) h.position.x *= 1 + dt * .2;
  }
  // ⑥ 7.5~8.2: 전투 카메라로 복귀
  else {
    const u = (t - 7.5) / .7, g = gameCamPose();
    if (!fl.h) { fl.h = 1; c.moon.group.visible = false; world.setCut(false); ui.cinema(false); ui.vignette(false); f.pose = null; world.bloom.strength = .6; world.bloom.threshold = .9; }
    pos = camState.pos.clone().lerp(g.pos, ease.io(u)); look = camState.look.clone().lerp(g.look, ease.io(u)); fov = lerp(camState.fov, g.fov, ease.io(u));
    if (t >= c.dur) { B.cut = null; world.scene.remove(c.moon.group); f.pose = null; camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov; return; }
  }
  f.cutGlow = f.cutGlow || 0; if (t >= 1.8) f.cutGlow = 1;
  camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov;
}

/* ================= 캐릭터 정의 ================= */
const CHARS = {};
CHARS.silent = {
  id: 'silent', name: '사일런트솔트 쿠키', color: 0xcfd8ff, fx: SIL, cost: 0, hp: 30000, pref: 3.6, atkRange: 100, tag: '침묵 · 근접 검사',
  skills: {
    base: {
      a: { name: '검 베기', cd: .85, desc: '검으로 벤다. 데미지 100', use(f) { setAnim(f, 'slash', .26); swing(f, 95, .9, 100, SIL); } },
      z: { name: '침묵의 기운', cd: 5, desc: '지정한 곳에서 침묵의 기운이 솟구침. 데미지 1000 + 슬로우', use(f, p) { setAnim(f, 'cast', .5); const q = clampRange(f, p, 650); zone(f, { x: q.x, y: q.y, r: 95, delay: .6, dmg: 1000, color: SIL, onHit: t => slowOn(t, 3, .5) }); } },
      x: { name: '침묵의 검기', cd: 7, desc: '침묵의 검기를 발사. 데미지 1500, 적중 시 2초간 스킬 사용 불가', use(f) { setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 760, r: 20, dmg: 1500, color: SIL, kind: 'wave', life: 1.4, onHit: t => { silenceOn(t, 2); ui.pop(P3(t, 3.2), '🔇 침묵', '#a89fc8'); vfx.ring(P3(t), { r1: 3, color: SIL }); } }); } },
      c: { name: '적막의 종언', cd: 35, desc: '[컷신] 달을 반으로 베어버린다. 광역 3000', use(f) { startCut(f, '적막의 종언', () => { for (const t of B.fighters) if (t !== f) hurt(f, t, 3000); }); } },
      v: { name: '침묵의 심판', cd: 25, desc: '검을 꽂아 침묵의 영역 생성. 영역 내 시전자 외 모두 이동·스킬 불가, 초당 500. 피격 시/재입력 시 해제', use(f) { if (f.cast && f.cast.type === 'field') { endField(f); return true; } startField(f); return 'nocd'; } },
    }
  }
};
CHARS.lich = {
  id: 'lich', name: '리치드래곤 쿠키', color: 0xc46bff, cost: 500, hp: 27000, pref: 6.5, atkRange: 420, tag: '매혹 · 변신 · 정신세계',
  awake: { wins: 3, desc: '리치드래곤 쿠키로 3승' }, dragon: { hp: 52000 },
  skills: {
    base: {
      a: { name: '자줏빛 하트', cd: .95, desc: '자줏빛 하트를 발사. 데미지 120', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 520, r: 11, dmg: 120, color: 0xff7ae0, kind: 'heart', life: 1.05 }); } },
      z: {
        name: '큐트 엑스', cd: 6, desc: '도끼를 들고 이리저리 빠르게 베어버림. 광역 총 1500', use(f) {
          const e = foe(f), steps = [];
          for (let i = 0; i < 6; i++) steps.push({
            at: i * .2, fn: () => {
              const from = P3(f, 1.2), a = rnd(0, 6.283);
              f.x = clamp(e.x + Math.cos(a) * 110, PAD, W - PAD); f.y = clamp(e.y + Math.sin(a) * 110, PAD, H - PAD);
              f.face = ang(f, e); f.st.inv = .3; shake(.25, .15); setAnim(f, 'slash', .18);
              const to = P3(f, 1.2); vfx.line('glow', from, to, 14, { size: 1.1, size1: .1, c0: 0xffffff, c1: 0xff3fc8, life: .5, rad: .2 });
              vfx.line('heart', from, to, 5, { size: .5, size1: 0, c0: 0xff7ae0, life: .8, rad: .6, v: 1 });
              const ec = P3(e, 1.5), r = rnd(-.5, .5);               // X자 참격
              vfx.slashBB(ec, { rot: .8 + r, len: 6, color: 0xff7ae0 }); vfx.slashBB(ec, { rot: -.8 + r, len: 6, color: 0xffffff });
              vfx.flash(ec, { size: 4, color: 0xff3fc8, dur: .25, grow: true });
              vfx.burst('spark', ec, 16, { speed: 6, speed2: 14, life: .4, size: .45, c0: 0xffffff, c1: 0xff3fc8 });
              for (const t of B.fighters) if (t !== f && dist(f, t) < 190) hurt(f, t, 250);
            }
          });
          runScript(f, steps, 1.3, () => { f.st.inv = 0; vfx.ring(P3(f), { r1: 6, color: 0xff7ae0 }); });
        }
      },
      x: {
        name: '암흑의 매혹', cd: 14, desc: '적이 아군/물체를 리치드래곤 쿠키로 착각. 4초간 조준이 가까운 물체로 향함', use(f) {
          const e = foe(f); if (dist(f, e) > 650) { toast(f, '사거리 밖'); return false; }
          if (B.mind) { toast(f, '정신세계에서는 사용 불가'); return false; }
          setAnim(f, 'cast', .6); e.st.charm = 4;
          const a = P3(f, 1.5), b = P3(e, 1.5);
          vfx.line('heart', a, b, 24, { size: .6, size1: .1, c0: 0xff9ae6, c1: 0xff2ac0, life: 1, rad: .5, v: 1.5, up: 1 });
          vfx.ring(P3(e), { r0: .5, r1: 6, dur: .8, color: 0xff6ad8 }); vfx.ring(P3(f), { r0: .5, r1: 4, dur: .6, color: 0xff6ad8 });
          ui.pop(P3(e, 3.4), '💘 매혹', '#ff7ad9'); ui.flash('#ff6ad8', .4, .3);
        }
      },
      c: { name: '정신세계', cd: 45, desc: '상대의 정신세계로 들어가 1대1. 리치 이속 +15%, 데미지 +5%, 방어 +5% (15초)', use(f) { if (B.mind) return false; setAnim(f, 'cast', .6); startMind(f); } },
      v: {
        name: '리치드래곤 변신', cd: 40, desc: '각성(전투 밖 업그레이드) 후 해금. 25초간 리치드래곤(HP 52000)으로 변신, 스킬이 변화', use(f) {
          if (!f.awake) { toast(f, '각성 필요: 메뉴에서 각성을 완료하세요'); return false; }
          transform(f); return 'nocd';
        }
      },
    },
    dragon: {     // ※ 변신 후 스킬은 임시 스펙입니다 (스펙 전달받으면 교체)
      a: { name: '용의 숨결', cd: .95, desc: '(임시) 3갈래 불꽃. 각 160', use(f) { setAnim(f, 'breath', .35); for (const d of [-.2, 0, .2]) shoot(f, { a: f.face + d, sp: 620, r: 14, dmg: 160, color: 0xb05aff, kind: 'fire', life: .7 }); } },
      z: { name: '꼬리 휩쓸기', cd: 7, desc: '(임시) 주변 광역 2500 + 슬로우', use(f) { setAnim(f, 'tail', .5); const p = P3(f); vfx.slashGround(p, 0, { len: 9, color: 0xc46bff, dur: .5, from: 2.5 }); vfx.slashGround(p, Math.PI, { len: 9, color: 0xffffff, dur: .5, from: 2.5 }); shock(f, 220, 0xc46bff, 2500, t => slowOn(t, 2)); shake(.7, .4); } },
      x: { name: '암흑 브레스', cd: 10, desc: '(임시) 관통 광선 2000', use(f) { setAnim(f, 'breath', .9); shoot(f, { a: f.face, sp: 900, r: 42, dmg: 2000, pierce: true, color: 0xa040ff, kind: 'beam', life: 1.1 }); shake(.6, .5); ui.flash('#a040ff', .3, .3); } },
      c: { name: '용의 포효', cd: 30, desc: '(임시) 광역 3500 + 1.5초 기절', use(f) { setAnim(f, 'roar', 1); shake(1, .8); camFov = 14; for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: 1, r1: 440 * S * (.6 + i * .25), dur: .6 + i * .2, color: i ? 0xffffff : 0xc46bff }); ui.flash('#c46bff', .5, .6); shock(f, 440, 0xa040ff, 3500, t => t.st.stun = 1.5); } },
      v: { name: '변신 해제', cd: 1, desc: '변신을 해제', use(f) { revertForm(f); } },
    }
  }
};
function placeholder(id, name, color, cost, hp, tag) {
  return {
    id, name, color, cost, hp, pref: 5.5, atkRange: 380, tag: tag + ' (스펙 대기)', tmp: true, skills: {
      base: {
        a: { name: '기본 공격', cd: .95, desc: '(임시) 투사체 110', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 520, r: 10, dmg: 110, color, life: 1 }); } },
        z: { name: '임시 Z', cd: 6, desc: '(임시) 지정 위치 폭발 1100', use(f, p) { setAnim(f, 'cast', .4); const q = clampRange(f, p, 600); zone(f, { x: q.x, y: q.y, r: 100, delay: .5, dmg: 1100, color }); } },
        x: { name: '임시 X', cd: 8, desc: '(임시) 관통 투사체 1400', use(f) { setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 700, r: 18, dmg: 1400, pierce: true, color, kind: 'wave' }); } },
        c: { name: '임시 C', cd: 30, desc: '(임시) 광역 2500', use(f) { setAnim(f, 'cast', .5); shock(f, 330, color, 2500); shake(.5, .3); } },
        v: { name: '임시 V', cd: 25, desc: '(임시) 회복 2000', use(f) { f.hp = Math.min(f.max, f.hp + 2000); ui.pop(P3(f, 3), '+2000', '#7dff9b'); vfx.burst('glow', P3(f, 1), 30, { speed: 2, speed2: 6, life: 1, size: .8, c0: 0x7dff9b, up: 3 }); } },
      }
    }
  };
}
CHARS.shadow = {
  id: 'shadow', name: '쉐도우밀크 쿠키', color: 0x3a7bff, cost: 600, hp: 26000, pref: 5.5, atkRange: 560, tag: '아공간 · 정신 침투 · 유체이탈',
  awake: { wins: 3, desc: '쉐도우밀크 쿠키로 3승 (궁극기 해금)' }, ult: { need: 9000 },
  skills: {
    base: {
      a: { name: '푸른 구체', cd: 1.05, desc: '파란 중간 크기 구체 발사. 데미지 100, 피격 시 1% 확률로 슬로우', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 560, r: 15, dmg: 100, color: 0x3a7bff, kind: 'orb', life: 1.1, onHit: t => { if (Math.random() < .01) { slowOn(t, 3, .5); ui.pop(P3(t, 3.2), '🐌 슬로우', '#9fb8ff'); } } }); } },
      z: { name: '심연의 손길', cd: 12, desc: '푸른 마법진 위로 손과 줄이 내려오고, 진한 푸른 눈들이 생겨 폭발. 머문 시간만큼 데미지(폭발 포함 최대 1500), 슬로우', use(f, p) { setAnim(f, 'cast', .6); const q = clampRange(f, p, 620); makeHex(f, { x: q.x, y: q.y, r: 175 }); } },
      x: { name: '아공간 이동', cd: 14, desc: '아공간으로 들어가 잠시 무적·투명 상태로 이동하며 체력 10% 회복', use(f, p) { startSub(f, p, { dur: 1.4, speed: 330, heal: .1, away: true }); } },
      c: { name: '정신 침투', cd: 30, desc: '4초간 적을 조종해 이동시킴. 용족·정령 쿠키·사일런트솔트 쿠키에게는 불가', use(f) { return startControl(f); } },
      v: { name: '거짓의 장막', cd: 40, desc: '맵의 절반을 장막으로 덮음(20초). 장막 안 적은 슬로우 + 방향키 반전(용족·정령·사일런트솔트 제외). 장막 안에서 Q로 쉐도우 스텝(9초마다)', use(f) { startVeil(f); } },
      q: { name: '쉐도우 스텝', cd: 9, desc: '장막 안에서만. 무적·투명 상태로 빠르게 이동', use(f, p) { if (!f.veil || !inReg(f.veil.reg, f)) { toast(f, '거짓의 장막 안에서만 사용 가능'); return false; } startSub(f, p, { dur: .8, speed: 560, heal: 0, away: false }); } },
      r: {
        name: '유체이탈', cd: 0, desc: '(각성 후, 게이지 100%) 발동 후 죽으면 영혼 상태(HP 5000, 위력 25%, 쿨타임 +50%, 장막 범위 10%)로 부활. 영혼 상태에서 게이지를 다시 채워 사용하면 몸으로 부활', use(f) {
          if (!f.awake) { toast(f, '각성 필요: 메뉴에서 각성을 완료하세요'); return false; }
          if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
          if (f.soul) { reviveBody(f); return; }
          if (f.ult.armed) { toast(f, '이미 유체이탈이 발동 중입니다'); return false; }
          f.ult.armed = true; f.gauge = 0; setAnim(f, 'cast', .7);
          vfx.ring(P3(f), { r0: .5, r1: 7, dur: .8, color: 0x9fb8ff }); vfx.burst('glow', P3(f, 1.5), 40, { speed: 3, speed2: 9, life: 1.2, size: .9, c0: 0xffffff, c1: 0x3a7bff, up: 3 });
          ui.pop(P3(f, 3.4), '👻 유체이탈 발동', '#9fb8ff'); ui.flash('#3a5bff', .4, .4);
        }
      },
    }
  }
};

/* ===== 쉐도우밀크 ===== */
const SHB = 0x3a7bff;
const immune = t => t.def.id === 'silent' || t.form === 'dragon' || !!t.def.spirit;
const pwr = f => f.soul ? .25 : 1;
function buildEye(sc) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0x7e98e0, emissive: 0x2a4bff, emissiveIntensity: .7 })); w.scale.set(1.3, .8, .5); g.add(w);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0x0a1f9a })); iris.position.z = .2; iris.scale.set(1, 1, .5); g.add(iris);
  const pup = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x000010 })); pup.scale.set(.45, 1.7, .5); pup.position.z = .32; g.add(pup);
  g.scale.setScalar(sc); g.userData.sc = sc; return g;
}
function buildHand() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x14246e, emissive: 0x2a4bff, emissiveIntensity: .55, roughness: .5 });
  const palm = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 8), m); palm.scale.set(1, .5, 1); g.add(palm);
  for (let i = 0; i < 5; i++) { const a = (i - 2) * .5, fg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .06, 1, 6), m); fg.position.set(Math.sin(a) * .65, -.4, 0); fg.rotation.z = a * .5; g.add(fg); }
  g.scale.setScalar(1.5); return g;
}
// Z: 심연의 손길
function makeHex(f, o) {
  const hx = Object.assign({ owner: f, t: 0, dur: 3.5, hands: [], eyes: [], spawn: 0, eyesOn: false, boom: false, acc: 0 }, o), c = P3(hx);
  hx.rune = vfx.decal(c, { tex: 'rune', r: hx.r * S, color: SHB, alpha: .95, spin: 1.2 });
  hx.rune2 = vfx.decal(c, { tex: 'rune', r: hx.r * S * .6, color: 0xffffff, alpha: .55, spin: -2, y: .06 });
  hx.ring = vfx.decal(c, { tex: 'ring', r: hx.r * S, color: 0x9fb8ff, alpha: .9, y: .07 });
  vfx.ring(c, { r0: .5, r1: hx.r * S * 1.2, dur: .6, color: SHB }); ui.flash('#3a5bff', .3, .3);
  B.hexes.push(hx);
}
function removeHex(h) { [h.rune, h.rune2, h.ring].forEach(i => i && vfx.remove(i)); h.hands.forEach(a => { world.scene.remove(a.g); world.scene.remove(a.rope); }); h.eyes.forEach(e => world.scene.remove(e)); h.hands = []; h.eyes = []; }
function updHexes(dt) {
  for (const h of B.hexes) {
    h.t += dt; const c = P3(h), R = h.r * S, f = h.owner;
    if (h.t < 2.3) {   // 손과 줄이 떨어지는 구간
      h.spawn -= dt;
      if (h.spawn <= 0) {
        h.spawn = .18; const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R * .92, g = buildHand(), rope = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1, 6), new THREE.MeshBasicMaterial({ color: 0x7e98e0 }));
        g.position.set(c.x + Math.cos(a) * d, 22, c.z + Math.sin(a) * d); g.rotation.y = rnd(0, 6.283); world.scene.add(g, rope); h.hands.push({ g, rope, t0: h.t, x: g.position.x, z: g.position.z });
      }
      for (const t of B.fighters) {
        if (t === f || t.hp <= 0 || Math.hypot(t.x - h.x, t.y - h.y) > h.r + t.r) continue;
        slowOn(t, .3, .45); const dps = 260 * dt; hurt(f, t, dps, { field: true, quiet: true });
        t.hexAcc = (t.hexAcc || 0) + dps * dmgMul(f); if (t.hexAcc >= 250) { t.hexAcc -= 250; ui.pop(P3(t, 2.6), '250', '#7ea0ff'); hitFX(t, SHB, false); }
      }
    }
    for (const a of h.hands) {
      const u = Math.min(1, (h.t - a.t0) / .3), y = lerp(22, .5, 1 - (1 - u) * (1 - u)); a.g.position.y = y;
      const len = 22 - y; a.rope.position.set(a.x, y + len / 2 + .3, a.z); a.rope.scale.set(1, Math.max(.01, len), 1);
      if (u >= 1 && !a.hit) { a.hit = true; vfx.burst('glow', new THREE.Vector3(a.x, .4, a.z), 6, { speed: 3, life: .4, size: .5, c0: 0x9fb8ff, c1: SHB, flat: true }); }
    }
    h.hands = h.hands.filter(a => { if (h.t - a.t0 > 1.0 || h.t > 2.9) { world.scene.remove(a.g); world.scene.remove(a.rope); return false; } return true; });
    if (h.t >= 2.3 && !h.eyesOn) {   // 사악한 푸른 눈들
      h.eyesOn = true;
      for (let i = 0; i < 11; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R * .85, e = buildEye(rnd(.9, 1.7)); e.position.set(c.x + Math.cos(a) * d, rnd(.8, 4.5), c.z + Math.sin(a) * d); e.scale.setScalar(.01); world.scene.add(e); h.eyes.push(e); }
      vfx.ring(c, { r0: .5, r1: R * 1.1, dur: .5, color: 0x0a1f9a });
    }
    if (h.eyesOn && !h.boom) for (const e of h.eyes) { e.scale.setScalar(e.userData.sc * Math.min(1, (h.t - 2.3) / .5) * (1 + Math.sin(h.t * 14) * .05)); e.lookAt(camera.position); }
    if (h.t >= 3.0 && !h.boom) {   // 마지막 폭발
      h.boom = true; h.eyes.forEach(e => world.scene.remove(e)); h.eyes = [];
      erupt(c, R, SHB, 16); vfx.ring(c, { r0: .5, r1: R * 1.6, dur: .7, color: 0x0a1f9a }); vfx.burst('spark', c.clone().setY(1), 60, { speed: 8, speed2: 20, life: .8, size: .7, c0: 0xffffff, c1: SHB, grav: 5 });
      for (const t of B.fighters) if (t !== f && t.hp > 0 && Math.hypot(t.x - h.x, t.y - h.y) < h.r + t.r) { hurt(f, t, 900); slowOn(t, 2.5, .45); }
    }
  }
  B.hexes = B.hexes.filter(h => { if (h.t >= h.dur) { removeHex(h); return false; } return true; });
}
// X / Q: 아공간 이동 · 쉐도우 스텝
function startSub(f, p, o) {
  const e = foe(f); let dir = ang(f, p); if (f.ctrl.kind === 'ai' || o.away) dir = f.ctrl.kind === 'ai' ? ang(e, f) : dir;
  f.cast = { type: 'sub', t: 0, dur: o.dur, dir, speed: o.speed, heal: f.max * o.heal * pwr(f) }; f.st.inv = o.dur + .1; f.hidden = true; setAnim(f, 'cast', .2);
  const c = P3(f); vfx.ring(c, { r0: .3, r1: 4, dur: .5, color: 0x0a1f9a }); vfx.burst('glow', P3(f, 1), 30, { speed: 3, speed2: 8, life: .7, size: .8, c0: 0x9fb8ff, c1: 0x0a1f9a });
  vfx.decal(c, { tex: 'rune', r: 3, color: SHB, dur: o.dur, alpha: .9, spin: 3 });
}
function updSub(f, dt) {
  const c = f.cast; c.t += dt; f.st.inv = Math.max(f.st.inv, .1);
  f.x = clamp(f.x + Math.cos(c.dir) * c.speed * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(c.dir) * c.speed * dt, PAD, H - PAD);
  if (c.heal) { const g = c.heal * dt / c.dur; f.hp = Math.min(f.max, f.hp + g); }
  const p = P3(f, .6); if (Math.random() < .6) vfx.emit('glow', { x: p.x + rnd(-.4, .4), y: p.y, z: p.z + rnd(-.4, .4), vy: 1, life: .5, s0: .7, s1: 0, c0: 0x9fb8ff, c1: 0x0a1f9a, a: .8 });
  if (c.t >= c.dur) { f.cast = null; f.hidden = false; vfx.ring(P3(f), { r0: .3, r1: 4, dur: .5, color: SHB }); vfx.burst('glow', P3(f, 1), 24, { speed: 3, speed2: 8, life: .6, size: .7, c0: 0xffffff, c1: SHB }); if (c.heal) ui.pop(P3(f, 3.2), '+' + Math.round(c.heal), '#7dff9b'); }
}
// C: 정신 침투
function startControl(f) {
  const e = foe(f);
  if (dist(f, e) > 720) { toast(f, '사거리 밖'); return false; }
  if (B.mind) { toast(f, '정신세계에서는 사용 불가'); return false; }
  if (immune(e)) { ui.pop(P3(e, 3.4), '저항!', '#9fb8ff'); toast(f, '용족·정령 쿠키·사일런트솔트 쿠키는 조종할 수 없습니다'); return false; }
  setAnim(f, 'cast', .6); f.cast = { type: 'control', t: 0, dur: 4, fx: 0 }; e.st.ctl = 4; e.ctlBy = f;
  ui.pop(P3(e, 3.4), '🧠 조종', '#9fb8ff'); ui.flash('#3a5bff', .4, .3); vfx.ring(P3(e), { r0: .5, r1: 5, dur: .6, color: SHB });
}
function updControl(f, dt) {
  const c = f.cast, e = foe(f); c.t += dt; c.fx -= dt;
  if (c.fx <= 0) { c.fx = .12; vfx.line('glow', P3(f, 2.4), P3(e, 2.4), 6, { size: .5, size1: .1, c0: 0x9fb8ff, c1: 0x0a1f9a, life: .6, rad: .3, v: 1 }); }
  if (c.t >= c.dur || e.hp <= 0) { f.cast = null; e.st.ctl = 0; e.ctlBy = null; }
}
// V: 거짓의 장막
function inReg(r, p) { return r.kind === 'rect' ? p.x >= r.x0 && p.x <= r.x1 : Math.hypot(p.x - r.x, p.y - r.y) <= r.r; }
function startVeil(f) {
  if (f.veil) endVeil(f);
  const e = foe(f); let reg, geo, center;
  if (f.soul) { const R = Math.sqrt(.1 * W * H / Math.PI); reg = { kind: 'disc', x: e.x, y: e.y, r: R }; geo = new THREE.CircleGeometry(R * S, 48); center = W3(e.x, e.y, .09); }
  else { const left = e.x < W / 2; reg = { kind: 'rect', x0: left ? 0 : W / 2, x1: left ? W / 2 : W, y0: 0, y1: H }; geo = new THREE.PlaneGeometry(W / 2 * S, H * S); center = W3(left ? W / 4 : W * .75, H / 2, .09); }
  geo.rotateX(-Math.PI / 2);
  const group = new THREE.Group(), plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0a1a5e, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide })); plane.position.copy(center); plane.renderOrder = 3; group.add(plane);
  const eyes = [], n = f.soul ? 10 : 42;
  for (let i = 0; i < n; i++) {
    let x, y; if (reg.kind === 'rect') { x = rnd(reg.x0 + 30, reg.x1 - 30); y = rnd(30, H - 30); } else { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * reg.r * .9; x = reg.x + Math.cos(a) * d; y = reg.y + Math.sin(a) * d; }
    const ey = buildEye(rnd(.8, 1.8)); ey.position.copy(W3(x, y, rnd(1, 6))); ey.userData.ph = rnd(0, 6.283); group.add(ey); eyes.push(ey);
  }
  world.scene.add(group); f.veil = { t: 0, dur: 20, reg, group, eyes };
  setAnim(f, 'cast', .7); shake(.6, .5); ui.flash('#0a1f9a', .6, .6); toast(f, '거짓의 장막!');
  const cc = P3(f); for (let i = 0; i < 3; i++) vfx.ring(cc, { r0: 1, r1: 14 + i * 8, dur: .8 + i * .2, color: i ? 0x9fb8ff : 0x0a1f9a });
}
function endVeil(f) { const v = f.veil; if (!v) return; world.scene.remove(v.group); f.veil = null; }
function updVeil(f, dt) {
  const v = f.veil; v.t += dt; const e = foe(f);
  v.eyes.forEach(ey => { ey.lookAt(camera.position); const bl = Math.abs(Math.sin(v.t * 1.4 + ey.userData.ph)); ey.scale.set(ey.userData.sc, ey.userData.sc * (bl > .93 ? .15 : 1), ey.userData.sc); });
  if (e.hp > 0 && !immune(e) && inReg(v.reg, e)) { slowOn(e, .3, .55); e.st.rev = .3; if (Math.random() < .3) vfx.emit('glow', { x: e.root.position.x + rnd(-.6, .6), y: 2.4, z: e.root.position.z + rnd(-.6, .6), vy: 1, life: .6, s0: .35, s1: 0, c0: 0x9fb8ff }); }
  if (v.t >= v.dur) { endVeil(f); ui.pop(P3(f, 3.2), '장막 해제', '#9fb8ff'); }
}
// 궁극기: 유체이탈
function ghostify(f, on) { f.mats.forEach(m => { m.transparent = on; m.opacity = on ? .45 : 1; m.needsUpdate = true; }); }
function enterSoul(t) {
  t.soul = true; t.ult.armed = false; t.max = 5000; t.hp = 5000; t.shield = 0; t.shieldMax = 0; t.gauge = 0; t.st.inv = 2; t.hidden = false;
  if (t.cast) { if (t.cast.type === 'field') endField(t); else if (t.cast.type === 'paradise') endParadise(t); else { if (t.cast.type === 'control') { const e = foe(t); e.st.ctl = 0; e.ctlBy = null; } t.cast = null; } }
  if (t.drain) endDrain(t); if (t.veil) endVeil(t); t.pose = null; t.drT = 0;
  ghostify(t, true); const p = P3(t, 1.3);
  vfx.burst('glow', p, 80, { speed: 4, speed2: 14, life: 1.4, size: 1, c0: 0xffffff, c1: 0x3a7bff, up: 3 }); vfx.ring(P3(t), { r0: .5, r1: 12, dur: .9, color: 0x9fb8ff }); shake(.8, .5); ui.flash('#9fb8ff', .7, .6);
  ui.pop(P3(t, 3.6), '👻 유체이탈! 영혼 상태', '#cfe0ff'); toast(t, '영혼 상태: 위력 25%, 쿨타임 +50%. 궁극기 게이지를 채워 다시 사용하면 부활');
}
function reviveBody(f) {
  f.soul = false; f.max = f.def.hp; f.hp = Math.round(f.max * .5); f.gauge = 0; f.ult.armed = false; f.st.inv = 1.5; if (f.veil) endVeil(f);
  ghostify(f, false); vfx.burst('spark', P3(f, 1.4), 90, { speed: 6, speed2: 20, life: .9, size: .8, c0: 0xffffff, c1: 0x3a7bff, grav: 3 }); vfx.ring(P3(f), { r0: .5, r1: 12, dur: .8, color: 0xffffff }); ui.flash('#cfe0ff', .6, .5);
  ui.pop(P3(f, 3.6), '몸으로 부활!', '#7dff9b');
}
CHARS.sugar = {
  id: 'sugar', name: '이터널슈가 쿠키', color: 0xff8ad0, cost: 800, hp: 10000, shield: 40000, pref: 5.5, atkRange: 520, tag: '시작 보호막 40,000 · 호수 · 수면 · 설탕 낙원',
  skills: {
    base: {
      a: { name: '핑크빛 돌', cd: 1.2, desc: '하늘에서 핑크빛 돌을 떨어뜨림. 데미지 500', use(f, p) { setAnim(f, 'cast', .3); const q = clampRange(f, p, 560); zone(f, { x: q.x, y: q.y, r: 60, delay: .5, dmg: 500, color: 0xff8ad0, rock: true }); } },
      z: { name: '딸기잼 호수', cd: 14, desc: '아주 넓은 딸기잼 호수 생성. 강한 슬로우 + 초당 1000 (5초 유지)', use(f, p) { setAnim(f, 'cast', .6); const q = clampRange(f, p, 560); makeLake(f, { kind: 'lake', x: q.x, y: q.y, r: 300, dur: 5, dps: 1000, slowF: .25, color: 0xd81b4a, hi: 0xff7a9c }); ui.flash('#ff4f7d', .25, .3); } },
      x: { name: '설탕 호수', cd: 8, desc: '일직선으로 광역 핑크빛 설탕 호수를 만들며 데미지. 4000', use(f) { setAnim(f, 'cast', .5); makeLake(f, { kind: 'strip', x: f.x, y: f.y, a: f.face, len: 760, wid: 170, dur: 1.8, dmg: 4000, color: 0xff9ad8, hi: 0xffffff }); } },
      c: { name: '수면', cd: 25, desc: '5초간 수면. 받는 피해 60% 감소, 체력 20% · 보호막 20% 회복', use(f) { startSleep(f); } },
      v: { name: '설탕낙원', cd: 50, desc: '지형이 설탕 낙원으로 변하고 꽃 위에서 수면. 받는 피해 80% 감소, 체력 35% · 보호막 40% 회복. 설탕 천사가 적을 공격. 1분 유지, V 재입력 시 해제', use(f) { if (f.cast && f.cast.type === 'paradise') { endParadise(f); return true; } startParadise(f); return 'nocd'; } },
    }
  }
};

/* ===== 이터널슈가: 호수/장판 ===== */
const sugarHeal = (f, hp, sh) => { f.hp = Math.min(f.max, f.hp + hp); if (f.shieldMax) f.shield = Math.min(f.shieldMax, f.shield + sh); };
function makeLake(f, o) {
  const l = Object.assign({ owner: f, t: 0, hit: false, acc: 0 }, o);
  const geo = o.kind === 'strip' ? new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) : new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
  l.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0, depthWrite: false })); l.mesh.renderOrder = 3;
  l.mesh.position.copy(W3(o.x, o.y, .06)); world.scene.add(l.mesh);
  if (o.kind === 'lake') l.ring = vfx.decal(P3(o), { tex: 'ring', r: o.r * S, color: o.hi, alpha: .8, y: .08 });
  else l.mesh.rotation.y = -o.a;
  const p = P3(f, .8); vfx.ring(p, { r0: .5, r1: 6, dur: .5, color: o.hi }); vfx.burst('glow', p, 24, { speed: 3, speed2: 8, life: .8, size: .8, c0: 0xffffff, c1: o.color, flat: true });
  B.lakes.push(l);
}
function removeLake(l) { world.scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.material.dispose(); if (l.ring) vfx.remove(l.ring); }
function updLakes(dt) {
  for (const l of B.lakes) {
    l.t += dt;
    const grow = Math.min(1, l.t / (l.kind === 'strip' ? .35 : .5)), out = Math.min(1, (l.dur - l.t) / .6), al = .62 * Math.min(1, l.t / .2) * Math.max(0, out);
    l.mesh.material.opacity = al;
    if (l.kind === 'lake') {
      l.mesh.scale.set(l.r * S * grow, 1, l.r * S * grow); const c = P3(l);
      for (let i = 0; i < 4; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * l.r * S * grow; vfx.emit('glow', { x: c.x + Math.cos(a) * d, y: .1, z: c.z + Math.sin(a) * d, vy: rnd(1, 3), life: .9, s0: .6, s1: 0, c0: l.hi, c1: l.color, a: .7, drag: 0 }); }
      for (const t of B.fighters) {
        if (t === l.owner || t.hp <= 0 || Math.hypot(t.x - l.x, t.y - l.y) > l.r * grow + t.r) continue;
        slowOn(t, .3, l.slowF); hurt(l.owner, t, l.dps * dt, { field: true, quiet: true });
        t.lakeAcc = (t.lakeAcc || 0) + l.dps * dt * dmgMul(l.owner);
        if (t.lakeAcc >= 500) { t.lakeAcc -= 500; ui.pop(P3(t, 2.6), '500', '#ff7a9c'); hitFX(t, l.hi, false); }
      }
    } else {
      const len = l.len * grow, c = { x: l.x + Math.cos(l.a) * len / 2, y: l.y + Math.sin(l.a) * len / 2 };
      l.mesh.scale.set(len * S, 1, l.wid * S); l.mesh.position.copy(W3(c.x, c.y, .06));
      for (let i = 0; i < 4; i++) { const u = Math.random() * len, w = rnd(-.5, .5) * l.wid, q = W3(l.x + Math.cos(l.a) * u - Math.sin(l.a) * w, l.y + Math.sin(l.a) * u + Math.cos(l.a) * w, .1); vfx.emit('glow', { x: q.x, y: q.y, z: q.z, vy: rnd(1, 4), life: .8, s0: .6, s1: 0, c0: 0xffffff, c1: l.color, a: .8, drag: 0 }); }
      if (!l.hit && l.t >= .35) {
        l.hit = true; shake(.5, .3);
        for (const t of B.fighters) {
          if (t === l.owner || t.hp <= 0) continue;
          const dx = t.x - l.x, dy = t.y - l.y, al2 = dx * Math.cos(l.a) + dy * Math.sin(l.a), pe = Math.abs(-dx * Math.sin(l.a) + dy * Math.cos(l.a));
          if (al2 > -t.r && al2 < l.len + t.r && pe < l.wid / 2 + t.r) hurt(l.owner, t, l.dmg, { dir: l.a });
        }
      }
    }
  }
  B.lakes = B.lakes.filter(l => { if (l.t >= l.dur) { removeLake(l); return false; } return true; });
}

/* ===== 이터널슈가: 수면 (C) ===== */
function sleepFX(f, dt) { if (Math.random() < dt * 6) vfx.emit('heart', { x: f.root.position.x + rnd(-.5, .5), y: f.root.position.y + 2.2, z: f.root.position.z + rnd(-.5, .5), vy: 1.4, life: 1.4, s0: .45, s1: 0, c0: 0xffd0ee, c1: 0xff8ad0 }); }
function startSleep(f) {
  const dur = 5; f.cast = { type: 'sleep', t: 0, dur, hp: f.max * .2, sh: f.shieldMax * .2 }; f.drT = dur + .05; f.drV = .6; f.pose = 'sleep';
  vfx.ring(P3(f), { r0: .5, r1: 5, dur: .7, color: 0xffb3e6 }); vfx.burst('glow', P3(f, 1), 30, { speed: 2, speed2: 6, life: 1.2, size: .9, c0: 0xffffff, c1: 0xff8ad0, up: 2 });
  ui.pop(P3(f, 3.4), '💤 수면', '#ffb3e6'); setAnim(f, 'cast', .4);
}
function updSleep(f, dt) {
  const c = f.cast; c.t += dt; sleepFX(f, dt); sugarHeal(f, c.hp * dt / c.dur, c.sh * dt / c.dur);
  if (c.t >= c.dur) { f.cast = null; f.pose = null; f.drT = 0; ui.pop(P3(f, 3.2), '기상!', '#ffd0ee'); }
}

/* ===== 이터널슈가: 설탕낙원 (V) ===== */
function buildFlower(scale, petal) {
  const g = new THREE.Group(), pm = new THREE.MeshStandardMaterial({ color: petal, emissive: petal, emissiveIntensity: .25, roughness: .5 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 1, 8), new THREE.MeshStandardMaterial({ color: 0x9be8a8 })).translateY(.5));
  for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283, p = new THREE.Mesh(new THREE.SphereGeometry(.32, 12, 8), pm); p.scale.set(1, .35, .6); p.position.set(Math.cos(a) * .45, 1.05, Math.sin(a) * .45); p.rotation.y = -a; g.add(p); }
  g.add(new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffc933, emissiveIntensity: .5 })).translateY(1.08));
  g.scale.setScalar(scale); return g;
}
function startParadise(f) {
  const group = new THREE.Group(), cols = [0xffb3e6, 0xffffff, 0xff8ad0, 0xffd6f0];
  for (let i = 0; i < 46; i++) { const fl = buildFlower(rnd(.7, 1.5), cols[i % 4]); fl.position.set(rnd(-W * S / 2, W * S / 2), 0, rnd(-H * S / 2, H * S / 2)); fl.rotation.y = rnd(0, 6.283); fl.userData.ph = rnd(0, 6.283); group.add(fl); }
  const big = buildFlower(2.6, 0xff9ad8); big.position.copy(P3(f)); big.position.y = -.1; group.add(big); world.scene.add(group);
  f.cast = { type: 'paradise', t: 0, dur: 60, group, big, angelT: 1.2, hp: f.max * .35, sh: f.shieldMax * .4 };
  f.drT = 1e9; f.drV = .8; f.pose = 'sleep'; world.setParadise(true);
  const p = P3(f); for (let i = 0; i < 3; i++) vfx.ring(p, { r0: .5, r1: 10 + i * 8, dur: .7 + i * .25, color: i ? 0xffffff : 0xff9ad8 });
  vfx.burst('glow', P3(f, 1.5), 70, { speed: 4, speed2: 16, life: 1.2, life2: 2, size: 1, c0: 0xffffff, c1: 0xff8ad0, flat: true, drag: 1 });
  shake(.6, .5); ui.flash('#ffc2e6', .7, .6); toast(f, '설탕낙원 전개!');
}
function updParadise(f, dt) {
  const c = f.cast; c.t += dt; sleepFX(f, dt);
  if (c.t < 8) sugarHeal(f, c.hp * dt / 8, c.sh * dt / 8);
  c.group.children.forEach(o => { if (o.userData.ph !== undefined) o.rotation.z = Math.sin(B.time * 1.6 + o.userData.ph) * .06; });
  if (Math.random() < dt * 14) vfx.emit('glow', { x: rnd(-W * S / 2, W * S / 2), y: rnd(8, 14), z: rnd(-H * S / 2, H * S / 2), vy: -rnd(1.5, 3), life: 3.5, s0: rnd(.2, .45), s1: .1, c0: 0xffffff, c1: 0xffb3e6, a: .85, drag: 0 });
  c.angelT -= dt;
  if (c.angelT <= 0 && B.angels.filter(a => a.owner === f).length < 3) { spawnAngel(f); c.angelT = 2.6; }
  if (c.t >= c.dur) endParadise(f);
}
function endParadise(f) {
  const c = f.cast; if (!c || c.type !== 'paradise') return;
  f.cast = null; f.pose = null; f.drT = 0; f.cd.v = f.def.skills.base.v.cd;
  world.scene.remove(c.group); world.setParadise(false);
  B.angels.filter(a => a.owner === f).forEach(a => { world.scene.remove(a.g); vfx.burst('glow', W3(a.x, a.y, 2.4), 16, { speed: 3, life: .6, size: .7, c0: 0xffffff, c1: 0xffb3e6 }); });
  B.angels = B.angels.filter(a => a.owner !== f);
  vfx.ring(P3(f), { r0: 1, r1: 14, dur: .7, color: 0xffd0ee }); ui.flash('#ffd6f0', .5, .5);
}
function spawnAngel(f) {
  const g = new THREE.Group(), wm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd0ee, emissiveIntensity: .5 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd6f0, emissive: 0xff8ad0, emissiveIntensity: .3 })));
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), wm); w.scale.set(.2, 1, .5); w.position.set(s * .55, .25, -.15); w.rotation.z = s * .5; g.add(w); g.userData['w' + s] = w; }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.28, .04, 8, 20), new THREE.MeshBasicMaterial({ color: 0xfff2a8 })); halo.position.y = .75; halo.rotation.x = Math.PI / 2; g.add(halo);
  const a = { owner: f, x: clamp(f.x + rnd(-80, 80), PAD, W - PAD), y: clamp(f.y + rnd(-80, 80), PAD, H - PAD), t: 0, life: 12, fire: rnd(.4, 1), ph: rnd(0, 6.283), g };
  g.position.copy(W3(a.x, a.y, 2.6)); g.scale.setScalar(1.5); world.scene.add(g); B.angels.push(a);
  vfx.burst('glow', W3(a.x, a.y, 2.4), 22, { speed: 4, life: .7, size: .8, c0: 0xffffff, c1: 0xffb3e6 }); vfx.ring(W3(a.x, a.y, .1), { r0: .3, r1: 3, dur: .5, color: 0xffb3e6 });
}
function updAngels(dt) {
  for (const a of B.angels) {
    a.t += dt; a.life -= dt; const e = foe(a.owner);
    const tx = e.x + Math.cos(a.ph + a.t * .7) * 230, ty = e.y + Math.sin(a.ph + a.t * .7) * 230, d = Math.hypot(tx - a.x, ty - a.y) || 1;
    a.x = clamp(a.x + (tx - a.x) / d * Math.min(d, 170 * dt), PAD, W - PAD); a.y = clamp(a.y + (ty - a.y) / d * Math.min(d, 170 * dt), PAD, H - PAD);
    a.g.position.copy(W3(a.x, a.y, 2.6 + Math.sin(a.t * 3) * .35)); a.g.rotation.y = Math.PI / 2 - ang(a, e);
    const fl = Math.sin(a.t * 10) * .4; a.g.userData.w1.rotation.z = .5 + fl; a.g.userData['w-1'].rotation.z = -.5 - fl;
    a.fire -= dt;
    if (a.fire <= 0 && e.hp > 0) { a.fire = 1.1; shoot(a.owner, { x: a.x, y: a.y, a: ang(a, e), sp: 520, r: 11, dmg: 450, color: 0xffb3e6, kind: 'heart', life: 1.4 }); }
  }
  B.angels = B.angels.filter(a => { if (a.life <= 0) { world.scene.remove(a.g); vfx.burst('glow', W3(a.x, a.y, 2.4), 14, { speed: 3, life: .6, size: .6, c0: 0xffffff, c1: 0xffb3e6 }); return false; } return true; });
}
CHARS.dark = {
  id: 'dark', name: '어둠마녀 쿠키', color: 0xd8202f, cost: 600, hp: 24000, witch: { hp: 60000 }, pref: 5.5, atkRange: 520, tag: '유도 · 흡수 · 변신',
  skills: {
    base: {
      a: { name: '핏빛 구체', cd: .95, desc: '시뻘건 유도 마법구체를 발사. 범위 안에서만 유도. 데미지 120', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 500, r: 12, dmg: 120, color: 0xff2438, kind: 'orb', life: 1.2, homing: 340, turn: 3.6 }); } },
      z: { name: '진홍의 마법진', cd: 9, desc: '붉은 마법진을 소환하고 구체가 솟구친 뒤 대폭발. 데미지 2500, 적중 시 2초간 스킬 쿨타임이 줄지 않음', use(f, p) { setAnim(f, 'cast', .6); const q = clampRange(f, p, 600); zone(f, { x: q.x, y: q.y, r: 140, delay: 1, dmg: 2500, color: 0xff2438, fancy: true, onHit: t => { t.st.cdfreeze = 2; ui.pop(P3(t, 3.4), '⏳ 쿨타임 정지', '#ff8a8a'); } }); } },
      x: { name: '에너지 흡수진', cd: 20, desc: '붉은 흡수 마법진 소환. 10초간 초당 약 500의 피를 흡수. 기절·넉백을 맞으면 해제', use(f) { if (f.drain) return false; startDrain(f); } },
      c: { name: '광역 폭발 마법', cd: 22, desc: '넓은 범위에 붉은 폭발 마법이 무작위로 연속 폭발. 폭발당 700', use(f) { startRandomBlast(f); } },
      v: { name: '어둠마녀 변신', cd: 40, desc: '25초간 어둠마녀로 변신하고 스킬이 달라짐 (변신 후 스킬은 임시)', use(f) { transformWitch(f); return 'nocd'; } },
    },
    witch: {    // ※ 변신 후 스킬은 임시 스펙입니다 (스펙 전달받으면 교체)
      a: { name: '핏빛 삼연구', cd: 1.15, desc: '(임시) 유도 구체 3발. 각 150', use(f) { setAnim(f, 'cast', .25); for (const d of [-.25, 0, .25]) shoot(f, { a: f.face + d, sp: 520, r: 12, dmg: 150, color: 0xff2438, kind: 'orb', life: 1.2, homing: 380, turn: 3.6 }); } },
      z: { name: '진홍 대폭발', cd: 8, desc: '(임시) 지정 위치 대폭발 3500', use(f, p) { setAnim(f, 'cast', .6); const q = clampRange(f, p, 650); zone(f, { x: q.x, y: q.y, r: 170, delay: .9, dmg: 3500, color: 0xff2438, fancy: true }); } },
      x: { name: '피의 광선', cd: 10, desc: '(임시) 관통 광선 2200', use(f) { setAnim(f, 'breath', .7); shoot(f, { a: f.face, sp: 900, r: 40, dmg: 2200, pierce: true, color: 0xff1a2a, kind: 'beam', life: 1.1 }); shake(.5, .4); } },
      c: { name: '핏빛 폭풍', cd: 20, desc: '(임시) 폭발 마법 연속 폭발', use(f) { startRandomBlast(f, 1.5); } },
      v: { name: '변신 해제', cd: 1, desc: '변신을 해제', use(f) { revertForm(f); f.cd.v = 40; } },
    }
  }
};

/* ===== 어둠마녀 ===== */
function startRandomBlast(f, mul = 1) {
  const e = foe(f), steps = []; setAnim(f, 'cast', .8);
  vfx.ring(P3(f), { r0: .5, r1: 8, dur: .6, color: 0xff2438 }); ui.flash('#ff2030', .3, .3);
  for (let i = 0; i < Math.round(12 * mul); i++) steps.push({
    at: .4 + i * .2, fn: () => {
      const near = Math.random() < .5, x = near ? clamp(e.x + rnd(-260, 260), PAD, W - PAD) : rnd(PAD, W - PAD), y = near ? clamp(e.y + rnd(-200, 200), PAD, H - PAD) : rnd(PAD, H - PAD);
      zone(f, { x, y, r: 105, delay: .7, dmg: 700, color: 0xff2438 });
    }
  });
  runScript(f, steps, 3, null);
}
function startDrain(f) {
  const R = 300, d = f.drain = { t: 0, dur: 10, r: R, acc: 0, fx: 0 };
  d.rune = vfx.decal(P3(f), { tex: 'rune', r: R * S, color: 0xff2438, alpha: .85, spin: .6 });
  d.rune2 = vfx.decal(P3(f), { tex: 'rune', r: R * S * .6, color: 0xff8080, alpha: .6, spin: -1.2, y: .06 });
  d.ring = vfx.decal(P3(f), { tex: 'ring', r: R * S, color: 0xffffff, alpha: .8, y: .07 });
  vfx.ring(P3(f), { r0: .5, r1: R * S * 1.2, dur: .6, color: 0xff2438 }); ui.flash('#ff2030', .3, .3); setAnim(f, 'cast', .4); toast(f, '에너지 흡수 시작');
}
function endDrain(f, broken) {
  const d = f.drain; if (!d) return; f.drain = null;
  [d.rune, d.rune2, d.ring].forEach(i => vfx.remove(i));
  vfx.ring(P3(f), { r0: 1, r1: 6, dur: .5, color: 0xff8080 });
  if (broken) { ui.pop(P3(f, 3.4), '흡수 해제!', '#ff8a8a'); toast(f, '흡수 해제!'); }
}
function updDrain(f, dt) {
  const d = f.drain; d.t += dt;
  if (f.st.stun > 0 || f.st.knock > 0) { endDrain(f, true); return; }
  if (d.t >= d.dur) { endDrain(f, false); return; }
  const p = P3(f);
  for (const it of [d.rune, d.rune2, d.ring]) { it.obj.position.x = p.x; it.obj.position.z = p.z; }
  const e = foe(f);
  if (e.hp > 0 && Math.hypot(e.x - f.x, e.y - f.y) < d.r + e.r) {
    const amt = 500 * dt; hurt(f, e, amt, { quiet: true, field: true });
    f.hp = Math.min(f.max, f.hp + amt * dmgMul(f)); d.acc += amt;
    d.fx -= dt; if (d.fx <= 0) { d.fx = .12; vfx.line('glow', P3(e, 1.5), P3(f, 1.5), 7, { size: .6, size1: .1, c0: 0xff4050, c1: 0x800010, life: .7, rad: .4, v: 1 }); }
    if (d.acc >= 500) { d.acc -= 500; ui.pop(P3(e, 2.6), '-500', '#ff6a78'); ui.pop(P3(f, 2.6), '+500', '#7dff9b'); }
  }
  if (Math.random() < .6) { const a = rnd(0, 6.283); vfx.emit('glow', { x: p.x + Math.cos(a) * d.r * S, y: .2, z: p.z + Math.sin(a) * d.r * S, vx: -Math.cos(a) * 2, vy: rnd(1, 3), vz: -Math.sin(a) * 2, life: 1, s0: .5, s1: 0, c0: 0xff4050, a: .8, drag: 0 }); }
}
function transformWitch(f) {
  setAnim(f, 'cast', 1); const p = P3(f), ratio = f.hp / f.max; f.form = 'witch'; f.formT = 25; f.max = 60000; f.hp = ratio * 60000;
  for (const k in f.cd) f.cd[k] = 0; f.cd.v = 0;
  for (let i = 0; i < 4; i++) vfx.ring(p, { r0: 1, r1: 8 + i * 4, dur: .6 + i * .2, color: i % 2 ? 0xffffff : 0xff2438 });
  vfx.column(p, { r: 3, h: 36, dur: 1.1, color: 0xff2438 }); vfx.column(p, { r: 1.6, h: 36, dur: .9, color: 0xffffff });
  vfx.burst('spark', P3(f, 2), 120, { speed: 8, speed2: 28, life: .9, life2: 1.8, size: 1, c0: 0xffffff, c1: 0xff2030, grav: 3 });
  vfx.decal(p, { tex: 'rune', r: 6, color: 0xff2438, dur: 1.5, alpha: 1, spin: 3 }); shake(1, .7); ui.flash('#ff2030', .7, .45);
}
const ORDER = ['silent', 'lich', 'shadow', 'sugar', 'dark'];

/* ===== 리치드래곤 변신 ===== */
function transform(f) {
  const ratio = f.hp / f.max;
  setAnim(f, 'cast', 1.4); f.pose = 'float';
  const p = P3(f);
  runScript(f, [
    { at: 0, fn: () => { f.st.inv = 2; ui.vignette(true); vfx.decal(p, { tex: 'rune', r: 6, color: 0xc46bff, dur: 1.6, alpha: 1, spin: 3 }); vfx.decal(p, { tex: 'rune', r: 3.4, color: 0xffffff, dur: 1.6, alpha: .8, spin: -4, y: .06 }); } },
    ...Array.from({ length: 14 }, (_, i) => ({ at: i * .07, fn: () => { for (let k = 0; k < 14; k++) { const a = rnd(0, 6.283), d = rnd(5, 9); vfx.emit('glow', { x: p.x + Math.cos(a) * d, y: rnd(0, 6), z: p.z + Math.sin(a) * d, vx: -Math.cos(a) * 12, vy: rnd(0, 4), vz: -Math.sin(a) * 12, life: .5, s0: .8, s1: .1, c0: 0xffffff, c1: 0xc46bff, drag: 0 }); } vfx.emit('heart', { x: p.x + rnd(-3, 3), y: 0, z: p.z + rnd(-3, 3), vy: rnd(3, 7), life: 1, s0: .8, s1: 0, c0: 0xff7ae0, c1: 0x8a2be2 }); shake(.15 + i * .02, .1); } })),
    {
      at: 1.0, fn: () => {
        f.form = 'dragon'; f.formT = 25; f.max = 52000; f.hp = ratio * 52000; f.dragonPop = 0;
        for (const k in f.cd) f.cd[k] = 0; f.cd.v = 0; shake(1.2, .9); B.hitstop = .2; ui.flash('#c46bff', .8, .45);
        for (let i = 0; i < 4; i++) vfx.ring(p, { r0: 1, r1: 9 + i * 5, dur: .6 + i * .2, color: i % 2 ? 0xffffff : 0xc46bff });
        vfx.column(p, { r: 4, h: 40, dur: 1.2, color: 0xc46bff }); vfx.column(p, { r: 2, h: 40, dur: .9, color: 0xffffff });
        vfx.burst('spark', P3(f, 2), 160, { speed: 8, speed2: 34, life: .9, life2: 2, size: 1.1, c0: 0xffffff, c1: 0xc46bff, grav: 3 });
        vfx.burst('smoke', P3(f, 1), 40, { speed: 3, speed2: 10, life: 1.5, size: 3, c0: 0x3a1060, flat: true });
      }
    },
  ], 1.5, () => { f.st.inv = 0; f.pose = null; ui.vignette(false); setAnim(f, 'roar', .8); });
}
function revertForm(f) {
  const ratio = f.hp / f.max; f.form = 'base'; f.formT = 0; f.max = f.def.hp; f.hp = Math.max(1, ratio * f.max); f.cd.v = 40;
  const p = P3(f, 1.5); vfx.burst('spark', p, 80, { speed: 6, speed2: 20, life: .8, size: .8, c0: 0xffffff, c1: 0xc46bff }); vfx.ring(P3(f), { r1: 8, color: 0xc46bff }); shake(.5, .3);
}

/* ================= 캐릭터 생성 + 애니메이션 ================= */
function mkFighter(def, x, y, ctrl) {
  const f = {
    def, x, y, r: 22, hp: def.hp, max: def.hp, face: 0, form: 'base', formT: 0,
    cd: { a: 0, z: 0, x: 0, c: 0, v: 0 }, st: { slow: 0, slowF: 1, silence: 0, stun: 0, charm: 0, inv: 0, lock: 0, cdfreeze: 0, knock: 0, rev: 0, ctl: 0 },
    cast: null, script: null, awake: ctrl.kind === 'ai' || SAVE.awake.includes(def.id), ctrl, ai: { t: 0, strafe: 1 }, flash: 0, mindBuff: false,
    gauge: 0, ult: { armed: false }, soul: false, hidden: false, last: { mx: 0, my: 0 }, shield: def.shield || 0, shieldMax: def.shield || 0, drT: 0, drV: 0, anim: null, pose: null, at: Math.random() * 10, yaw: 0, vel: 0, cutGlow: 0, dragonPop: 1,
  };
  f.root = new THREE.Group(); f.rig = buildCookie(def); f.root.add(f.rig.root);
  if (def.dragon) { f.drg = buildDragon(); f.drg.root.visible = false; f.root.add(f.drg.root); }
  f.root.scale.setScalar(1); world.scene.add(f.root);
  f.mats = []; f.root.traverse(o => { if (o.isMesh && o.material.emissive) { o.material.userData.e0 = o.material.emissive.clone(); o.material.userData.ei0 = o.material.emissiveIntensity; f.mats.push(o.material); } });
  // 바닥 그림자 블롭 + 오라
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: tex('glow'), color: def.color, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = .05; f.root.add(blob); f.blob = blob;
  f.root.position.copy(W3(x, y)); return f;
}
function removeFighter(f) { world.scene.remove(f.root); }

const rot = (o, x, y, z) => o.rotation.set(x, y, z);
function animate(f, dt) {
  f.at += dt;
  if (f.def.id === 'dark') f.root.scale.setScalar(lerp(f.root.scale.x, f.form === 'witch' ? 1.3 : 1, .15));
  const T = f.at, dead = f.hp <= 0, dragon = f.form === 'dragon';
  // 위치/방향
  const tp = W3(f.x, f.y, 0);
  if (!B.cut || f !== B.cut.f) f.root.position.set(tp.x, f.root.position.y * (f.lift ? 1 : 0) + (f.pose === 'float' ? 1.2 + Math.sin(T * 4) * .15 : 0) + (f.pose === 'sleep' && f.cast && f.cast.type === 'paradise' ? 1.9 : 0), tp.z);
  const want = Math.PI / 2 - f.face; let d = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw)); f.yaw += d * Math.min(1, dt * 16);
  f.root.rotation.y = f.yaw;
  // 모델 전환
  f.rig.root.visible = !dragon && !f.hidden && !f.bushHid; if (f.drg) f.drg.root.visible = dragon && !f.bushHid;
  if (dragon) { f.dragonPop = Math.min(1, f.dragonPop + dt * 2.5); const s = ease.out(f.dragonPop); f.drg.root.scale.setScalar(Math.max(.01, s * (1 + Math.sin(f.dragonPop * 9) * .06 * (1 - f.dragonPop)))); }
  f.blob.scale.setScalar(dragon ? 2 : 1); f.blob.visible = !f.hidden && !f.bushHid;
  // 피격 플래시 / 상태 색
  const fl = f.flash > 0;
  for (const m of f.mats) { if (fl) { m.emissive.setScalar(.9); m.emissiveIntensity = 1; } else { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; } }
  // 애니메이션 진행
  let ap = 0, an = null; if (f.anim) { f.anim.t += dt; ap = Math.min(1, f.anim.t / f.anim.d); an = f.anim.n; if (ap >= 1) f.anim = null; }
  const mv = f.vel, run = Math.min(1, mv / 3);
  if (dragon) return f.drg.glb ? animDragonGLB(f, dt, T, an, ap, run, dead) : animDragon(f, dt, T, an, ap, run, dead);
  const R = f.rig, bob = Math.sin(T * 3) * .03;
  R.body.position.y = bob + Math.abs(Math.sin(T * 12)) * .06 * run; R.body.rotation.set(run * .12, 0, 0);
  R.legL.rotation.x = Math.sin(T * 12) * .8 * run; R.legR.rotation.x = -Math.sin(T * 12) * .8 * run;
  R.armL.rotation.set(-Math.sin(T * 12) * .7 * run, 0, .12 + Math.sin(T * 3) * .04); R.armR.rotation.set(Math.sin(T * 12) * .5 * run - .15, 0, -.12);
  R.head.rotation.set(0, 0, 0); R.head.position.y = R.headY ?? 1.65; R.torso.rotation.set(0, 0, 0);
  if (R.weapon) R.weapon.rotation.x = -1.0;
  const ex = R.extras;
  if (ex.crystals) ex.crystals.forEach((c, i) => { const a = c.userData.a + T * 1.6; c.position.set(Math.cos(a) * .9, 1.0 + Math.sin(T * 2 + i) * .25, Math.sin(a) * .9); c.rotation.y += dt * 3; });
  if (ex.halo) ex.halo.rotation.z += dt;
  if (ex['wing-1']) { const fl2 = Math.sin(T * 6) * .25; ex['wing-1'].rotation.z = -1.0 - fl2; ex['wing1'].rotation.z = 1.0 + fl2; }
  if (ex.sugarWings) { const fl3 = Math.sin(T * 5) * .22; ex.sugarWings[0].rotation.z = fl3; ex.sugarWings[1].rotation.z = -fl3; ex.sugarTail.rotation.z = Math.sin(T * 3) * .35; }
  // 컷신 중 검 발광
  if (ex.bladeM) ex.bladeM.emissiveIntensity = 1.6 + f.cutGlow * 1.0 + (f.cast ? 1.0 : 0);
  // 액션 애니메이션
  if (an === 'slash') {
    const u = ease.out(ap), s = f.swingDir || 1;
    R.armR.rotation.set(lerp(-2.7, -.2, u), 0, lerp(-.5 * s, .3, u)); R.torso.rotation.y = lerp(-.7 * s, .7 * s, u); R.body.rotation.x = .25 * Math.sin(ap * Math.PI);
    if (R.weapon) R.weapon.rotation.x = lerp(-.4, -1.3, u);
  } else if (an === 'cast') {
    const u = Math.sin(Math.min(1, ap * 1.2) * Math.PI * .5);
    R.armR.rotation.set(-1.55 * u, 0, -.2); R.armL.rotation.set(-1.2 * u, 0, .3); R.body.rotation.x = -.1 * u; R.head.rotation.x = -.15 * u;
  } else if (an === 'hit') { R.body.rotation.x = -.5 * Math.sin(ap * Math.PI); R.head.rotation.x = -.4 * Math.sin(ap * Math.PI); R.body.position.y += .15 * Math.sin(ap * Math.PI); }
  // 지속 포즈
  if (f.pose === 'raise') { R.armR.rotation.set(-3.0, 0, -.2); R.armL.rotation.set(-2.6, 0, .4); R.body.rotation.x = -.18; R.head.rotation.x = -.35; if (R.weapon) R.weapon.rotation.x = -.2; }
  else if (f.pose === 'leap') { R.armR.rotation.set(-2.4, 0, -.2); R.armL.rotation.set(-2.2, 0, .3); R.legL.rotation.x = .6; R.legR.rotation.x = -.8; if (R.weapon) R.weapon.rotation.x = -.5; f.root.rotation.x = -.35; }
  else if (f.pose === 'slashhi') { R.armR.rotation.set(-2.9, 0, -.3); R.armL.rotation.set(-2.5, 0, .3); R.body.rotation.x = -.25; if (R.weapon) R.weapon.rotation.x = -.15; f.root.rotation.x = 0; }
  else if (f.pose === 'stab') { // 검을 땅에 꽂는 자세
    R.body.position.y = -.35; R.legL.rotation.x = -1.1; R.legR.rotation.x = .5; R.armR.rotation.set(-1.05, 0, -.1); R.armL.rotation.set(-1.0, 0, .15); R.body.rotation.x = .35; R.head.rotation.x = -.2;
    if (R.weapon) R.weapon.rotation.x = -.05;
  } else if (f.pose === 'stab2') { R.armR.rotation.set(-.3, 0, 0); R.body.rotation.x = .4; R.body.position.y = -.2; }
  else if (f.pose === 'sleep') { R.body.rotation.x = -1.3; R.body.position.y = .4; R.legL.rotation.x = .1; R.legR.rotation.x = -.1; R.armL.rotation.set(0, 0, .5); R.armR.rotation.set(0, 0, -.5); R.head.rotation.x = .2; }
  else if (f.pose === 'float') { R.armR.rotation.set(-2.2, 0, -.9); R.armL.rotation.set(-2.2, 0, .9); R.body.rotation.x = -.1; R.legL.rotation.x = .2; R.legR.rotation.x = -.2; }
  if (f.pose !== 'leap') f.root.rotation.x = 0;
  if (f.st.stun > 0) { R.head.rotation.z = Math.sin(T * 14) * .25; if (Math.random() < .3) vfx.emit('spark', { x: f.root.position.x + Math.cos(T * 8) * .6, y: 3, z: f.root.position.z + Math.sin(T * 8) * .6, life: .4, s0: .35, s1: 0, c0: 0xffe066 }); }
  if (f.st.charm > 0 && Math.random() < .35) vfx.emit('heart', { x: f.root.position.x + rnd(-.8, .8), y: 2.2, z: f.root.position.z + rnd(-.8, .8), vy: 2, life: 1, s0: .5, s1: 0, c0: 0xff7ae0, c1: 0xff2ac0 });
  if (f.st.slow > 0 && Math.random() < .3) vfx.emit('glow', { x: f.root.position.x + rnd(-.6, .6), y: .2, z: f.root.position.z + rnd(-.6, .6), vy: 1.2, life: .8, s0: .5, s1: 0, c0: 0x8fa4ff, a: .7 });
  if (f.st.silence > 0 && Math.random() < .3) vfx.emit('spark', { x: f.root.position.x + rnd(-.6, .6), y: 2.6, z: f.root.position.z + rnd(-.6, .6), vy: 1, life: .6, s0: .3, s1: 0, c0: 0xcfd8ff });
  if (f.st.inv > 0 && !f.hidden) R.root.visible = Math.floor(T * 40) % 2 === 0 || !!f.script;
  if (dead) { f.deadT = (f.deadT || 0) + dt; const u = Math.min(1, f.deadT * 1.6); f.root.rotation.z = u * Math.PI / 2; f.root.position.y = -u * .35; R.body.rotation.x = 0; R.root.visible = true; }
  if (!f.mindBuff) { /* noop */ } else if (Math.random() < .25) vfx.emit('glow', { x: f.root.position.x + rnd(-.7, .7), y: .1, z: f.root.position.z + rnd(-.7, .7), vy: 2.5, life: .8, s0: .5, s1: 0, c0: 0xff7ae0, a: .7 });
}
function animDragonGLB(f, dt, T, an, ap, run, dead) {
  const D = f.drg, fl = Math.sin(T * 5) * .35 + (an === 'roar' ? .6 : an === 'breath' ? .2 : 0), st = Math.sin(T * 9) * .5 * run;
  D.body.position.y = D.body.userData.y0 + Math.sin(T * 2) * .12; D.body.rotation.x = run * .05;
  poseBone(D, 'L_Upperarm', 0, 0, fl * .9 - .1); poseBone(D, 'R_Upperarm', 0, 0, fl * .9 - .1);
  poseBone(D, 'L_Thigh', st, 0, 0); poseBone(D, 'R_Thigh', -st, 0, 0);
  poseBone(D, 'Head', an === 'roar' ? -.5 * Math.sin(ap * Math.PI) : an === 'breath' ? -.25 * Math.sin(ap * Math.PI) : 0, 0, 0);
  poseBone(D, 'Spine02', 0, an === 'tail' ? Math.sin(ap * Math.PI * 2) * 1.0 : Math.sin(T * 2.4) * .05, 0);
  if (Math.random() < .4) vfx.emit('glow', { x: f.root.position.x + rnd(-1.5, 1.5), y: rnd(.5, 3), z: f.root.position.z + rnd(-1.5, 1.5), vy: 3, life: .9, s0: .8, s1: 0, c0: 0xd066ff, c1: 0x3a1060, a: .8 });
  if (Math.random() < .5) { const h = D.head.getWorldPosition(new THREE.Vector3()); vfx.emit('glow', { x: h.x, y: h.y + .2, z: h.z, vy: 1.5, life: .6, s0: .5, s1: 0, c0: 0xe08aff }); }
  if (dead) { f.deadT = (f.deadT || 0) + dt; const u = Math.min(1, f.deadT * 1.2); f.root.rotation.z = u * .6; f.root.position.y = -u * .8; }
}
function animDragon(f, dt, T, an, ap, run, dead) {
  const D = f.drg, fl = Math.sin(T * 5) * .35;
  D.body.position.y = Math.sin(T * 2) * .1 + (f.pose === 'float' ? 0 : .0); D.body.rotation.x = run * .06;
  D.wings.forEach(w => { w.g.rotation.z = w.s * (.35 + fl + (an === 'roar' ? .6 : 0)); w.g.rotation.y = w.s * .25; });
  D.tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(T * 2.4 - i * .5) * .22 + (an === 'tail' ? Math.sin(ap * Math.PI * 2) * 1.2 : 0); });
  D.segs.forEach((s, i) => { s.rotation.x = -.18 + (an === 'breath' ? -.2 * Math.sin(ap * Math.PI) : 0); });
  D.jaw.rotation.x = (an === 'breath' || an === 'roar') ? .7 * Math.sin(Math.min(1, ap * 1.5) * Math.PI) + .15 : .05 + Math.sin(T * 3) * .03;
  D.legs.forEach((l, i) => l.rotation.x = Math.sin(T * 9 + i * Math.PI) * .5 * run);
  D.core.scale.setScalar(1 + Math.sin(T * 6) * .15); D.head.rotation.x = an === 'roar' ? -.5 * Math.sin(ap * Math.PI) : 0;
  if (Math.random() < .4) vfx.emit('glow', { x: f.root.position.x + rnd(-1.5, 1.5), y: rnd(.5, 3), z: f.root.position.z + rnd(-1.5, 1.5), vy: 3, life: .9, s0: .8, s1: 0, c0: 0xd066ff, c1: 0x3a1060, a: .8 });
  if (Math.random() < .5) { const h = D.head.getWorldPosition(new THREE.Vector3()); vfx.emit('glow', { x: h.x, y: h.y + .2, z: h.z, vy: 1.5, life: .6, s0: .5, s1: 0, c0: 0xe08aff }); }
  if (dead) { f.deadT = (f.deadT || 0) + dt; const u = Math.min(1, f.deadT * 1.2); f.root.rotation.z = u * .6; f.root.position.y = -u * .8; }
}

/* ================= 입력 ================= */
const down = {}, Q1 = [], Q2 = [], mouse = { x: 0, y: 0, down: false, wx: W / 2, wy: H / 2 };
const K1 = { KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyQ: 'q', KeyR: 'r' }, K2 = { Digit7: 'z', Digit8: 'x', Digit9: 'c', Digit0: 'v', Digit6: 'q', Minus: 'r' };
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
function bindInput() {
  addEventListener('keydown', e => {
    if (!B) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) e.preventDefault();
    if (!e.repeat) { if (K1[e.code]) Q1.push(K1[e.code]); if (K2[e.code]) Q2.push(K2[e.code]); }
    down[e.code] = true;
  });
  addEventListener('keyup', e => down[e.code] = false);
  addEventListener('keydown', e => { if (B && !e.repeat && e.code === 'KeyT') { cam.fit = !cam.fit; ui.toast(cam.fit ? '시점: 둘 다 보기' : '시점: 내 캐릭터 추적'); } });
  let drag = false;
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * (1 + e.deltaY * .001), 5, 42); }, { passive: false });
  canvas.addEventListener('pointerdown', e => { if (e.button === 2) { drag = true; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener('pointerup', e => { if (e.button === 2) { drag = false; } });
  canvas.addEventListener('pointermove', e => { if (drag) { cam.yaw -= e.movementX * .005; cam.pitch = clamp(cam.pitch + e.movementY * .004, .25, 1.45); } });
  const setM = e => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height * 2 - 1); };
  canvas.addEventListener('mousemove', setM);
  canvas.addEventListener('mousedown', e => { if (isTouch) return; setM(e); if (e.button === 0) mouse.down = true; });
  addEventListener('mouseup', () => mouse.down = false);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
function updateMouseWorld() {
  ray.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
  if (ray.ray.intersectPlane(plane, hitV)) { mouse.wx = hitV.x / S + W / 2; mouse.wy = hitV.z / S + H / 2; }
}
function readInput(f) {
  const k = f.ctrl.kind;
  if (k === 'h1') { const keys = Q1.splice(0), tm = TOUCH.mx || TOUCH.my, m = camRel(tm ? TOUCH.mx : (down.KeyD ? 1 : 0) - (down.KeyA ? 1 : 0), tm ? TOUCH.my : (down.KeyS ? 1 : 0) - (down.KeyW ? 1 : 0)); return { mx: m.x, my: m.y, a: !!(down.Space || mouse.down || TOUCH.atk), keys }; }
  if (k === 'h2') { const keys = Q2.splice(0), m = camRel((down.ArrowRight ? 1 : 0) - (down.ArrowLeft ? 1 : 0), (down.ArrowDown ? 1 : 0) - (down.ArrowUp ? 1 : 0)); return { mx: m.x, my: m.y, a: !!down.Enter, keys }; }
  return aiInput(f);
}
function aiInput(f) {
  const e = foe(f), d = dist(f, e), def = f.def, pref = def.id === 'silent' ? 90 : def.id === 'lich' ? 260 : 230, a = ang(f, e), dt = B.dt;
  const inp = { mx: 0, my: 0, a: false, keys: [] };
  f.ai.t -= dt; if (f.ai.t <= 0) { f.ai.t = .6 + Math.random() * .8; f.ai.strafe = Math.random() < .5 ? 1 : -1; }
  if (d > pref) { inp.mx = Math.cos(a); inp.my = Math.sin(a); } else if (d < pref * .6) { inp.mx = -Math.cos(a); inp.my = -Math.sin(a); } else { inp.mx = -Math.sin(a) * f.ai.strafe; inp.my = Math.cos(a) * f.ai.strafe; }
  inp.a = d < def.atkRange;
  for (const k of ['z', 'x', 'c', 'v']) {
    if (f.cd[k] > 0 || Math.random() > dt * .9) continue;
    if (k === 'v' && f.def.id === 'silent' && d > 250) continue;
    if (k === 'v' && f.form !== 'base') continue;
    if (k === 'v' && f.cast) continue;
    if (f.def.id === 'sugar' && (k === 'c' || k === 'v') && f.hp / f.max > .7 && f.shield / f.shieldMax > .6) continue;
    inp.keys.push(k);
  }
  if (f.def.id === 'shadow') { if (f.veil && !f.cast && f.cd.q <= 0 && Math.random() < dt * .6) inp.keys.push('q'); if (f.awake && f.gauge >= 100 && !f.ult.armed && Math.random() < dt * 2) inp.keys.push('r'); }
  if (f.cast && f.cast.type === 'field' && f.cast.t > 6) inp.keys.push('v');
  if (f.cast && f.cast.type === 'paradise' && f.cast.t > 30) inp.keys.push('v');
  return inp;
}
function aimPoint(f) {
  if (f.st.charm > 0 && B.objs.length) { let best = B.objs[0]; for (const o of B.objs) if (dist(f, o) < dist(f, best)) best = o; return best; }
  if (f.ctrl.kind === 'h1') {
    if (isTouch) {   // 터치: 기본은 상대 자동 조준, 스킬 버튼을 드래그해서 뗀 직후에는 그 방향으로 조준
      const t = TOUCH.aim; if (t && performance.now() < TOUCH.until) { const d = camRel(t.dx / t.m, t.dy / t.m), L = 150 + 580 * clamp(t.m / 70, 0, 1); return { x: f.x + d.x * L, y: f.y + d.y * L }; }
      return foe(f);
    }
    return { x: mouse.wx, y: mouse.wy };
  }
  return foe(f);
}
function tryUse(f, k) {
  const s = f.def.skills[f.form][k];
  if (!s || f.cd[k] > 0 || f.script || B.cut) return;
  if (f.st.stun > 0 || f.st.lock > 0) return;
  if (f.cast && !((f.cast.type === 'field' || f.cast.type === 'paradise') && k === 'v')) return;
  if (k !== 'a' && f.st.silence > 0) { toast(f, '침묵 상태!'); return; }
  const r = s.use(f, aimPoint(f));
  if (r !== false && r !== 'nocd') f.cd[k] = s.cd * (f.soul ? 1.5 : 1);
}

/* ================= 업데이트 ================= */
function updFighter(f, dt) {
  if (!(f.st.cdfreeze > 0)) for (const k in f.cd) f.cd[k] = Math.max(0, f.cd[k] - dt);
  for (const k of ['slow', 'silence', 'stun', 'charm', 'inv', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) f.st[k] = Math.max(0, f.st[k] - dt);
  f.flash = Math.max(0, f.flash - dt); f.drT = Math.max(0, f.drT - dt);
  if (f.form !== 'base' && !f.script) { f.formT -= dt; if (f.formT <= 0) { revertForm(f); toast(f, '변신 종료'); } }
  let inp = readInput(f); f.last = { mx: inp.mx, my: inp.my };
  if (f.st.ctl > 0 && f.ctlBy && f.ctlBy.hp > 0) { const s = f.ctlBy.last || { mx: 0, my: 0 }; inp = { mx: s.mx, my: s.my, a: false, keys: [] }; }
  if (f.st.rev > 0) { inp = { ...inp, mx: -inp.mx, my: -inp.my }; }
  const ap = aimPoint(f);
  if (!f.script && f.st.stun <= 0 && f.st.lock <= 0) f.face = ang(f, ap);
  if (f.script) { const s = f.script; s.t += dt; for (const st of s.steps) if (!st.d && s.t >= st.at) { st.d = true; st.fn(); } if (s.t >= s.end) { f.script = null; s.onEnd && s.onEnd(); } }
  const canAct = !f.script && f.st.stun <= 0 && f.st.lock <= 0 && !B.cut;
  if (canAct) { for (const k of inp.keys) tryUse(f, k); if (inp.a && !f.cast) tryUse(f, 'a'); }
  if (f.cast && f.cast.type === 'field') updField(f, dt);
  if (f.cast && f.cast.type === 'sleep') updSleep(f, dt);
  if (f.drain) updDrain(f, dt);
  if (f.cast && f.cast.type === 'sub') updSub(f, dt);
  if (f.cast && f.cast.type === 'control') updControl(f, dt);
  if (f.veil) updVeil(f, dt);
  if (f.cast && f.cast.type === 'paradise') updParadise(f, dt);
  const ox = f.x, oy = f.y;
  if (canAct && !f.cast) {
    const len = Math.hypot(inp.mx, inp.my) || 1, sp = 150 * spdMul(f) * (f.st.slow > 0 ? f.st.slowF : 1), on = inp.mx || inp.my ? 1 : 0;
    f.x += inp.mx / len * sp * dt * on; f.y += inp.my / len * sp * dt * on;
  }
  f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD);
  for (const o of B.objs) { const d = dist(f, o); if (d < f.r + o.r) { const a = ang(o, f); f.x = o.x + Math.cos(a) * (f.r + o.r); f.y = o.y + Math.sin(a) * (f.r + o.r); } }
  const mvd = Math.hypot(f.x - ox, f.y - oy) * S / Math.max(dt, 1e-4); f.vel = lerp(f.vel, mvd, .3);
  // 달리기 먼지
  if (f.vel > 3 && Math.random() < .5) vfx.emit('smoke', { x: f.root.position.x, y: .1, z: f.root.position.z, vy: .8, life: .5, s0: .5, s1: 1.2, c0: 0x8a80c0, a: .35 });
}
// 풀숲: 안에 있는 캐릭터는 상대(AI 대전의 1P 화면)에게 안 보인다. 가까이 있거나 같은 풀숲이거나 방금 맞았으면 보임.
function updBush() {
  const bs = B.bushes || [];
  B.fighters.forEach(f => { f.bush = bs.findIndex(b => dist(f, b) < b.r * .92); });
  const me = B.fighters[0];
  B.fighters.forEach(f => {
    const seen = f === me || B.mode !== 'ai' || f.bush < 0 || f.bush === me.bush || dist(f, me) < 280 || f.flash > 0 || f.cast || f.hp <= 0;
    f.bushHid = !seen;
  });
}
let camFov = 0;
function update(dt) {
  B.dt = dt;
  B.shakeT = Math.max(0, B.shakeT - dt); if (B.shakeT <= 0) B.shake = Math.max(0, B.shake - dt * 3);
  vfx.update(dt, 0);
  B.fighters.forEach(f => animate(f, dt));
  if (B.cut) { updateCut(dt); return; }
  if (B.over) return;
  if (B.intro) return;
  B.time += dt;
  if (B.raid && !B.over) { B.raid.t -= dt; if (B.raid.t <= 0) { B.raid.t = 0; B.over = B.raid.boss; setTimeout(finish, 900); } }
  B.fighters.forEach(f => updFighter(f, dt));
  updBush();
  updProjs(dt); updZones(dt); updLakes(dt); updAngels(dt); updHexes(dt);
  if (B.mind) { B.mind.t -= dt; if (B.mind.t <= 0) endMind(); }
  const dead = B.fighters.find(f => f.hp <= 0);
  if (dead && !B.over) { B.over = foe(dead); if (B.mind) endMind(); ui.vignette(false); setTimeout(finish, 2200); }
}
function finish() {
  if (!B) return;
  if (B.mode === 'raid') { const r = ui.recordRaid(B.raid.dmg); ui.result(B.over === B.fighters[0] ? '보스 처치!' : '레이드 종료', `이번 피해 ${Math.round(B.raid.dmg).toLocaleString()}${r.isBest ? ' (최고 기록!)' : ''} · 최고 ${r.best.toLocaleString()}`); return; }
  const w = B.over, p1win = w === B.fighters[0]; let sub = '';
  if (B.mode === 'ai') { const gain = p1win ? 300 : 100; SAVE.coins += gain; ui.recordMatch(SAVE, B.fighters[0].def.id, p1win); if (p1win) { const id = w.def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; } persist(); sub = '+' + gain + ' 코인'; }
  ui.result(B.mode === 'ai' ? (p1win ? '승리!' : '패배...') : (p1win ? '1P 승리!' : '2P 승리!'), sub);
}

/* ================= 카메라 / 렌더 루프 ================= */
let last = 0, clock = 0;
function updateCamera(dt) {
  if (!B.cut) {
    if (down.BracketLeft) cam.yaw += dt * 1.8; if (down.BracketRight) cam.yaw -= dt * 1.8;
    const g = gameCamPose(), k = 1 - Math.exp(-dt * 5);
    if (!camState.init) { camState.pos.copy(g.pos); camState.look.copy(g.look); camState.init = true; }
    camState.pos.lerp(g.pos, k); camState.look.lerp(g.look, k);
    camState.fov = lerp(camState.fov, g.fov + camFov, k); camFov = lerp(camFov, 0, 1 - Math.exp(-dt * 6));
  }
  world.focus(camState.look);
  camera.position.copy(camState.pos);
  if (B.shake > 0) camera.position.add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(B.shake * .45));
  camera.lookAt(camState.look); camera.fov = camState.fov; camera.updateProjectionMatrix();
}
// 자동 품질 조절: 평균 프레임이 3초 연속 느리면(≈28fps 미만) 그림자·블룸을 끄고 입자를 절반으로 줄인다
let qAvg = .016, qAcc = 0;
function adaptQuality(raw) {
  if (world.quality > 0) return; qAvg = qAvg * .95 + raw * .05; qAcc += raw;
  if (qAcc > 3) { qAcc = 0; if (qAvg > .036) { world.setQuality(1); vfx.density = .5; } }
}
function frame(ts) {
  requestAnimationFrame(frame);
  const raw = Math.min(.05, (ts - last) / 1000 || 0); last = ts; clock += raw; adaptQuality(raw);
  if (!B) { lobbyFrame(raw); return; }
  B.hitstop = Math.max(0, B.hitstop - raw);
  const dt = B.hitstop > 0 ? raw * .06 : raw;
  updateMouseWorld(); update(dt); updateCamera(raw);
  const scale = world.renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  vfx.update(0, scale);
  world.update(raw, clock, B.fighters.some(f => f.st.charm > 0)); updateTouch();
  ui.update(B, camera, world.renderer, raw);
  world.composer.render();
}

/* ================= 로비 (브롤스타즈식 홈 화면) ================= */
// UI(screens.js)가 정한 영역(getView)에만 투명 캔버스로 캐릭터를 그린다.
let lobby = null;
function lobbyHide() { if (lobby) { world.scene.remove(lobby.root); lobby = null; } }
function lobbyBuild(id) {
  lobbyHide();
  const rig = buildCookie(CHARS[id]), root = new THREE.Group(); root.add(rig.root); root.scale.setScalar(1.55); world.scene.add(root);
  lobby = { id, root, rig, t: 0 };
}
function lobbyFrame(dt) {
  const r = world.renderer, v = ui.getView(), id = ui.previewId();
  r.setScissorTest(false); r.setClearColor(0x000000, 0); r.clear();
  if (!v || !id) return;
  if (!lobby || lobby.id !== id) lobbyBuild(id);
  lobby.t += dt; const R = lobby.rig, T = lobby.t;
  lobby.root.rotation.y = -.45 + Math.sin(T * .5) * .35; R.body.position.y = Math.sin(T * 2.2) * .04;
  R.armL.rotation.set(0, 0, .12 + Math.sin(T * 2.2) * .04); R.armR.rotation.set(-.15, 0, -.12); R.head.rotation.set(0, Math.sin(T * .8) * .12, 0); R.head.position.y = R.headY ?? 1.65;
  if (R.extras.sugarWings) { const fl = Math.sin(T * 5) * .22; R.extras.sugarWings[0].rotation.z = fl; R.extras.sugarWings[1].rotation.z = -fl; R.extras.sugarTail.rotation.z = Math.sin(T * 3) * .35; }
  if (R.extras.crystals) R.extras.crystals.forEach((c, i) => { const a = c.userData.a + T * 1.6; c.position.set(Math.cos(a) * .9, 1.0 + Math.sin(T * 2 + i) * .25, Math.sin(a) * .9); });
  const fov = 36; camera.fov = fov; camera.aspect = v.w / v.h; camera.updateProjectionMatrix();
  camera.position.set(0, 1.9, (3.6 / v.f) / (2 * Math.tan(fov * Math.PI / 360))); camera.lookAt(0, 1.9, 0);
  const y = innerHeight - v.y - v.h; r.setViewport(v.x, y, v.w, v.h); r.setScissor(v.x, y, v.w, v.h); r.setScissorTest(true);
  r.render(world.scene, camera); r.setScissorTest(false); r.setViewport(0, 0, innerWidth, innerHeight);
}
function toLobby() {
  world.clearMap(); world.setMind(false); world.setCut(false); world.setParadise(false); world.setLobby(true);
  ui.showGame(false); world.resize(); showTouch(false);
}

/* ================= 시작 / 종료 ================= */
export function startBattle(p1, p2, mode, mapId) {
  cleanup(); lobbyHide(); world.setLobby(false);
  const map = MAPS.find(m => m.id === mapId) || MAPS[Math.floor(Math.random() * MAPS.length)], L = layoutMap(map); W = map.W; H = map.H; mouse.wx = W / 2; mouse.wy = H / 2;
  B = { fighters: [], projs: [], zones: [], lakes: [], angels: [], hexes: [], mind: null, cut: null, over: null, shake: 0, shakeT: 0, hitstop: 0, mode, time: 0, dt: .016,
    objs: L.objs, bushes: L.bushes, map, intro: true };
  B.fighters.push(mkFighter(CHARS[p1], W * .1, H / 2, { kind: 'h1' }), mkFighter(CHARS[p2], W - W * .1, H / 2, mode === 'local' ? { kind: 'h2' } : { kind: 'ai' }));
  if (mode === 'raid') { const boss = B.fighters[1]; boss.max = boss.hp = RAID_BOSS_HP; boss.awake = true; B.raid = { t: RAID_TIME, dmg: 0, boss }; }
  B.fighters[1].face = Math.PI; B.fighters[1].yaw = Math.PI / 2 - Math.PI; B.fighters[0].yaw = Math.PI / 2;
  world.setMap(map, L); world.setMind(false); world.setCut(false);
  camState.init = false; camState.fov = 42; camFov = 0;
  ui.showGame(true); ui.beginBattle(B); world.resize(); showTouch(true, B.fighters[0]);
  const bb = B; ui.intro(B.fighters, () => { if (B === bb) { bb.intro = false; ui.toast('전투 시작!  ·  ' + map.name); } });
}
function cleanup() {
  if (!B) return;
  B.fighters.forEach(f => { if (f.drain) endDrain(f); }); B.fighters.forEach(removeFighter); B.projs.forEach(killProj);
  B.lakes.forEach(removeLake); B.hexes.forEach(removeHex); B.fighters.forEach(f => f.veil && world.scene.remove(f.veil.group)); B.angels.forEach(a => world.scene.remove(a.g)); B.zones.forEach(z => z.mesh && world.scene.remove(z.mesh));
  B.fighters.forEach(f => { if (f.cast && f.cast.group) world.scene.remove(f.cast.group); }); world.setParadise(false);
  if (B.cut) world.scene.remove(B.cut.moon.group);
  [...vfx.items].forEach(i => vfx.drop(i));
  ui.introCancel(); ui.title('', ''); ui.cinema(false); ui.vignette(false); world.setMind(false); world.setCut(false); B = null;
}
let picked = 'silent';
export function init() {
  canvas = document.getElementById('cv'); world = createWorld(canvas); camera = world.camera; vfx = new VFX(world.scene, camera);
  loadManifest(); bindInput();
  initTouch({ press: k => Q1.push(k), toggleCam: () => { if (B) { cam.fit = !cam.fit; ui.toast(cam.fit ? '시점: 둘 다 보기' : '시점: 내 캐릭터 추적'); } } });
  if (isTouch) { world.setQuality(1); vfx.density = .5; }
  ui.initUI({
    CHARS, ORDER, SAVE, persist, picked: () => picked, pick: id => { picked = id; },
    reset: () => { Object.assign(SAVE, { coins: 0, unlocked: ['silent'], awake: [], wins: {}, totalWins: 0, ev: null }); persist(); },
    start: (a, b, m) => startBattle(a, b, m), raid: () => startBattle(picked, 'shadow', 'raid'), back: () => { cleanup(); ui.hideHud(); toLobby(); },
    cheat: () => { SAVE.unlocked = [...ORDER]; SAVE.awake = ['lich', 'shadow']; SAVE.hub = SAVE.hub || {}; SAVE.hub.pass = Object.assign({ xp: 0, f: {}, p: {} }, SAVE.hub.pass, { prem: true }); SAVE.hub.shards = (SAVE.hub.shards || 0) + 500; SAVE.tickets = (SAVE.tickets || 0) + 10; persist(); },
  });
  toLobby();
  requestAnimationFrame(frame);
  window.WB = { get B() { return B; }, hurt, step: dt => update(dt), startBattle, tryUse, CHARS, SAVE, vfx, world, THREE };
}
