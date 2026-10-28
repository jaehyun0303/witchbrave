// 전투 로직 + 스킬 연출 + 컷신. 로직은 2D 좌표(x,y)로 계산하고 3D 월드(x,z)로 매핑한다.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { VFX, ease } from './vfx.js';
import { buildCookie, buildDragon, buildMoon, heartMesh } from './models.js';
import { tex, loadManifest } from './tex.js';
import * as ui from './ui.js';

/* ================= 상수 / 유틸 ================= */
const W = 1100, H = 620, PAD = 30, S = .04;                // 로직 좌표 → 월드 (1px = 0.04)
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
const dmgMul = f => (f.mindBuff ? 1.05 : 1) * (f.form === 'dragon' ? 1.1 : 1);
const defRed = f => f.mindBuff ? .05 : 0;
const spdMul = f => (f.mindBuff ? 1.15 : 1) * (f.form === 'dragon' ? 1.1 : 1);
const toast = (f, t) => { if (f.ctrl.kind !== 'ai') ui.toast(t); };
const shake = (a, t = .3) => { B.shake = Math.max(B.shake, a); B.shakeT = Math.max(B.shakeT, t); };

function hurt(src, t, n, o = {}) {
  if (t.hp <= 0 || t.st.inv > 0) return;
  const d = n * (src ? dmgMul(src) : 1) * (1 - defRed(t));
  t.hp = Math.max(0, t.hp - d); t.flash = .12;
  const big = d >= 800;
  if (!o.quiet) {
    ui.pop(P3(t, 2.6), Math.round(d), src ? src.def.color : '#fff', big);
    hitFX(t, src ? src.def.color : 0xffffff, big, o.dir);
    if (big) { B.hitstop = Math.max(B.hitstop, .07); shake(.35, .25); }
  }
  if (!o.field && t.cast && t.cast.type === 'field') endField(t);
  if (t.hp <= 0) onDeath(t);
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
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: p.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(p.r * S * 9); g.add(glow);
  if (p.kind === 'wave') {   // 침묵의 검기: 직립 초승달
    const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ map: tex('slash'), color: 0xdfe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.scale.set(p.r * S * 11, p.r * S * 8, 1); m.position.y = .2; g.add(m); g.userData.mesh = m;
    const m2 = m.clone(); m2.material = m.material.clone(); m2.material.color.set(p.color); m2.scale.multiplyScalar(1.25); g.add(m2);
  } else if (p.kind === 'heart') {
    const h = heartMesh(new THREE.MeshStandardMaterial({ color: 0xff6adf, emissive: 0xff2ac0, emissiveIntensity: 1.6, roughness: .3 }), .85); g.add(h); g.userData.mesh = h;
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
  B.zones.push(z);
}
function erupt(pos, r, color, h = 16) {                      // 기둥 폭발 이펙트
  const c = pos.clone();
  vfx.column(c, { r: r * 1.0, h, dur: .9, color });
  vfx.column(c, { r: r * .55, h: h * 1.2, dur: .7, color: 0xffffff });
  vfx.ring(c, { r0: .5, r1: r * 1.7, dur: .55, color, alpha: 1 });
  vfx.ring(c, { r0: .3, r1: r * 2.4, dur: .8, color: 0xffffff, alpha: .6 });
  vfx.decal(c, { tex: 'crack', r: r * 1.3, color, dur: 1.4, alpha: .9, y: .04 });
  vfx.flash(c.clone().setY(1), { size: r * 4, color, dur: .35, grow: true });
  for (let i = 0; i < 70; i++) { // 나선 상승 입자
    const a = rnd(0, 6.283), d = rnd(0, r);
    vfx.emit('glow', { x: c.x + Math.cos(a) * d, y: .2, z: c.z + Math.sin(a) * d, vx: -Math.sin(a) * rnd(2, 5), vy: rnd(8, 22), vz: Math.cos(a) * rnd(2, 5), life: rnd(.5, 1.1), s0: rnd(.4, .9), s1: 0, c0: 0xffffff, c1: color, drag: .6 });
  }
  vfx.burst('spark', c.clone().setY(.4), 40, { speed: 6, speed2: 16, life: .6, life2: 1.2, size: .45, c0: 0xffffff, c1: color, grav: 8, flat: false });
  shake(.55, .35);
}
function updZones(dt) {
  for (const z of B.zones) {
    z.t += dt;
    const u = Math.min(1, z.t / z.delay);
    if (!z.done) { // 예고선: 점점 선명해지고 안쪽에서 입자 모임
      z.tele.obj.material.opacity = .25 + u * .7; z.tele2.obj.scale.setScalar(z.r * S * 2.1 * (1.15 - u * .15));
      if (Math.random() < .8) { const a = rnd(0, 6.283), c = P3(z); vfx.emit('glow', { x: c.x + Math.cos(a) * z.r * S, y: .1, z: c.z + Math.sin(a) * z.r * S, vx: -Math.cos(a) * 3, vy: rnd(1, 4), vz: -Math.sin(a) * 3, life: .35, s0: .45, s1: 0, c0: z.color, drag: 0 }); }
    }
    if (!z.done && z.t >= z.delay) {
      z.done = true; vfx.remove(z.tele); vfx.remove(z.tele2);
      erupt(P3(z), z.r * S, z.color);
      for (const t of B.fighters) if (t !== z.owner && Math.hypot(t.x - z.x, t.y - z.y) < z.r + t.r) { hurt(z.owner, t, z.dmg); z.onHit && z.onHit(t); }
    }
  }
  B.zones = B.zones.filter(z => z.t < z.delay + .3);
}

/* ================= 침묵의 심판 (필드) ================= */
function startField(f) {
  const c = f.cast = { type: 'field', x: f.x, y: f.y, r: 230, t: 0, acc: 0 };
  const p = P3(f), R = c.r * S, col = 0xb8c8ff;
  c.dome = vfx.dome(p, R, col);
  c.rune = vfx.decal(p, { tex: 'rune', r: R * 1.02, color: col, alpha: .85, spin: .25 });
  c.rune2 = vfx.decal(p, { tex: 'rune', r: R * .62, color: 0xffffff, alpha: .5, spin: -.5, y: .06 });
  c.ring = vfx.decal(p, { tex: 'ring', r: R * 1.0, color: 0xffffff, alpha: .9, y: .07 });
  c.col = vfx.column(p, { r: 1.1, h: 40, dur: 0, color: col }); c.col.dur = 0; c.col.fn = (u, ob, dt) => { ob.rotation.y += dt * 2; ob.scale.set(1.1 + Math.sin(B.time * 4) * .1, 40, 1.1); ob.material.opacity = .45; };
  vfx.ring(p, { r0: 1, r1: R * 1.5, dur: .8, color: col }); vfx.ring(p, { r0: 1, r1: R * 1.1, dur: 1.1, color: 0xffffff, alpha: .6 });
  vfx.burst('glow', P3(f, .5), 60, { speed: 4, speed2: 14, life: .8, life2: 1.6, size: 1, c0: 0xffffff, c1: col, flat: true, drag: 1.2 });
  shake(.7, .5); B.hitstop = .1; ui.flash('#cfd8ff', .5, .3); ui.vignette(true);
  f.pose = 'stab';
}
function endField(f) {
  if (!f.cast || f.cast.type !== 'field') return;
  const c = f.cast, s = f.def.skills[f.form].v; f.cast = null; f.cd.v = s.cd; f.pose = null;
  c.dome.closing = true; ['rune', 'rune2', 'ring', 'col'].forEach(k => vfx.remove(c[k]));
  const p = P3(c); vfx.ring(p, { r0: c.r * S, r1: c.r * S * 1.3, dur: .6, color: 0xcfd8ff }); vfx.burst('glow', p.clone().setY(1), 50, { speed: 3, speed2: 12, life: 1, size: .9, c0: 0xcfd8ff, flat: true });
  ui.vignette(false);
}
function updField(f, dt) {
  const c = f.cast; c.t += dt; c.acc += dt;
  const R = c.r * S, p = P3(c);
  // 침묵의 눈송이 (천천히 하강)
  for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R; vfx.emit('glow', { x: p.x + Math.cos(a) * d, y: rnd(8, 14), z: p.z + Math.sin(a) * d, vx: 0, vy: -rnd(2, 4), vz: 0, life: 3.2, s0: rnd(.15, .35), s1: .1, c0: 0xe8eeff, c1: 0x8fa4ff, a: .8, drag: 0 }); }
  if (Math.random() < .5) { const a = rnd(0, 6.283); vfx.emit('spark', { x: p.x + Math.cos(a) * R, y: .2, z: p.z + Math.sin(a) * R, vy: rnd(3, 8), life: 1, s0: .6, s1: 0, c0: 0xcfd8ff, drag: 0 }); }
  for (const o of B.fighters) {
    if (o === f || o.hp <= 0) continue;
    if (Math.hypot(o.x - c.x, o.y - c.y) < c.r + o.r) {           // 영역 안: 이동·스킬 불가, 초당 500
      o.st.lock = .15; hurt(f, o, 500 * dt, { field: true, quiet: true });
      o.fieldAcc = (o.fieldAcc || 0) + 500 * dt * dmgMul(f);
      if (o.fieldAcc >= 500) { o.fieldAcc -= 500; ui.pop(P3(o, 2.6), '500', '#cfd8ff'); hitFX(o, 0xcfd8ff, false); }
      if (Math.random() < .5) vfx.emit('spark', { x: o.root.position.x + rnd(-.6, .6), y: 1 + rnd(0, 1.6), z: o.root.position.z + rnd(-.6, .6), vy: 2, life: .5, s0: .4, s1: 0, c0: 0xcfd8ff });
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
  f.x = 300; f.y = H / 2; e.x = 800; e.y = H / 2; f.mindBuff = true; world.setMind(true); shake(.8, .6);
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
  id: 'silent', name: '사일런트솔트 쿠키', color: 0xcfd8ff, cost: 0, hp: 30000, pref: 3.6, atkRange: 100, tag: '침묵 · 근접 검사',
  skills: {
    base: {
      a: { name: '검 베기', cd: .45, desc: '검으로 벤다. 데미지 100', use(f) { setAnim(f, 'slash', .26); swing(f, 95, .9, 100, 0xcfd8ff); } },
      z: { name: '침묵의 기운', cd: 5, desc: '지정한 곳에서 침묵의 기운이 솟구침. 데미지 1000 + 슬로우', use(f, p) { setAnim(f, 'cast', .5); const q = clampRange(f, p, 650); zone(f, { x: q.x, y: q.y, r: 95, delay: .6, dmg: 1000, color: 0xb8c8ff, onHit: t => slowOn(t, 3, .5) }); } },
      x: { name: '침묵의 검기', cd: 7, desc: '침묵의 검기를 발사. 데미지 1500, 적중 시 2초간 스킬 사용 불가', use(f) { setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 760, r: 20, dmg: 1500, color: 0x9fb8ff, kind: 'wave', life: 1.4, onHit: t => { silenceOn(t, 2); ui.pop(P3(t, 3.2), '🔇 침묵', '#cfd8ff'); vfx.ring(P3(t), { r1: 3, color: 0xcfd8ff }); } }); } },
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
      a: { name: '자줏빛 하트', cd: .5, desc: '자줏빛 하트를 발사. 데미지 120', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 560, r: 11, dmg: 120, color: 0xff7ae0, kind: 'heart' }); } },
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
      a: { name: '용의 숨결', cd: .5, desc: '(임시) 3갈래 불꽃. 각 160', use(f) { setAnim(f, 'breath', .35); for (const d of [-.2, 0, .2]) shoot(f, { a: f.face + d, sp: 620, r: 14, dmg: 160, color: 0xb05aff, kind: 'fire', life: .7 }); } },
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
        a: { name: '기본 공격', cd: .5, desc: '(임시) 투사체 110', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 560, r: 10, dmg: 110, color }); } },
        z: { name: '임시 Z', cd: 6, desc: '(임시) 지정 위치 폭발 1100', use(f, p) { setAnim(f, 'cast', .4); const q = clampRange(f, p, 600); zone(f, { x: q.x, y: q.y, r: 100, delay: .5, dmg: 1100, color }); } },
        x: { name: '임시 X', cd: 8, desc: '(임시) 관통 투사체 1400', use(f) { setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 700, r: 18, dmg: 1400, pierce: true, color, kind: 'wave' }); } },
        c: { name: '임시 C', cd: 30, desc: '(임시) 광역 2500', use(f) { setAnim(f, 'cast', .5); shock(f, 330, color, 2500); shake(.5, .3); } },
        v: { name: '임시 V', cd: 25, desc: '(임시) 회복 2000', use(f) { f.hp = Math.min(f.max, f.hp + 2000); ui.pop(P3(f, 3), '+2000', '#7dff9b'); vfx.burst('glow', P3(f, 1), 30, { speed: 2, speed2: 6, life: 1, size: .8, c0: 0x7dff9b, up: 3 }); } },
      }
    }
  };
}
CHARS.shadow = placeholder('shadow', '쉐도우밀크 쿠키', 0x7a5cff, 600, 26000, '그림자');
CHARS.sugar = placeholder('sugar', '이터널슈가 쿠키', 0xffb3d9, 800, 27000, '영원');
CHARS.dark = placeholder('dark', '어둠마녀 쿠키', 0x8a2be2, 600, 25000, '어둠 마법');
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
    cd: { a: 0, z: 0, x: 0, c: 0, v: 0 }, st: { slow: 0, slowF: 1, silence: 0, stun: 0, charm: 0, inv: 0, lock: 0 },
    cast: null, script: null, awake: ctrl.kind === 'ai' || SAVE.awake.includes(def.id), ctrl, ai: { t: 0, strafe: 1 }, flash: 0, mindBuff: false,
    anim: null, pose: null, at: Math.random() * 10, yaw: 0, vel: 0, cutGlow: 0, dragonPop: 1,
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
  const T = f.at, dead = f.hp <= 0, dragon = f.form === 'dragon';
  // 위치/방향
  const tp = W3(f.x, f.y, 0);
  if (!B.cut || f !== B.cut.f) f.root.position.set(tp.x, f.root.position.y * (f.lift ? 1 : 0) + (f.pose === 'float' ? 1.2 + Math.sin(T * 4) * .15 : 0), tp.z);
  const want = Math.PI / 2 - f.face; let d = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw)); f.yaw += d * Math.min(1, dt * 16);
  f.root.rotation.y = f.yaw;
  // 모델 전환
  f.rig.root.visible = !dragon; if (f.drg) f.drg.root.visible = dragon;
  if (dragon) { f.dragonPop = Math.min(1, f.dragonPop + dt * 2.5); const s = ease.out(f.dragonPop); f.drg.root.scale.setScalar(Math.max(.01, s * (1 + Math.sin(f.dragonPop * 9) * .06 * (1 - f.dragonPop)))); }
  f.blob.scale.setScalar(dragon ? 2 : 1);
  // 피격 플래시 / 상태 색
  const fl = f.flash > 0;
  for (const m of f.mats) { if (fl) { m.emissive.setScalar(.9); m.emissiveIntensity = 1; } else { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; } }
  // 애니메이션 진행
  let ap = 0, an = null; if (f.anim) { f.anim.t += dt; ap = Math.min(1, f.anim.t / f.anim.d); an = f.anim.n; if (ap >= 1) f.anim = null; }
  const mv = f.vel, run = Math.min(1, mv / 3);
  if (dragon) return animDragon(f, dt, T, an, ap, run, dead);
  const R = f.rig, bob = Math.sin(T * 3) * .03;
  R.body.position.y = bob + Math.abs(Math.sin(T * 12)) * .06 * run; R.body.rotation.set(run * .12, 0, 0);
  R.legL.rotation.x = Math.sin(T * 12) * .8 * run; R.legR.rotation.x = -Math.sin(T * 12) * .8 * run;
  R.armL.rotation.set(-Math.sin(T * 12) * .7 * run, 0, .12 + Math.sin(T * 3) * .04); R.armR.rotation.set(Math.sin(T * 12) * .5 * run - .15, 0, -.12);
  R.head.rotation.set(0, 0, 0); R.head.position.y = 1.65; R.torso.rotation.set(0, 0, 0);
  if (R.weapon) R.weapon.rotation.x = -1.0;
  const ex = R.extras;
  if (ex.crystals) ex.crystals.forEach((c, i) => { const a = c.userData.a + T * 1.6; c.position.set(Math.cos(a) * .9, 1.0 + Math.sin(T * 2 + i) * .25, Math.sin(a) * .9); c.rotation.y += dt * 3; });
  if (ex.halo) ex.halo.rotation.z += dt;
  if (ex['wing-1']) { const fl2 = Math.sin(T * 6) * .25; ex['wing-1'].rotation.z = -1.0 - fl2; ex['wing1'].rotation.z = 1.0 + fl2; }
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
  else if (f.pose === 'float') { R.armR.rotation.set(-2.2, 0, -.9); R.armL.rotation.set(-2.2, 0, .9); R.body.rotation.x = -.1; R.legL.rotation.x = .2; R.legR.rotation.x = -.2; }
  if (f.pose !== 'leap') f.root.rotation.x = 0;
  if (f.st.stun > 0) { R.head.rotation.z = Math.sin(T * 14) * .25; if (Math.random() < .3) vfx.emit('spark', { x: f.root.position.x + Math.cos(T * 8) * .6, y: 3, z: f.root.position.z + Math.sin(T * 8) * .6, life: .4, s0: .35, s1: 0, c0: 0xffe066 }); }
  if (f.st.charm > 0 && Math.random() < .35) vfx.emit('heart', { x: f.root.position.x + rnd(-.8, .8), y: 2.2, z: f.root.position.z + rnd(-.8, .8), vy: 2, life: 1, s0: .5, s1: 0, c0: 0xff7ae0, c1: 0xff2ac0 });
  if (f.st.slow > 0 && Math.random() < .3) vfx.emit('glow', { x: f.root.position.x + rnd(-.6, .6), y: .2, z: f.root.position.z + rnd(-.6, .6), vy: 1.2, life: .8, s0: .5, s1: 0, c0: 0x8fa4ff, a: .7 });
  if (f.st.silence > 0 && Math.random() < .3) vfx.emit('spark', { x: f.root.position.x + rnd(-.6, .6), y: 2.6, z: f.root.position.z + rnd(-.6, .6), vy: 1, life: .6, s0: .3, s1: 0, c0: 0xcfd8ff });
  if (f.st.inv > 0) R.root.visible = Math.floor(T * 40) % 2 === 0 || !!f.script;
  if (dead) { f.deadT = (f.deadT || 0) + dt; const u = Math.min(1, f.deadT * 1.6); f.root.rotation.z = u * Math.PI / 2; f.root.position.y = -u * .35; R.body.rotation.x = 0; R.root.visible = true; }
  if (!f.mindBuff) { /* noop */ } else if (Math.random() < .25) vfx.emit('glow', { x: f.root.position.x + rnd(-.7, .7), y: .1, z: f.root.position.z + rnd(-.7, .7), vy: 2.5, life: .8, s0: .5, s1: 0, c0: 0xff7ae0, a: .7 });
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
const K1 = { KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v' }, K2 = { Digit7: 'z', Digit8: 'x', Digit9: 'c', Digit0: 'v' };
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
  canvas.addEventListener('mousedown', e => { setM(e); if (e.button === 0) mouse.down = true; });
  addEventListener('mouseup', () => mouse.down = false);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
function updateMouseWorld() {
  ray.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
  if (ray.ray.intersectPlane(plane, hitV)) { mouse.wx = hitV.x / S + W / 2; mouse.wy = hitV.z / S + H / 2; }
}
function readInput(f) {
  const k = f.ctrl.kind;
  if (k === 'h1') { const keys = Q1.splice(0), m = camRel((down.KeyD ? 1 : 0) - (down.KeyA ? 1 : 0), (down.KeyS ? 1 : 0) - (down.KeyW ? 1 : 0)); return { mx: m.x, my: m.y, a: !!(down.Space || mouse.down), keys }; }
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
    if (k === 'v' && f.form === 'dragon') continue;
    inp.keys.push(k);
  }
  if (f.cast && f.cast.type === 'field' && f.cast.t > 6) inp.keys.push('v');
  return inp;
}
function aimPoint(f) {
  if (f.st.charm > 0 && B.objs.length) { let best = B.objs[0]; for (const o of B.objs) if (dist(f, o) < dist(f, best)) best = o; return best; }
  if (f.ctrl.kind === 'h1') return { x: mouse.wx, y: mouse.wy };
  return foe(f);
}
function tryUse(f, k) {
  const s = f.def.skills[f.form][k];
  if (!s || f.cd[k] > 0 || f.script || B.cut) return;
  if (f.st.stun > 0 || f.st.lock > 0) return;
  if (f.cast && !(f.cast.type === 'field' && k === 'v')) return;
  if (k !== 'a' && f.st.silence > 0) { toast(f, '침묵 상태!'); return; }
  const r = s.use(f, aimPoint(f));
  if (r !== false && r !== 'nocd') f.cd[k] = s.cd;
}

/* ================= 업데이트 ================= */
function updFighter(f, dt) {
  for (const k in f.cd) f.cd[k] = Math.max(0, f.cd[k] - dt);
  for (const k of ['slow', 'silence', 'stun', 'charm', 'inv', 'lock']) f.st[k] = Math.max(0, f.st[k] - dt);
  f.flash = Math.max(0, f.flash - dt);
  if (f.form === 'dragon' && !f.script) { f.formT -= dt; if (f.formT <= 0) { revertForm(f); toast(f, '변신 종료'); } }
  const inp = readInput(f), ap = aimPoint(f);
  if (!f.script && f.st.stun <= 0 && f.st.lock <= 0) f.face = ang(f, ap);
  if (f.script) { const s = f.script; s.t += dt; for (const st of s.steps) if (!st.d && s.t >= st.at) { st.d = true; st.fn(); } if (s.t >= s.end) { f.script = null; s.onEnd && s.onEnd(); } }
  const canAct = !f.script && f.st.stun <= 0 && f.st.lock <= 0 && !B.cut;
  if (canAct) { for (const k of inp.keys) tryUse(f, k); if (inp.a && !f.cast) tryUse(f, 'a'); }
  if (f.cast && f.cast.type === 'field') updField(f, dt);
  const ox = f.x, oy = f.y;
  if (canAct && !f.cast) {
    const len = Math.hypot(inp.mx, inp.my) || 1, sp = 235 * spdMul(f) * (f.st.slow > 0 ? f.st.slowF : 1), on = inp.mx || inp.my ? 1 : 0;
    f.x += inp.mx / len * sp * dt * on; f.y += inp.my / len * sp * dt * on;
  }
  f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD);
  for (const o of B.objs) { const d = dist(f, o); if (d < f.r + o.r) { const a = ang(o, f); f.x = o.x + Math.cos(a) * (f.r + o.r); f.y = o.y + Math.sin(a) * (f.r + o.r); } }
  const mvd = Math.hypot(f.x - ox, f.y - oy) * S / Math.max(dt, 1e-4); f.vel = lerp(f.vel, mvd, .3);
  // 달리기 먼지
  if (f.vel > 3 && Math.random() < .5) vfx.emit('smoke', { x: f.root.position.x, y: .1, z: f.root.position.z, vy: .8, life: .5, s0: .5, s1: 1.2, c0: 0x8a80c0, a: .35 });
}
let camFov = 0;
function update(dt) {
  B.dt = dt;
  B.shakeT = Math.max(0, B.shakeT - dt); if (B.shakeT <= 0) B.shake = Math.max(0, B.shake - dt * 3);
  vfx.update(dt, 0);
  B.fighters.forEach(f => animate(f, dt));
  if (B.cut) { updateCut(dt); return; }
  if (B.over) return;
  B.time += dt;
  B.fighters.forEach(f => updFighter(f, dt));
  updProjs(dt); updZones(dt);
  if (B.mind) { B.mind.t -= dt; if (B.mind.t <= 0) endMind(); }
  const dead = B.fighters.find(f => f.hp <= 0);
  if (dead && !B.over) { B.over = foe(dead); if (B.mind) endMind(); ui.vignette(false); setTimeout(finish, 2200); }
}
function finish() {
  if (!B) return;
  const w = B.over, p1win = w === B.fighters[0]; let sub = '';
  if (B.mode === 'ai') { const gain = p1win ? 300 : 100; SAVE.coins += gain; if (p1win) { const id = w.def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; } persist(); sub = '+' + gain + ' 코인'; }
  ui.result(B.mode === 'ai' ? (p1win ? '승리!' : '패배...') : (p1win ? '1P 승리!' : '2P 승리!'), sub);
}

/* ================= 카메라 / 렌더 루프 ================= */
let last = 0, clock = 0;
function updateCamera(dt) {
  if (!B.cut) {
    if (down.KeyQ) cam.yaw += dt * 1.8; if (down.KeyE) cam.yaw -= dt * 1.8;
    const g = gameCamPose(), k = 1 - Math.exp(-dt * 5);
    if (!camState.init) { camState.pos.copy(g.pos); camState.look.copy(g.look); camState.init = true; }
    camState.pos.lerp(g.pos, k); camState.look.lerp(g.look, k);
    camState.fov = lerp(camState.fov, g.fov + camFov, k); camFov = lerp(camFov, 0, 1 - Math.exp(-dt * 6));
  }
  camera.position.copy(camState.pos);
  if (B.shake > 0) camera.position.add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(B.shake * .45));
  camera.lookAt(camState.look); camera.fov = camState.fov; camera.updateProjectionMatrix();
}
function frame(ts) {
  requestAnimationFrame(frame);
  const raw = Math.min(.05, (ts - last) / 1000 || 0); last = ts; clock += raw;
  if (!B) { world.composer.render(); return; }
  B.hitstop = Math.max(0, B.hitstop - raw);
  const dt = B.hitstop > 0 ? raw * .06 : raw;
  updateMouseWorld(); update(dt); updateCamera(raw);
  const scale = world.renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  vfx.update(0, scale);
  world.update(raw, clock, B.fighters.some(f => f.st.charm > 0));
  ui.update(B, camera, world.renderer, raw);
  world.composer.render();
}

/* ================= 시작 / 종료 ================= */
export function startBattle(p1, p2, mode) {
  cleanup();
  B = { fighters: [], projs: [], zones: [], mind: null, cut: null, over: null, shake: 0, shakeT: 0, hitstop: 0, mode, time: 0, dt: .016,
    objs: [{ x: W / 2, y: 150, r: 28 }, { x: W / 2, y: H - 150, r: 28 }, { x: W / 2, y: H / 2, r: 24 }] };
  B.fighters.push(mkFighter(CHARS[p1], 220, H / 2, { kind: 'h1' }), mkFighter(CHARS[p2], W - 220, H / 2, mode === 'local' ? { kind: 'h2' } : { kind: 'ai' }));
  B.fighters[1].face = Math.PI; B.fighters[1].yaw = Math.PI / 2 - Math.PI; B.fighters[0].yaw = Math.PI / 2;
  world.setObstacles(B.objs, S, W, H); world.setMind(false); world.setCut(false);
  camState.init = false; camState.fov = 42; camFov = 0;
  ui.showGame(true); ui.beginBattle(B); world.resize();
}
function cleanup() {
  if (!B) return;
  B.fighters.forEach(removeFighter); B.projs.forEach(killProj);
  if (B.cut) world.scene.remove(B.cut.moon.group);
  [...vfx.items].forEach(i => vfx.drop(i));
  ui.title('', ''); ui.cinema(false); ui.vignette(false); world.setMind(false); world.setCut(false); B = null;
}
let picked = 'silent';
export function init() {
  canvas = document.getElementById('cv'); world = createWorld(canvas); camera = world.camera; vfx = new VFX(world.scene, camera);
  loadManifest(); bindInput();
  ui.initUI({
    CHARS, ORDER, SAVE, persist, picked: () => picked, pick: id => picked = id,
    start: (a, b, m) => startBattle(a, b, m), back: () => { cleanup(); ui.hideHud(); ui.showGame(false); ui.buildMenu(); },
    cheat: () => { SAVE.unlocked = [...ORDER]; SAVE.awake = ['lich']; persist(); },
  });
  requestAnimationFrame(frame);
  window.WB = { get B() { return B; }, startBattle, tryUse, CHARS, SAVE, vfx, world, THREE };
}
