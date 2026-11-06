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
let CUR = 0;   // 지금 처리 중인 세계 (0 = 본 맵, 1 = 봉인수 내부)
const W3r = (x, y, h = 0) => new THREE.Vector3((x - W / 2) * S, h, (y - H / 2) * S);
const W3 = (x, y, h = 0) => { const v = W3r(x, y, h); if (CUR) v.x += RDX; return v; };
const RDX = 500;   // 봉인수 내부 맵의 월드 x 오프셋
const P3 = (o, h = 0) => { const v = W3r(o.x, o.y, h); if (o.realm !== undefined ? o.realm : CUR) v.x += RDX; return v; };
const realmOf = o => o.realm || 0;

let SAVE = { coins: 0, unlocked: ['silent'], awake: [], wins: {} };
try { const s = JSON.parse(localStorage.getItem('wb3d_save')); if (s && s.unlocked) SAVE = Object.assign(SAVE, s); } catch (e) {}
SAVE.mat = SAVE.mat || 0; SAVE.awakeOn = SAVE.awakeOn || {};   // 각성 재료 / 캐릭터별 각성 형태 사용 여부
const persist = () => { try { localStorage.setItem('wb3d_save', JSON.stringify(SAVE)); } catch (e) {} };
const AWAKE_COST = 10;   // 캐릭터 한 명을 각성시키는 데 필요한 각성 재료
const formOf = id => { const d = CHARS[id]; return d && d.awakeId && SAVE.awake.includes(id) && SAVE.awakeOn[id] ? d.awakeId : id; };

let B = null, world, vfx, camera, canvas;
const foe = f => { let best = null, bd = 1e18; for (const o of B.fighters) { if (o === f || o.hp <= 0 || o.nofoe || ally(o, f) || realmOf(o) !== realmOf(f)) continue; const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2; if (d < bd) { bd = d; best = o; } } return best || B.fighters.find(o => o !== f && realmOf(o) === realmOf(f)) || B.ghost; };

/* ================= 데미지 / 상태 ================= */
const dmgMul = f => (f.pm || 1) * (f.st.lightBuff > 0 ? 1.25 : 1) * (f.mindBuff ? 1.05 : 1) * (f.form === 'dragon' ? 1.1 : 1) * (f.soul ? .25 : 1) * (f.form === 'hour' ? 1.3 : 1) * (f.sealSoul ? .5 : 1);
const defRed = f => (f.mindBuff ? .05 : 0) + (f.giant > 0 ? .35 : 0);
const spdMul = f => (f.spdBoost || 1) * (f.mindBuff ? 1.15 : 1) * (f.form === 'dragon' ? 1.1 : 1);
const toast = (f, t) => { if (f.ctrl.kind !== 'ai') ui.toast(t); };
const shake = (a, t = .3) => { B.shake = Math.max(B.shake, a); B.shakeT = Math.max(B.shakeT, t); };

function hurt(src, t, n, o = {}) {
  if (t.hp <= 0 || t.st.inv > 0 || t.undy > 0) return;
  if (src && src !== t && ally(src, t)) return;
  if (src && src !== t && realmOf(src) !== realmOf(t)) return;
  if (src && src !== t && !o.refl && B.barriers.length) {   // 각성 퓨어바닐라의 반사막: 막는 대신 그대로 되돌려 보낸다
    const rb = B.barriers.find(b => b.refl && b.owner !== src && !ally(b.owner, src) && (b.owner === t || ally(b.owner, t)) && Math.hypot(t.x - b.x, t.y - b.y) < b.r);
    if (rb) { if (!o.quiet) ui.pop(P3(t, 2.6), '↩ 반사!', '#fff3b0'); hurt(t, src, n, { refl: true, quiet: o.quiet, field: o.field }); return; }
  }
  if (src && src !== t && B.barriers.length && inBarrier(src, t)) { if (!o.quiet) ui.pop(P3(t, 2.6), '막힘!', '#fff3b0'); return; }
  let d = n * (src ? dmgMul(src) : 1) * (1 - defRed(t));
  if (t.drT > 0) d *= 1 - t.drV;
  const dk = src && src !== t && src.def.id === 'dark' && !src.sealSoul;   // 어둠마녀 패시브: 보호막 흡수 20% (적중마다, 지속 피해 제외) + 피해 10% 관통
  if (dk && t.shield > 0 && !o.field) { const ab = t.shield * .2; t.shield -= ab; src.shield += ab; src.shieldMax = Math.max(src.shieldMax, src.shield); if (ab >= 1) ui.pop(P3(src, 3.2), '🛡 +' + Math.round(ab), '#ff8a98'); }
  const pierce = dk ? d * .1 : 0; if (dk) d -= pierce;
  let hpD = d; if (t.shield > 0) { const ab = Math.min(t.shield, d); t.shield -= ab; hpD = d - ab; }
  t.hp = Math.max(0, t.hp - hpD - pierce); t.flash = .12; d += pierce; t.cmb = B.time; if (src && src !== t) src.cmb = B.time;
  if (B.raid && t === B.raid.boss && src === B.fighters[0]) B.raid.dmg += d;
  if (src && src !== t && !o.refl15 && !o.refl) {   // 빛의 아공간: 안에서 공격한 적은 준 피해의 15%를 되돌려 받는다
    const lp = B.fighters.find(p => p.ldom && p.hp > 0 && p !== src && !ally(p, src) && realmOf(p) === realmOf(src) && Math.hypot(src.x - p.ldom.x, src.y - p.ldom.y) < p.ldom.r);
    if (lp && d > 0) hurt(lp, src, d * .15, { refl15: true, quiet: o.quiet, field: true });
  }
  if (src && src !== t && src.def.ult && !src.hidden) src.gauge = Math.min(100, src.gauge + n / (src.def.ult.need / 100));
  const big = d >= 800;
  if (!o.quiet) {
    ui.pop(P3(t, 2.6), Math.round(d), src ? src.def.color : '#fff', big);
    hitFX(t, src ? (src.def.fx ?? src.def.color) : 0xffffff, big, o.dir);
    if (big) { B.hitstop = Math.max(B.hitstop, .07); shake(.35, .25); }
  }
  if (!o.field && t.cast && t.cast.type === 'field') endField(t);
  if (t.hp <= 0) {
    if (src && src !== t && src.undy > 0) undyKill(src);   // 버닝스파이스 패시브: 불사 중 처치하면 체력 1000 회복
    if (t.ult && t.ult.armed && !t.soul) enterSoul(t); else if (t.def.id === 'burn' && !t.undyUsed && !t.minion) startUndy(t); else onDeath(t);
  }
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
  if (p.kind === 'flower') {   // 세인트릴리의 꽃: 꽃잎 6장이 돌며 날아간다
    const fl = new THREE.Group(), pm = new THREE.MeshStandardMaterial({ color: 0xfff0fa, emissive: 0xff8ad0, emissiveIntensity: .7, roughness: .4 });
    for (let i = 0; i < 6; i++) { const pt = new THREE.Mesh(new THREE.SphereGeometry(.5, 8, 6), pm); const a = i / 6 * 6.283; pt.position.set(Math.cos(a) * .6, Math.sin(a) * .6, 0); pt.scale.set(.7, 1.2, .25); pt.rotation.z = a - Math.PI / 2; fl.add(pt); }
    fl.add(new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 })));
    fl.scale.setScalar(p.r * S * 3.2); g.add(fl); g.userData.mesh = fl; glow.scale.setScalar(p.r * S * 11);
  }
  if (p.kind === 'axe') {   // 버닝스파이스의 도끼: 불타며 회전
    const ax = new THREE.Group(), hm = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: .6 }), bm = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff5a10, emissiveIntensity: 1.4, metalness: .5, roughness: .3 });
    ax.add(new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 2.8, 8), hm));
    const hd = new THREE.Mesh(new THREE.BoxGeometry(.28, 1.3, 1.7), bm); hd.position.set(0, 1.0, .7); ax.add(hd);
    const ed = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.7, .4), bm); ed.position.set(0, 1.0, 1.65); ax.add(ed);
    ax.scale.setScalar(1.1); g.add(ax); g.userData.mesh = ax; glow.scale.setScalar(p.r * S * 14);
  }
  g.position.copy(P3(p, 1.2)); g.rotation.y = Math.atan2(p.vx, p.vy); world.scene.add(g);
  return g;
}
function shoot(f, o) {
  const p = Object.assign({ x: f.x, y: f.y, r: 8, life: 1.6, owner: f, realm: f.realm, hit: new Set(), color: 0xffffff }, o, { vx: Math.cos(o.a) * o.sp, vy: Math.sin(o.a) * o.sp }); if (f.form === 'hour') p.r *= 1.3;
  p.vis = projVisual(p); B.projs.push(p);
  vfx.burst('spark', P3(f, 1.2).add(new THREE.Vector3(Math.cos(o.a), 0, Math.sin(o.a)).multiplyScalar(1)), 8, { speed: 3, life: .25, size: .3, c0: p.color });
}
function killProj(p) { p.life = 0; if (p.vis) { world.scene.remove(p.vis); p.vis.traverse(o => { if (o.material) o.material.dispose(); }); p.vis = null; } }
function updProjs(dt) {
  for (const p of B.projs) {
    if (p.homing) { const t = foe(p.owner); if (t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < p.homing) { const want = Math.atan2(t.y - p.y, t.x - p.x), cur = Math.atan2(p.vy, p.vx), d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), na = cur + clamp(d, -p.turn * dt, p.turn * dt), sp = Math.hypot(p.vx, p.vy); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; } }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.life = 0;
    const wp = P3(p, 1.2);
    if (p.vis) {
      p.vis.position.copy(wp);
      if (p.kind === 'heart') { p.vis.userData.mesh.rotation.y += dt * 8; p.vis.userData.mesh.rotation.z = Math.sin(B.time * 14) * .3; }
      if (p.kind === 'axe') p.vis.userData.mesh.rotation.x += dt * 20;
      if (p.kind === 'flower') p.vis.userData.mesh.rotation.z += dt * 9;
      if (p.kind === 'wave') p.vis.userData.mesh.material.opacity = .9 + Math.sin(B.time * 30) * .1;
    }
    // 궤적 파티클
    const tr = p.kind === 'wave' ? 3 : p.kind === 'beam' ? 4 : 2;
    for (let i = 0; i < tr; i++) {
      const sp = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(p.kind === 'wave' ? 1.6 : .6);
      vfx.emit(p.kind === 'heart' ? 'heart' : p.kind === 'fire' ? 'smoke' : 'glow', { x: wp.x + sp.x * .3, y: wp.y + sp.y * .4, z: wp.z + sp.z * .3, vx: sp.x - p.vx * S * .08, vy: sp.y * .6, vz: sp.z - p.vy * S * .08, life: p.kind === 'fire' ? .7 : .45, s0: p.kind === 'heart' ? .3 : p.kind === 'fire' ? .9 : .6, s1: 0, c0: p.kind === 'fire' ? 0xffa050 : p.color, c1: p.kind === 'fire' ? 0x3a1060 : p.kind === 'axe' ? 0xff3a00 : 0x6a58ff, a: p.kind === 'fire' ? .6 : .9, drag: 2 });
    }
    for (const t of B.fighters) {
      if (t === p.owner || p.hit.has(t) || t.hp <= 0 || realmOf(t) !== realmOf(p)) continue;
      if (ally(p.owner, t)) { if (p.cleanse && Math.hypot(p.x - t.x, p.y - t.y) < p.r + t.r) { p.hit.add(t); cleanse(t); killProj(p); } continue; }
      if (Math.hypot(p.x - t.x, p.y - t.y) < p.r + t.r) {
        p.hit.add(t); hurt(p.owner, t, p.dmg, { dir: Math.atan2(p.vy, p.vx) }); p.onHit && p.onHit(t);
        if (!p.pierce) killProj(p);
      }
    }
    if (!p.pierce && p.life > 0) for (const o of B.objs) if ((o.realm || 0) === realmOf(p) && Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r) {
      vfx.burst('spark', wp, 14, { speed: 5, life: .4, size: .4, c0: p.color }); vfx.flash(wp, { color: p.color, size: 2.5, dur: .2 }); killProj(p);
    }
  }
  B.projs = B.projs.filter(p => { if (p.life <= 0) { killProj(p); return false; } return true; });
}

/* ================= 장판(지정 위치 폭발) ================= */
function zone(f, o) {
  const z = Object.assign({ t: 0, delay: 0, done: false, owner: f, realm: f.realm }, o); if (f.area) z.r *= f.area; if (f.form === 'hour') z.r *= 1.3;
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
      for (const t of B.fighters) if (t !== z.owner && realmOf(t) === realmOf(z) && Math.hypot(t.x - z.x, t.y - z.y) < z.r + t.r) { if (inBarrier(z.owner, t)) { hurt(z.owner, t, z.dmg); continue; } hurt(z.owner, t, z.dmg); z.onHit && z.onHit(t); }
    }
  }
  B.zones = B.zones.filter(z => z.t < z.delay + .3);
}

/* ================= 침묵의 심판 (필드) ================= */
function startField(f) {
  const c = f.cast = { type: 'field', x: f.x, y: f.y, r: f.form === 'hour' ? 300 : 230, t: 0, acc: 0 };
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
      if (inBarrier(f, o)) continue;
      o.st.lock = .15; hurt(f, o, 800 * dt * (c.boost ? 1.5 : 1), { field: true, quiet: true });
      if (f.form === 'hour') { if (!c.hit) c.hit = new Set(); if (!c.hit.has(o)) { c.hit.add(o); for (const k of ['z', 'x', 'c', 'v']) if (o.cd[k] !== undefined) o.cd[k] += 4; ui.pop(P3(o, 3.4), '⏳ 쿨타임 증가', '#cfd8ff'); } for (const k of ['z', 'x', 'c', 'v']) if (o.cd[k] > 0) o.cd[k] += dt * 1.5; }
      o.fieldAcc = (o.fieldAcc || 0) + 800 * dt * dmgMul(f);
      if (o.fieldAcc >= 800) { o.fieldAcc -= 800; ui.pop(P3(o, 2.6), '800', '#cfd8ff'); hitFX(o, SIL, false); }
      if (Math.random() < .5) vfx.emit('spark', { x: o.root.position.x + rnd(-.6, .6), y: 1 + rnd(0, 1.6), z: o.root.position.z + rnd(-.6, .6), vy: 2, life: .5, s0: .4, s1: 0, c0: SIL });
    }
  }
}

/* ================= 정신세계 ================= */
function startMind(f) {
  if (B.seal || B.abyss || B.lult) return false;
  const e = foe(f);
  if (e !== B.ghost && immune(e) && (e.def.id === 'pva' || inLdom(e))) { ui.pop(P3(e, 3.4), '저항!', '#fff0a8'); toast(f, '각성 퓨어바닐라 쿠키와 빛의 아공간 안의 아군에게는 정신계 공격이 통하지 않습니다'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  B.barriers.forEach(removeBarrier); B.barriers = [];
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
  if (f.form === 'hour') range *= 1.3;
  const a = f.face, p = P3(f, .9);
  vfx.slashGround(p, Math.PI / 2 - a, { len: range * S * 1.15, color, from: f.swingDir = -(f.swingDir || 1), dur: .28 });
  vfx.burst('spark', p.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(range * S * .8)), 6, { speed: 4, life: .3, size: .3, c0: color });
  const hits = [];
  for (const t of B.fighters) if (t !== f && realmOf(t) === realmOf(f) && dist(f, t) < range + t.r && adiff(ang(f, t), a) < arc) { hurt(f, t, dmg, { dir: a }); hits.push(t); }
  return hits;
}
function clampRange(f, p, max) { const d = dist(f, p); if (d <= max) return { x: p.x, y: p.y }; const a = ang(f, p); return { x: f.x + Math.cos(a) * max, y: f.y + Math.sin(a) * max }; }
function runScript(f, steps, end, onEnd) { f.script = { t: 0, steps: steps.map(s => ({ ...s, d: false })), end, onEnd }; }
function setAnim(f, name, dur = .3) { f.anim = { n: name, t: 0, d: dur }; }
function shock(f, r, color, dmg, after) {
  const p = P3(f);
  vfx.ring(p, { r0: .5, r1: r * S, dur: .5, color }); vfx.ring(p, { r0: .3, r1: r * S * .7, dur: .7, color: 0xffffff, alpha: .6 });
  vfx.burst('spark', P3(f, 1), 40, { speed: 8, speed2: 20, life: .6, size: .5, c0: 0xffffff, c1: color, flat: true });
  for (const t of B.fighters) if (t !== f && realmOf(t) === realmOf(f) && dist(f, t) < r + t.r) { hurt(f, t, dmg); after && after(t); }
}

/* ================= 컷신: 적막의 종언 ================= */
const APEX = new THREE.Vector3(-3, 26, -32);
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 };
// 자유 시점: 우클릭 드래그=회전, 휠=줌, Q/E=회전, T=내 캐릭터 추적 ↔ 둘 다 보기
const cam = { yaw: 0, pitch: .95, dist: 15, fit: false };
const realmS = () => B && (B.seal || (B.abyss && !B.abyss.done ? B.abyss : null));   // 별도 세계(봉인수 내부 / 드래곤의 심연) 상태
const viewRealm = () => { const s = realmS(); return !!(s && (B.fighters[0] === s.target || B.viewSeal)); };
function gameCamPose() {
  let a, b; if (viewRealm()) a = b = realmS().target; else { const main = B.fighters.filter(o => !o.minion && !o.realm); a = main[0] || B.fighters[0]; b = main[1] || a; } const sep = dist(a, b) * S;
  const tgt = cam.fit && a !== b ? W3((a.x + b.x) / 2, (a.y + b.y) / 2, 1) : P3(a, 1);
  const big = (a.form === 'dragon' || b.form === 'dragon' ? 1.15 : 1) * (a.big || b.big ? 1.9 : 1);
  const d = cam.dist * big + (cam.fit ? sep * .45 : 0), cp = Math.cos(cam.pitch);
  return { pos: tgt.clone().add(new THREE.Vector3(Math.sin(cam.yaw) * cp * d, Math.sin(cam.pitch) * d, Math.cos(cam.yaw) * cp * d)), look: tgt, fov: 42 };
}
const camRel = (mx, my) => ({ x: Math.cos(cam.yaw) * mx + Math.sin(cam.yaw) * my, y: -Math.sin(cam.yaw) * mx + Math.cos(cam.yaw) * my });
function startCut(f, name, onHit, opt = {}) {
  const e = foe(f), moon = buildMoon(18);
  moon.group.position.set(0, 36, -72); world.scene.add(moon.group);
  B.cut = { t: 0, dur: 8.2, dark: !!opt.dark, f, e, name, onHit, moon, home: { x: f.x, y: f.y }, fl: {}, rune: null };
  B.projs.forEach(killProj); B.projs = [];
  world.setCut(true); ui.cinema(true); world.bloom.strength = .8; world.bloom.threshold = .95;
  f.pose = 'raise'; camera.near = .1;
}
function updateCut(dt) {
  if (B.cut.kind === 'dm') return updDarkMoon(dt);
  if (B.cut.kind === 'burn') return updBurnCut(dt);
  if (B.cut.kind === 'moonk') return updMoonK(dt);
  const c = B.cut, f = c.f, e = c.e, t = c.t += dt, fl = c.fl;
  if (c.dark) { const u = sstep(0, 4.4, t), col = new THREE.Color(0xfff6dc).lerp(new THREE.Color(0x03030a), u), capc = new THREE.Color(0xfff0b0).lerp(new THREE.Color(0x000000), u); c.moon.halves.forEach(h => { h.children[0].material.color.copy(col); h.children[1].material.color.copy(capc); }); c.moon.glow.material.color.set(u > .5 ? 0x4a5cff : 0xcfd8ff); }
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
  awake: { wins: 3, desc: '사일런트솔트 쿠키로 3승 (궁극기 해금)' }, ult: { need: 9000 },
  skills: {
    base: {
      a: { name: '검 베기', cd: .85, desc: '검으로 벤다. 데미지 250', use(f) { setAnim(f, 'slash', .26); swing(f, 95, .9, 250, SIL); } },
      z: { name: '침묵의 기운', cd: 4, desc: '지정한 곳에서 침묵의 기운이 솟구침. 데미지 1500 + 슬로우', use(f, p) { setAnim(f, 'cast', .5); const q = clampRange(f, p, 650); zone(f, { x: q.x, y: q.y, r: 95, delay: .6, dmg: 1500, color: SIL, onHit: t => slowOn(t, 3, .5) }); } },
      x: { name: '침묵의 검기', cd: 6, desc: '침묵의 검기를 발사. 데미지 2200, 적중 시 2초간 스킬 사용 불가', use(f) { setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 760, r: 20, dmg: 2200, color: SIL, kind: 'wave', life: 1.4, onHit: t => { silenceOn(t, 2); ui.pop(P3(t, 3.2), '🔇 침묵', '#a89fc8'); vfx.ring(P3(t), { r1: 3, color: SIL }); } }); } },
      c: { name: '적막의 종언', cd: 35, desc: '[컷신] 달을 반으로 베어버린다. 광역 4500', use(f) { startCut(f, '적막의 종언', () => { for (const t of B.fighters) if (t !== f) hurt(f, t, 4500); }); } },
      r: { name: '신의 은포크 심판', cd: 0, desc: '(각성 후, 게이지 100%) 하늘에서 신의 은포크가 적의 수만큼(최소 2개, 최대 5개) 내려와 기하급수적 피해를 주고 사슬로 봉인. 봉인된 적은 봉인수 내부(별도 맵)로 이동하며, 망령과 봉인수를 쓰러뜨려야 풀려남. G키/버튼으로 내부 화면과 내 화면을 전환(영혼 상태: 쿨타임 +50%, 체력 -70%, 데미지 -50%, 패시브 소멸)', use(f) { return startForkUlt(f); } },
      v: { name: '침묵의 심판', cd: 22, desc: '검을 꽂아 침묵의 영역 생성. 영역 내 시전자 외 모두 이동·스킬 불가, 초당 800. 피격 시/재입력 시 해제', use(f) { if (f.cast && f.cast.type === 'field') { endField(f); return true; } startField(f); return 'nocd'; } },
    }
  }
};
{
  const bs = CHARS.silent.skills.base;
  CHARS.silent.skills.hour = {
    ...bs,
    z: { name: '침묵의 파동', cd: 5, desc: '[침묵의 때] 주위에서 침묵의 파동이 마구 일어남. 데미지 700 × 다수, 적중 시 1.5초간 스킬 사용 불가', use(f) {
      setAnim(f, 'cast', .5); const steps = [];
      for (let i = 0; i < 10; i++) steps.push({ at: i * .17, fn: () => {
        const e = foe(f), near = i % 2 === 0 && e, a = rnd(0, 6.283), d = near ? rnd(0, 120) : rnd(70, 320), cx = near ? e.x : f.x, cy = near ? e.y : f.y;
        zone(f, { x: clamp(cx + Math.cos(a) * d, PAD, W - PAD), y: clamp(cy + Math.sin(a) * d, PAD, H - PAD), r: 85, delay: .5, dmg: 700, color: SIL, onHit: t => { silenceOn(t, 1.5); ui.pop(P3(t, 3.2), '🔇 침묵', '#a89fc8'); } });
      } });
      runScript(f, steps, 1.9);
    } },
    x: { name: '카타콤의 분노', cd: 9, desc: '[침묵의 때] 적에게 돌진해 칼로 콤보 공격. 총 약 4400', use(f) {
      const e = foe(f); if (e.hp <= 0 || dist(f, e) > 720) { toast(f, '사거리 밖'); return false; }
      const a = ang(f, e), sx = f.x, sy = f.y, tx = e.x - Math.cos(a) * 85, ty = e.y - Math.sin(a) * 85, steps = [];
      f.st.inv = Math.max(f.st.inv, 1.8); setAnim(f, 'slash', .3);
      for (let i = 1; i <= 4; i++) steps.push({ at: i * .05, fn: () => { const from = P3(f, 1.1); f.x = lerp(sx, tx, i / 4); f.y = lerp(sy, ty, i / 4); f.face = a; vfx.line('glow', from, P3(f, 1.1), 12, { size: 1.2, size1: .1, c0: 0xffffff, c1: 0x7d9bff, life: .5, rad: .25 }); } });
      for (let j = 0; j < 6; j++) steps.push({ at: .35 + j * .15, fn: () => {
        if (e.hp <= 0 || dist(f, e) > 260) return; const last = j === 5; f.face = ang(f, e); setAnim(f, 'slash', .12);
        const ec = P3(e, 1.5), r = rnd(-.6, .6); vfx.slashBB(ec, { rot: (j % 2 ? .9 : -.9) + r, len: last ? 9 : 6, color: last ? 0xffffff : 0x9fb8ff });
        swing(f, 180, 2.4, last ? 1800 : 520, 0x9fb8ff); if (last) { shake(.8, .4); B.hitstop = Math.max(B.hitstop, .1); }
      } });
      runScript(f, steps, 1.45, () => { f.st.inv = 0; });
    } },
    c: { name: '적막의 끝', cd: 45, desc: '[침묵의 때][컷신] 달이 점점 검게 물들고, 사일런트솔트 쿠키가 쿠키들과 함께 달을 반으로 갈라버린다. 광역 7000', use(f) {
      startCut(f, '적막의 끝', () => { for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0) { const ec = P3(t, 1.5); vfx.slashBB(ec, { rot: 1.57, len: 10, color: 0xffffff }); vfx.slashBB(ec, { rot: 1.57, len: 10, color: 0x000000 }); hurt(f, t, 7000); } }, { dark: true });
    } },
    v: { ...bs.v, name: '침묵의 심판 · 때', cd: 22, desc: '[침묵의 때] 침묵의 심판 + 영역 안 적의 스킬 쿨타임 증가' },
  };
}
CHARS.lich = {
  id: 'lich', name: '리치드래곤 쿠키', color: 0xc46bff, cost: 500, hp: 27000, pref: 6.5, atkRange: 420, tag: '매혹 · 변신 · 정신세계',
  awake: { wins: 3, desc: '리치드래곤 쿠키로 3승 (궁극기 해금)' }, ult: { need: 9000 }, dragon: { hp: 52000 },
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
      c: { name: '정신세계', cd: 45, desc: '상대의 정신세계로 들어가 1대1. 리치 이속 +15%, 데미지 +5%, 방어 +5% (15초)', use(f) { if (B.mind) return false; setAnim(f, 'cast', .6); return startMind(f); } },
      r: { name: '드래곤의 심연', cd: 0, desc: '(각성 후, 게이지 100%) 여러 리치드래곤 쿠키가 적을 빨간 선으로 묶고 잡아당겨 세계를 유리처럼 깨뜨림. 적은 드래곤의 심연으로 이동해 추격자를 피해 출구로 탈출해야 함. 잡히면 도끼 컷신 + 30초 스턴, 탈출해도 이 경기 동안 방향키 반전·슬로우 영구 적용 + 정신계 면역 해제', use(f) { return startLichUlt(f); } },
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
const inLdom = t => !!B && B.fighters.some(p => p.ldom && p.hp > 0 && realmOf(p) === realmOf(t) && (t === p || ally(p, t)) && Math.hypot(t.x - p.ldom.x, t.y - p.ldom.y) < p.ldom.r + t.r);
const immune = t => t.def.id === 'pva' || inLdom(t) || (!t.mindOpen && (t.def.id === 'silent' || t.form === 'dragon' || !!t.def.spirit));
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
        if (inBarrier(f, t)) continue;
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
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
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
  if (e.hp > 0 && !immune(e) && !inBarrier(f, e) && inReg(v.reg, e)) { slowOn(e, .3, .55); e.st.rev = .3; if (Math.random() < .3) vfx.emit('glow', { x: e.root.position.x + rnd(-.6, .6), y: 2.4, z: e.root.position.z + rnd(-.6, .6), vy: 1, life: .6, s0: .35, s1: 0, c0: 0x9fb8ff }); }
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
  id: 'sugar', name: '이터널슈가 쿠키', color: 0xff8ad0, cost: 800, hp: 10000, shield: 30000, pref: 5.5, atkRange: 520, tag: '시작 보호막 30,000 · 호수 · 수면 · 설탕 낙원',
  skills: {
    base: {
      a: { name: '핑크빛 돌', cd: 1.2, desc: '하늘에서 핑크빛 돌을 떨어뜨림. 데미지 500', use(f, p) { setAnim(f, 'cast', .3); const q = clampRange(f, p, 560); zone(f, { x: q.x, y: q.y, r: 60, delay: .5, dmg: 500, color: 0xff8ad0, rock: true }); } },
      z: { name: '딸기잼 호수', cd: 14, desc: '아주 넓은 딸기잼 호수 생성. 강한 슬로우 + 초당 1000 (5초 유지)', use(f, p) { setAnim(f, 'cast', .6); const q = clampRange(f, p, 560); makeLake(f, { kind: 'lake', x: q.x, y: q.y, r: 300, dur: 5, dps: 1000, slowF: .25, color: 0xd81b4a, hi: 0xff7a9c }); ui.flash('#ff4f7d', .25, .3); } },
      x: { name: '설탕 호수', cd: 8, desc: '일직선으로 광역 핑크빛 설탕 호수를 만들며 데미지. 4000', use(f) { setAnim(f, 'cast', .5); makeLake(f, { kind: 'strip', x: f.x, y: f.y, a: f.face, len: 760, wid: 170, dur: 1.8, dmg: 4000, color: 0xff9ad8, hi: 0xffffff }); } },
      c: { name: '수면', cd: 30, desc: '5초간 수면. 받는 피해 45% 감소, 체력 12% · 보호막 12% 회복', use(f) { startSleep(f); } },
      v: { name: '설탕낙원', cd: 65, desc: '지형이 설탕 낙원으로 변하고 꽃 위에서 수면. 받는 피해 55% 감소, 체력 20% · 보호막 25% 회복. 설탕 천사가 적을 공격. 40초 유지, V 재입력 시 해제', use(f) { if (f.cast && f.cast.type === 'paradise') { endParadise(f); return true; } startParadise(f); return 'nocd'; } },
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
        if (inBarrier(l.owner, t)) continue;
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
  const dur = 5; f.cast = { type: 'sleep', t: 0, dur, hp: f.max * .12, sh: f.shieldMax * .12 }; f.drT = dur + .05; f.drV = .45; f.pose = 'sleep';
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
  f.cast = { type: 'paradise', t: 0, dur: 40, group, big, angelT: 1.2, hp: f.max * .2, sh: f.shieldMax * .25 };
  f.drT = 1e9; f.drV = .55; f.pose = 'sleep'; world.setParadise(true);
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
  id: 'dark', name: '어둠마녀 쿠키', color: 0xd8202f, cost: 600, hp: 24000, witch: { hp: 60000 }, pref: 5.5, atkRange: 520, tag: '유도 · 흡수 · 변신 · 패시브: 보호막 흡수/관통', passive: '공격이 적중할 때마다 상대 보호막의 20%를 흡수해 내 보호막으로 삼고, 주는 피해의 10%는 상대 보호막을 관통해 체력에 들어갑니다.',
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
  if (e.hp > 0 && !inBarrier(f, e) && Math.hypot(e.x - f.x, e.y - f.y) < d.r + e.r) {
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
/* ===== 퓨어바닐라 쿠키 ===== */
const PVC = 0xfff0a8;
CHARS.pv = {
  id: 'pv', name: '퓨어바닐라 쿠키', color: PVC, cost: 900, hp: 23000, pref: 5.5, atkRange: 520, tag: '마법 · 치유 · 보호의 장막 · 다크문',
  skills: {
    base: {
      a: { name: '빛나는 빛', cd: .95, desc: '빛나는 마법 빛을 발사. 데미지 200. 아군에게 적중하면 디버프 해제', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 560, r: 12, dmg: 200, color: PVC, kind: 'orb', life: 1.2, cleanse: true }); } },
      z: { name: '보호의 장막', cd: 16, desc: '보호의 장막 소환(5초). 안에서 초당 100 회복. 적의 모든 스킬(정신계·침투 포함)을 막고, 적이 닿으면 튕겨냄', use(f) { startBarrier(f); } },
      x: { name: '마법의 빛', cd: 18, desc: '거대한 영역에 빛줄기가 비스듬히 쏟아져 피해(7초). 영역 안 아군은 공격력 +25%', use(f, p) { const q = clampRange(f, p, 600); startLightField(f, q); } },
      c: { name: '정화의 파열', cd: 20, desc: '주변에 빛이 펑 터져 피해 1500. 침묵의 심판·정신세계·정신 침투·아공간·장막 등 적의 영역을 해제 (침묵의 심판 중에도 사용 가능). 아군 영역은 유지', use(f) { return lightBurst(f); } },
      v: { name: '다크문', cd: 60, desc: '자신이 1000 피해를 입는 대신 전 영역에 붉은 달의 폭풍우를 일으킴. 적은 붉은 사슬에 묶임. 컷신 있음', use(f) { if (B.storm) return false; startDarkMoon(f); } },
    }
  }
};
const ally = (a, b) => a !== b && a.team !== undefined && a.team === b.team;
const inBarrier = (src, t) => B.barriers.length > 0 && B.barriers.some(b => b.owner !== src && !ally(b.owner, src) && (b.owner === t || ally(b.owner, t)) && Math.hypot(t.x - b.x, t.y - b.y) < b.r);
function cleanse(t) {
  for (const k of ['slow', 'silence', 'stun', 'charm', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) t.st[k] = 0;
  ui.pop(P3(t, 3.2), '✨ 디버프 해제', '#fff3b0'); vfx.ring(P3(t), { r0: .4, r1: 4, dur: .5, color: PVC });
}

/* --- Z: 보호의 장막 --- */
function startBarrier(f) {
  setAnim(f, 'cast', .5);
  const b = { owner: f, x: f.x, y: f.y, r: 240, t: 0, dur: 5, acc: 0, push: 0 }, p = P3(f), R = b.r * S;
  b.dome = vfx.dome(p, R, PVC);
  b.rune = vfx.decal(p, { tex: 'rune', r: R, color: PVC, alpha: .8, spin: .5 });
  b.ring = vfx.decal(p, { tex: 'ring', r: R, color: 0xffffff, alpha: .9, y: .07 });
  vfx.ring(p, { r0: .5, r1: R * 1.3, dur: .6, color: PVC }); vfx.burst('glow', P3(f, .6), 40, { speed: 3, speed2: 10, life: .9, size: .9, c0: 0xffffff, c1: PVC, flat: true });
  ui.flash('#fff6c0', .3, .3); B.barriers.push(b); toast(f, '보호의 장막!');
  B.projs.filter(q => q.owner !== f && !ally(q.owner, f) && Math.hypot(q.x - b.x, q.y - b.y) < b.r).forEach(killProj);
}
function removeBarrier(b) { if (b.mesh && b.t < b.dur - .1) world.scene.remove(b.mesh); if (b.dome) b.dome.closing = true; [b.rune, b.ring].forEach(i => i && vfx.remove(i)); }
function updBarriers(dt) {
  for (const b of B.barriers) {
    if (b.follow) {   // 주인을 따라다니는 장막
      b.x = b.owner.x; b.y = b.owner.y; const p2 = P3(b);
      for (const it of [b.dome, b.rune, b.ring]) if (it && it.obj) { it.obj.position.x = p2.x; it.obj.position.z = p2.z; }
    }
    b.t += dt; b.acc += dt; const p = P3(b), R = b.r * S;
    if (Math.random() < .7) { const a = rnd(0, 6.283); vfx.emit('glow', { x: p.x + Math.cos(a) * R, y: .2, z: p.z + Math.sin(a) * R, vy: rnd(2, 6), life: .9, s0: .5, s1: 0, c0: 0xffffff, c1: PVC, a: .8, drag: 0 }); }
    for (const t of B.fighters) {
      if (t.hp <= 0) continue;
      const d = Math.hypot(t.x - b.x, t.y - b.y), mine = t === b.owner || ally(b.owner, t);
      if (mine) {
        if (d < b.r + t.r) {
          if (b.refl) { const cap = Math.max(t.shieldMax, 2000); t.shieldMax = cap; t.shield = Math.min(cap, t.shield + 800 * dt); }   // 반사막 안: 보호막 재충전
          const hl = (b.refl ? t.max * .03 : b.lily ? t.max * .02 : 100) * (b.boost ? 2 : 1); t.hp = Math.min(t.max, t.hp + hl * dt); t.barAcc = (t.barAcc || 0) + hl * dt;
          if (t.barAcc >= Math.max(100, hl * .7)) { ui.pop(P3(t, 2.8), '+' + Math.round(t.barAcc), '#7dff9b'); t.barAcc = 0; }
          if (b.lily) { if (t.st.lightBuff <= 0) ui.pop(P3(t, 3.2), '⚔ 공격력 UP', '#ffd0f0'); t.st.lightBuff = .4; }   // 백합 안: 세인트릴리와 아군 공격력 버프 + 힐
        }
      }
      else if (d < b.r + t.r) {     // 적은 튕겨나감
        const a = Math.atan2(t.y - b.y, t.x - b.x), nd = b.r + t.r + 6; t.x = clamp(b.x + Math.cos(a) * nd, PAD, W - PAD); t.y = clamp(b.y + Math.sin(a) * nd, PAD, H - PAD);
        if (t.pushT === undefined || B.time - t.pushT > .4) { t.pushT = B.time; vfx.burst('spark', P3(t, 1), 14, { speed: 6, life: .35, size: .4, c0: 0xffffff, c1: PVC }); vfx.ring(P3(t), { r0: .4, r1: 3, dur: .4, color: PVC }); ui.pop(P3(t, 3), '튕겨냄!', '#fff3b0'); }
      }
    }
    for (const q of B.projs) if (q.owner !== b.owner && !ally(q.owner, b.owner) && Math.hypot(q.x - b.x, q.y - b.y) < b.r + q.r) {
      vfx.burst('spark', W3(q.x, q.y, 1.2), 12, { speed: 5, life: .35, size: .4, c0: 0xffffff, c1: PVC }); vfx.flash(W3(q.x, q.y, 1.2), { color: PVC, size: 2.4, dur: .2 });
      if (b.refl) { q.owner = b.owner; q.vx = -q.vx; q.vy = -q.vy; q.hit = new Set(); q.life = Math.max(q.life, .8); q.realm = b.owner.realm; } else killProj(q);   // 반사막: 투사체를 되돌려 보낸다
    }
    if (b.dome && b.t > b.dur - .5) b.dome.closing = true;
  }
  B.barriers = B.barriers.filter(b => { if (b.t >= b.dur) { removeBarrier(b); vfx.ring(P3(b), { r0: b.r * S, r1: b.r * S * 1.25, dur: .4, color: PVC }); return false; } return true; });
}

/* --- X: 마법의 빛 --- */
const rayGeo = new THREE.CylinderGeometry(.5, .5, 30, 8, 1, true);
function startLightField(f, q) {
  setAnim(f, 'cast', .6);
  const lf = { owner: f, x: q.x, y: q.y, r: 420, t: 0, dur: 7, spawn: 0, rays: [] }, p = P3(lf), R = lf.r * S;
  lf.rune = vfx.decal(p, { tex: 'rune', r: R, color: PVC, alpha: .75, spin: .4 });
  lf.rune2 = vfx.decal(p, { tex: 'rune', r: R * .6, color: 0xffffff, alpha: .5, spin: -.8, y: .06 });
  lf.ring = vfx.decal(p, { tex: 'ring', r: R, color: 0xffffff, alpha: .9, y: .07 });
  vfx.ring(p, { r0: .5, r1: R * 1.15, dur: .8, color: PVC }); ui.flash('#fff6c0', .35, .35); shake(.3, .3);
  B.lights.push(lf);
}
function removeLight(lf) { [lf.rune, lf.rune2, lf.ring].forEach(i => i && vfx.remove(i)); lf.rays.forEach(r => world.scene.remove(r.mesh)); lf.rays = []; }
function updLights(dt) {
  for (const lf of B.lights) {
    lf.t += dt; lf.spawn -= dt; const f = lf.owner;
    for (const t of B.fighters) if ((t === f || ally(f, t)) && t.hp > 0 && Math.hypot(t.x - lf.x, t.y - lf.y) < lf.r + t.r) {
      if (t.st.lightBuff <= 0) ui.pop(P3(t, 3.2), '⚔ 공격력 UP', '#ffe27a');
      t.st.lightBuff = .4; if (Math.random() < .5) vfx.emit('glow', { x: t.root.position.x + rnd(-.5, .5), y: .3, z: t.root.position.z + rnd(-.5, .5), vy: 3, life: .6, s0: .4, s1: 0, c0: 0xffffff, c1: PVC });
    }
    if (lf.spawn <= 0 && lf.t < lf.dur - .4) {
      lf.spawn = .1;
      const es = B.fighters.filter(t => t !== f && !ally(f, t) && t.hp > 0 && Math.hypot(t.x - lf.x, t.y - lf.y) < lf.r), aimed = es.length && Math.random() < .45;
      let x, y; if (aimed) { const e = es[Math.floor(Math.random() * es.length)]; x = e.x + rnd(-45, 45); y = e.y + rnd(-45, 45); } else { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * lf.r; x = lf.x + Math.cos(a) * d; y = lf.y + Math.sin(a) * d; }
      const dir = new THREE.Vector3(.5, 1, .18).normalize(), m = new THREE.Mesh(rayGeo, new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: .0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); m.scale.set(.5 + Math.random() * .5, 1, .5 + Math.random() * .5);
      const g = W3(x, y, 0); lf.rays.push({ mesh: m, x, y, g, dir, t: 0, hit: false }); world.scene.add(m);
    }
    for (const r of lf.rays) {
      r.t += dt; const u = Math.min(1, r.t / .28), L = 30;
      r.mesh.position.copy(r.g).addScaledVector(r.dir, L / 2 + L * (1 - u) * 1.2); r.mesh.material.opacity = r.t < .28 ? .85 * u : Math.max(0, .85 * (1 - (r.t - .28) / .25));
      if (!r.hit && r.t >= .28) {
        r.hit = true; const c = W3(r.x, r.y, .1); vfx.ring(c, { r0: .3, r1: 3.4, dur: .35, color: PVC }); vfx.burst('spark', c.clone().setY(.4), 10, { speed: 5, speed2: 11, life: .45, size: .35, c0: 0xffffff, c1: PVC, grav: 6 });
        for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && Math.hypot(t.x - r.x, t.y - r.y) < 85 + t.r) hurt(f, t, lf.boost ? 330 : 220, { quiet: false });
      }
    }
    lf.rays = lf.rays.filter(r => { if (r.t > .56) { world.scene.remove(r.mesh); r.mesh.material.dispose(); return false; } return true; });
  }
  B.lights = B.lights.filter(lf => { if (lf.t >= lf.dur) { removeLight(lf); return false; } return true; });
}

/* --- C: 정화의 파열 (영역 해제) --- */
function lightBurst(f) {
  const R = 300, broke = []; setAnim(f, 'cast', .45);
  const p = P3(f); erupt(p, R * S * .5, PVC, 14); for (let i = 0; i < 3; i++) vfx.ring(p, { r0: .5, r1: R * S * (1 + i * .4), dur: .5 + i * .15, color: i % 2 ? 0xffffff : PVC });
  vfx.burst('spark', P3(f, 1), 90, { speed: 8, speed2: 24, life: .8, life2: 1.4, size: .7, c0: 0xffffff, c1: PVC, grav: 3 }); ui.flash('#fffbe0', .8, .45); shake(.7, .4);
  f.st.lock = 0; f.st.silence = 0; f.st.rev = 0; f.st.slow = 0;
  if (f.st.ctl > 0 && f.ctlBy) { const c = f.ctlBy; if (c.cast && c.cast.type === 'control') c.cast = null; f.st.ctl = 0; f.ctlBy = null; broke.push('정신 침투'); }
  if (B.mind && B.mind.f !== f && !ally(B.mind.f, f)) { endMind(); broke.push('정신세계'); }
  for (const e of B.fighters) {
    if (e === f || ally(f, e) || e.hp <= 0) continue;
    if (dist(f, e) < R + e.r) hurt(f, e, 1500, { dir: ang(f, e) });
    if (e.cast && e.cast.type === 'field' && dist(f, e.cast) < e.cast.r + R) { endField(e); broke.push('침묵의 심판'); }
    else if (e.cast && e.cast.type === 'sub' && dist(f, e) < R * 1.8) { e.cast = null; e.hidden = false; e.st.inv = 0; e.st.stun = Math.max(e.st.stun, .8); broke.push('아공간'); }
    else if (e.cast && e.cast.type === 'paradise') { endParadise(e); broke.push('설탕낙원'); }
    if (e.veil) { endVeil(e); broke.push('거짓의 장막'); }
    if (e.cast && e.cast.type === 'control') { e.cast = null; }
  }
  B.lakes.filter(l => l.owner !== f && !ally(l.owner, f) && Math.hypot(l.x - f.x, l.y - f.y) < R + (l.r || 200)).forEach(l => { l.t = l.dur; });
  B.hexes.filter(h => h.owner !== f && !ally(h.owner, f) && Math.hypot(h.x - f.x, h.y - f.y) < R + h.r).forEach(h => { h.t = h.dur; });
  if (broke.length) { ui.pop(P3(f, 3.6), '영역 해제!', '#fff3b0'); toast(f, '해제: ' + [...new Set(broke)].join(', ')); }
}

/* --- V: 다크문 --- */
function recolorMoon(moon, u) {
  const c0 = new THREE.Color(0xfff6dc), c1 = new THREE.Color(0xd0101e), c = c0.clone().lerp(c1, u);
  moon.halves.forEach(h => h.traverse(o => { if (o.isMesh) o.material.color.copy(c); }));
  moon.glow.material.color.set(0xcfd8ff).lerp(new THREE.Color(0xff1830), u);
}
function buildRedEye(sc) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3040 })); w.scale.set(1.5, .75, .4); g.add(w);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0x600010 })); iris.position.z = .15; iris.scale.set(1, 1, .5); g.add(iris);
  const pup = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x000000 })); pup.scale.set(.4, 1.8, .5); pup.position.z = .25; g.add(pup);
  g.scale.setScalar(sc); g.userData.sc = sc; return g;
}
function startDarkMoon(f) {
  const e = foe(f), moon = buildMoon(18); moon.group.position.set(0, 36, -72); moon.tilt.rotation.z = 0; world.scene.add(moon.group);
  B.projs.forEach(killProj); B.projs = [];
  B.cut = { kind: 'dm', t: 0, dur: 8.2, f, e, moon, fl: {}, home: { x: f.x, y: f.y }, eyes: [] };
  world.setCut(true); ui.cinema(true); f.pose = 'raise'; camera.near = .1;
}
function updDarkMoon(dt) {
  const c = B.cut, f = c.f, t = c.t += dt, fl = c.fl, M = c.moon.group.position, base = W3(c.home.x, c.home.y, 0);
  let pos, look, fov;
  if (t < 1.8) {                    // ① 결의: 자신에게 1000 피해
    const u = t / 1.8;
    for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = rnd(3, 6); vfx.emit('glow', { x: base.x + Math.cos(a) * d, y: rnd(0, 6), z: base.z + Math.sin(a) * d, vx: -Math.cos(a) * 6, vy: rnd(0, 3), vz: -Math.sin(a) * 6, life: .5, s0: .35, s1: .05, a: .6, c0: 0xff8090, c1: 0x7a0010, drag: 0 }); }
    if (u > .5 && !fl.a) { fl.a = 1; f.hp = Math.max(1, f.hp - 1000); f.flash = .3; ui.pop(P3(f, 3), '-1000', '#ff5060', true); ui.flash('#a00018', .6, .4); shake(.5, .3); }
    pos = new THREE.Vector3(base.x + lerp(3.4, 1.6, ease.io(u)), lerp(1.4, 2.0, u), base.z + lerp(8.5, 6)); look = base.clone().add(new THREE.Vector3(0, lerp(1.6, 2.4, u), 0)); fov = lerp(40, 34, u);
  } else if (t < 3.6) {             // ② 달이 붉어진다
    const u = (t - 1.8) / 1.8; recolorMoon(c.moon, ease.io(u));
    if (!fl.b) { fl.b = 1; ui.vignette(true); ui.flash('#400008', .5, .8); f.pose = 'raise'; }
    pos = new THREE.Vector3(base.x + lerp(1.6, 3, u), lerp(2, 8, ease.io(u)), base.z + lerp(6, 26, ease.io(u))); look = base.clone().lerp(M, ease.io(sstep(.1, 1, u))); fov = lerp(34, 48, u);
  } else if (t < 5.4) {             // ③ 달 뒷편의 붉은 눈들
    const u = (t - 3.6) / 1.8; recolorMoon(c.moon, 1);
    if (!fl.c) {
      fl.c = 1;
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + rnd(-.15, .15), rr = c.moon.R * rnd(1.0, 1.8), e = buildRedEye(rnd(4, 8)); e.position.set(M.x + Math.cos(a) * rr, M.y + Math.sin(a) * rr, M.z - 6); e.userData.ph = rnd(0, 6.283); e.userData.o = i * .06; e.scale.setScalar(.001); world.scene.add(e); c.eyes.push(e); }
      ui.title('', '');
    }
    c.eyes.forEach(e => { const k = ease.out(sstep(e.userData.o, e.userData.o + .35, u)), bl = Math.abs(Math.sin(t * 1.6 + e.userData.ph)) > .94 ? .15 : 1; e.scale.set(e.userData.sc * k, e.userData.sc * k * bl, e.userData.sc * k); e.lookAt(camera.position); });
    c.moon.glow.scale.setScalar(c.moon.R * (5 + Math.sin(t * 6) * .3));
    pos = new THREE.Vector3(lerp(3, 0, u), lerp(8, 10, u), lerp(26, 20, ease.out(u))); look = M.clone().add(new THREE.Vector3(0, -1, 0)); fov = lerp(48, 54, u);
    B.shake = Math.max(B.shake, .12); B.shakeT = .2;
  } else if (t < 6.6) {             // ④ 달 뒷편의 힘을 받는다
    const u = (t - 5.4) / 1.2;
    if (!fl.d) { fl.d = 1; ui.title(f.def.name, 'DARK MOON'); vfx.column(base.clone().setY(0), { r: 3.4, h: 80, dur: 1.6, color: 0xff1830, alpha: .7 }); vfx.column(base.clone().setY(0), { r: 1.4, h: 80, dur: 1.4, color: 0xffffff, alpha: .6 }); for (let i = 0; i < 4; i++) vfx.ring(base, { r0: 1, r1: 14 + i * 9, dur: .7 + i * .2, color: i % 2 ? 0xffffff : 0xff2030 }); ui.flash('#ff2030', .8, .5); shake(1, .7); f.pose = 'raise'; }
    pos = new THREE.Vector3(base.x + lerp(-4, 3.2, u), lerp(2.2, 4, u), base.z + lerp(7, 9, u)); look = base.clone().add(new THREE.Vector3(0, 2.6, 0)); fov = 40;
    if (Math.random() < .8) vfx.emit('glow', { x: base.x + rnd(-2, 2), y: 0, z: base.z + rnd(-2, 2), vy: rnd(8, 18), life: .9, s0: .6, s1: 0, c0: 0xffffff, c1: 0xff2030, drag: 0 });
  } else {                          // ⑤ 복귀 → 폭풍우 시작
    const u = Math.min(1, (t - 6.6) / 1.6), g = gameCamPose();
    if (!fl.e) { fl.e = 1; c.eyes.forEach(e => world.scene.remove(e)); c.eyes = []; c.moon.group.visible = false; world.setCut(false); ui.cinema(false); ui.title('', ''); f.pose = null; startStorm(f); }
    pos = camState.pos.clone().lerp(g.pos, ease.io(u)); look = camState.look.clone().lerp(g.look, ease.io(u)); fov = lerp(camState.fov, g.fov, ease.io(u));
    if (t >= c.dur) { B.cut = null; world.scene.remove(c.moon.group); f.pose = null; camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov; return; }
  }
  camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov;
}
function chainMesh() {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xff2030 }), m2 = new THREE.MeshBasicMaterial({ color: 0xffb0b8 });
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(.95 - i * .05, .07, 8, 28), i % 2 ? m2 : m); t.rotation.x = Math.PI / 2 + (i - 1) * .35; t.position.y = .5 + i * .7; t.rotation.z = i * 1.1; g.add(t); }
  for (let k = 0; k < 4; k++) { const a = k * 1.571 + .4, r = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 3.4, 6), m); r.position.set(Math.cos(a) * 1.6, 1.4, Math.sin(a) * 1.6); r.rotation.set(Math.sin(a) * .75, 0, -Math.cos(a) * .75); g.add(r); }
  return g;
}
function startStorm(f) {
  const st = B.storm = { f, t: 0, dur: 9, chainT: 4.5, bolt: 1, acc: 0, chains: [] };
  world.setStorm(true); ui.vignette(true);
  for (const e of B.fighters) if (e !== f && !ally(f, e) && e.hp > 0) {
    if (inBarrier(f, e)) continue;
    const g = chainMesh(); g.position.copy(P3(e)); world.scene.add(g); st.chains.push({ e, g });
    vfx.burst('spark', P3(e, 1), 40, { speed: 6, speed2: 14, life: .6, size: .5, c0: 0xffffff, c1: 0xff2030 }); ui.pop(P3(e, 3.4), '⛓ 붉은 사슬', '#ff6070');
  }
  toast(f, '다크문!');
}
function endStorm(silent) {
  const st = B.storm; if (!st) return; B.storm = null; st.chains.forEach(c => world.scene.remove(c.g)); world.setStorm(false); if (!silent) ui.vignette(false);
}
function updStorm(dt) {
  if (B.storm && realmOf(B.storm.f) !== CUR) return;
  const st = B.storm; if (!st) return; st.t += dt; st.acc += dt; const f = st.f, ctr = camState.look;
  for (let i = 0; i < 9; i++) vfx.emit('glow', { x: ctr.x + rnd(-45, 45), y: rnd(14, 24), z: ctr.z + rnd(-30, 30), vx: -16, vy: -42, vz: rnd(-3, 3), life: .55, s0: .13, s1: .07, c0: 0xffc0c8, c1: 0xff3040, a: .8, drag: 0 });
  if (Math.random() < dt * 6) vfx.emit('smoke', { x: ctr.x + rnd(-40, 40), y: rnd(.5, 3), z: ctr.z + rnd(-25, 25), vx: -14, vy: .5, life: 1.2, s0: 1.5, s1: 3, c0: 0x6a0818, a: .3 });
  if (st.t < st.chainT) for (const c of st.chains) { const e = c.e; if (e.hp <= 0) continue; e.st.lock = .15; c.g.position.copy(P3(e)); c.g.rotation.y += dt * 1.5; if (Math.random() < .3) vfx.emit('spark', { x: e.root.position.x + rnd(-1, 1), y: rnd(.5, 2.4), z: e.root.position.z + rnd(-1, 1), vy: 2, life: .4, s0: .3, s1: 0, c0: 0xff2030 }); }
  else if (st.chains.length) { st.chains.forEach(c => { vfx.burst('spark', c.g.position.clone().setY(1), 30, { speed: 7, speed2: 14, life: .6, size: .5, c0: 0xffffff, c1: 0xff2030 }); world.scene.remove(c.g); }); st.chains = []; }
  for (const e of B.fighters) if (e !== f && !ally(f, e) && e.hp > 0) {
    if (inBarrier(f, e)) continue;
    hurt(f, e, 250 * dt, { field: true, quiet: true }); e.stormAcc = (e.stormAcc || 0) + 250 * dt * dmgMul(f); if (e.stormAcc >= 500) { e.stormAcc -= 500; ui.pop(P3(e, 2.6), '500', '#ff6070'); }
  }
  st.bolt -= dt;
  if (st.bolt <= 0) {
    st.bolt = 1.4; const es = B.fighters.filter(e => e !== f && !ally(f, e) && e.hp > 0), tgt = es.length && Math.random() < .6 ? es[0] : { x: clamp(f.x + rnd(-500, 500), PAD, W - PAD), y: clamp(f.y + rnd(-350, 350), PAD, H - PAD), r: 0 };
    const q = P3(tgt); vfx.column(q, { r: 1.1, h: 60, dur: .3, color: 0xffffff }); vfx.column(q, { r: 2.6, h: 60, dur: .45, color: 0xff2030, alpha: .6 }); vfx.ring(q, { r0: .4, r1: 6, dur: .4, color: 0xff6070 }); ui.flash('#ffe0e4', .55, .22); shake(.4, .2);
    for (const e of es) if (Math.hypot(e.x - tgt.x, e.y - tgt.y) < 90 + e.r) hurt(f, e, 450);
  }
  if (st.t >= st.dur) { endStorm(false); ui.pop(P3(f, 3.2), '폭풍우가 걷힌다', '#ff9aa5'); }
}

/* ===== 탐험 맵 (거짓의 탑 던전 · 요거트강) =====
   startBattle(..., fx.explore) 로 시작. 내 캐릭터 1명이 큰 맵을 걸어 다니고, 몹(AI 팀 1)과 실제 전투한다. */
function addMob(m) {
  const d = CHARS[m.id], f = mkFighter(d, m.x * W, m.y * H, { kind: 'ai' });
  f.team = 1; f.max = f.hp = m.hpAbs || Math.round(d.hp * (m.hp || 1)); f.pm = m.pm || 1; f.area = m.area || 1; f.awake = true; f.aggro = m.aggro || 520; f.face = Math.PI; f.yaw = Math.PI / 2 - Math.PI; f.shield = f.shieldMax = 0;
  if (m.big) { f.big = m.big; f.r = 22 * m.big; }
  B.fighters.push(f); ui.addTag(f); return f;
}
function setupExplore(EX, fx) {
  const me = B.fighters[0], ex = B.explore = Object.assign({ goalX: 2, meshes: [], spawned: false, bossF: null, done: false, gates: [], chests: [], traps: [] }, EX);
  ex.chests = []; ex.traps = []; ex.meshes = [];   // 설정(EX)의 같은 이름 배열이 덮어쓰지 않게 새로 만든다 (아니면 아래 for-of 가 push 하면서 영원히 돈다)
  me.team = 0; B.ghost = { x: W / 2, y: H / 2, r: 0, hp: 1, max: 1, st: {}, def: { id: 'ghost' }, cast: null };
  if (fx.myHp) me.hp = Math.max(1, me.max * fx.myHp); if (fx.myShield) me.shield = me.shieldMax = fx.myShield; if (fx.timeout) B.fxT = fx.timeout;
  ex.gates = (EX.gates || []).map(x => ({ x: x * W, done: false }));
  (EX.mobs || []).forEach(addMob);
  if (EX.partner) { const p = mkFighter(CHARS[EX.partner.id], EX.partner.x * W, EX.partner.y * H, { kind: 'npc' }); p.team = 0; p.st.inv = 1e9; p.face = 0; p.yaw = Math.PI / 2; B.fighters.push(p); ui.addTag(p); ex.partnerF = p; }
  const add = (m) => { world.scene.add(m); ex.meshes.push(m); return m; };
  if (EX.river) {      // 요거트강 + 다리
    const r = EX.river, w = (r.x1 - r.x0) * W * S, c = W3((r.x0 + r.x1) / 2 * W, H / 2, .07);
    const riv = new THREE.Mesh(new THREE.PlaneGeometry(w, H * S).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf6ecd2, emissive: 0xffe9b8, emissiveIntensity: .35, roughness: .35, transparent: true, opacity: .96 })); riv.position.copy(c); add(riv);
    ex.river = { x0: r.x0 * W, x1: r.x1 * W, mat: riv.material };
    const bw = w + 6, bd = 7, br = new THREE.Mesh(new THREE.BoxGeometry(bw, .5, bd), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: .8 })); br.position.copy(W3((r.x0 + r.x1) / 2 * W, (EX.bridgeY || .15) * H, .22)); add(br);
    for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(bw, .5, .3), new THREE.MeshStandardMaterial({ color: 0x5a3a24 })); rail.position.copy(br.position).add(new THREE.Vector3(0, .55, s * bd / 2)); add(rail); }
  }
  for (const ch of EX.chests || []) {
    const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: 0xffc233, emissive: 0xffa020, emissiveIntensity: .6, metalness: .5, roughness: .3 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 1.5), gold).translateY(.65)); g.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, .5, 1.6), gold).translateY(1.5));
    g.position.copy(W3(ch.x * W, ch.y * H, 0)); add(g); ex.chests.push({ x: ch.x * W, y: ch.y * H, g, got: false });
  }
  for (const tr of EX.traps || []) {
    const rr = tr.r || 110, m = new THREE.Mesh(new THREE.CircleGeometry(rr * S, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(W3(tr.x * W, tr.y * H, .09)); add(m); ex.traps.push({ x: tr.x * W, y: tr.y * H, r: rr, m });
  }
}
function updExplore(dt) {
  const ex = B.explore, me = B.fighters[0];
  if (B.over) return;
  if (me.hp <= 0) { B.over = B.ghost; setTimeout(finish, 1800); return; }
  const mobs = B.fighters.filter(f => f.team === 1);
  for (const m of mobs) if (m.hp <= 0) { m.deadT = (m.deadT || 0) + dt; if (m.deadT > 1.8 && !m.gone) { m.gone = true; removeFighter(m); } }
  B.fighters = B.fighters.filter(f => !f.gone);
  if (ex.river) {
    const inR = me.x > ex.river.x0 && me.x < ex.river.x1;
    if (inR) { slowOn(me, .2, .75); if (Math.random() < .5) vfx.emit('glow', { x: me.root.position.x + rnd(-.7, .7), y: .2, z: me.root.position.z + rnd(-.7, .7), vy: 1, life: .7, s0: .5, s1: 0, c0: 0xffffff, c1: 0xffe9b8, a: .7, drag: 0 }); }
    ex.river.mat.emissiveIntensity = .35 + Math.sin(B.time * 2) * .08;
    ex.gates.forEach((g, i) => {
      if (g.done || me.x < g.x) return;
      g.done = true; B.hold = true; const bb = B;
      Promise.resolve(ex.onGate ? ex.onGate(i) : true).then(ok => { if (B !== bb) return; B.hold = false; if (!ok) { me.hp = 0; ui.pop(P3(me, 2.8), '가라앉는다…', '#fff3d0'); vfx.burst('glow', P3(me, 1), 40, { speed: 3, speed2: 9, life: 1, size: .8, c0: 0xffffff, c1: 0xf6ecd2 }); } });
    });
  }
  for (const c of ex.chests) if (!c.got && dist(me, c) < 80) {
    c.got = true; world.scene.remove(c.g); me.hp = Math.min(me.max, me.hp + me.max * .25); me.shieldMax = Math.max(me.shieldMax, 5000); me.shield = Math.min(me.shieldMax, me.shield + 5000);
    ui.pop(P3(me, 3.2), '🎁 체력 +25% · 보호막 +5,000', '#ffe27a', true); vfx.ring(P3(me), { r0: .5, r1: 6, dur: .7, color: 0xffd873 }); vfx.burst('spark', P3(me, 1), 40, { speed: 6, speed2: 14, life: .8, size: .5, c0: 0xffffff, c1: 0xffc233, grav: 3 });
  }
  for (const t of ex.traps) {
    t.m.material.opacity = .28 + Math.sin(B.time * 4) * .1;
    for (const f of B.fighters) if (f.team === 0 && f.hp > 0 && f.st.inv <= 0 && dist(f, t) < t.r + f.r) { f.hp = Math.max(0, f.hp - f.max * .08 * dt); f.tAcc = (f.tAcc || 0) + dt; if (f.tAcc > .8) { f.tAcc = 0; ui.pop(P3(f, 2.8), '☠ 함정!', '#ff6070'); } }
  }
  if (ex.goalX < 1.5 && me.x >= ex.goalX * W) { B.over = me; setTimeout(finish, 700); return; }
  if (ex.boss || ex.mobs) {
    const alive = mobs.filter(m => m.hp > 0).length;
    if (!alive && !ex.spawned && ex.boss) {
      ex.spawned = true; const b = addMob(ex.boss); ex.bossF = b;
      if (ex.boss.heal) B.healer = { t: 0, every: ex.boss.heal.every, pct: ex.boss.heal.pct };
      const p = P3(b); vfx.column(p, { r: 4, h: 40, dur: 1.2, color: 0x3a7bff }); for (let i = 0; i < 3; i++) vfx.ring(p, { r0: 1, r1: 10 + i * 6, dur: .7 + i * .2, color: i % 2 ? 0xffffff : 0x3a7bff }); ui.flash('#3a5bff', .6, .5); shake(.9, .6);
      ui.toast(`⚠ ${b.def.name} 등장!`);
    } else if (!alive && (ex.spawned || !ex.boss)) { B.over = me; setTimeout(finish, 1500); }
  }
}

/* ===== 던전 잡몹 (고등급 쿠키보다 훨씬 약함, 도감/뽑기에는 없음) ===== */
const mobDef = (id, name, color, hp, tag, skills, o = {}) => ({ id, name, color, cost: 0, hp, pref: 5.5, atkRange: o.range || 380, aiPref: o.pref, tag, mob: true, skills: { base: skills } });
CHARS.mob_dough = mobDef('mob_dough', '거짓 반죽 쿠키', 0xd9a066, 2600, '약한 던전 몹 · 투사체', {
  a: { name: '반죽 던지기', cd: 1.5, desc: '데미지 60', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 430, r: 11, dmg: 60, color: 0xd9a066, life: 1 }); } },
  z: { name: '반죽 폭발', cd: 10, desc: '지정 위치 500', use(f, p) { setAnim(f, 'cast', .4); const q = clampRange(f, p, 450); zone(f, { x: q.x, y: q.y, r: 85, delay: .8, dmg: 500, color: 0xd9a066 }); } },
});
CHARS.mob_jelly = mobDef('mob_jelly', '거짓 젤리 쿠키', 0xff7aa8, 2000, '약한 던전 몹 · 슬로우', {
  a: { name: '젤리 탄', cd: 1.4, desc: '데미지 50', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 450, r: 10, dmg: 50, color: 0xff7aa8, life: 1 }); } },
  x: { name: '끈적 젤리', cd: 9, desc: '데미지 250 + 슬로우', use(f) { setAnim(f, 'cast', .3); shoot(f, { a: f.face, sp: 400, r: 14, dmg: 250, color: 0xff3f7a, life: 1.2, onHit: t => slowOn(t, 2, .5) }); } },
});
CHARS.mob_soldier = mobDef('mob_soldier', '거짓 병정 쿠키', 0x9fb0c8, 3400, '약한 던전 몹 · 근접', {
  a: { name: '창 찌르기', cd: 1.3, desc: '근접 90', use(f) { setAnim(f, 'slash', .25); swing(f, 140, .9, 90, 0xcfd8ff); } },
  z: { name: '돌진 베기', cd: 8, desc: '근접 광역 400', use(f) { setAnim(f, 'slash', .3); swing(f, 190, 1.6, 400, 0xffffff); } },
}, { range: 150, pref: 90 });
CHARS.mob_mage = mobDef('mob_mage', '거짓 마법사 쿠키', 0xb57cff, 2200, '약한 던전 몹 · 마법', {
  a: { name: '마력탄', cd: 1.6, desc: '유도 70', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 380, r: 11, dmg: 70, color: 0xb57cff, kind: 'orb', life: 1.2, homing: 260, turn: 2.2 }); } },
  z: { name: '마력 폭발', cd: 11, desc: '지정 위치 700', use(f, p) { setAnim(f, 'cast', .5); const q = clampRange(f, p, 480); zone(f, { x: q.x, y: q.y, r: 100, delay: .9, dmg: 700, color: 0xb57cff }); } },
}, { pref: 300 });
/* ===== 봉인수 속 몹 ===== */
CHARS.mob_wraith = mobDef('mob_wraith', '봉인된 망령', 0x8fb0ff, 1500, '봉인수 속 망령 · 근접', {
  a: { name: '망령의 손톱', cd: 1.6, desc: '근접 60', use(f) { setAnim(f, 'slash', .25); swing(f, 150, 1, 60, 0x8fb0ff); } },
  z: { name: '원혼 폭발', cd: 10, desc: '주변 200', use(f) { setAnim(f, 'cast', .4); shock(f, 170, 0x8fb0ff, 200); } },
}, { range: 150, pref: 90 });
CHARS.mob_tree = mobDef('mob_tree', '봉인수', 0x2c6f58, 9000, '봉인수 핵 · 이동 불가', {
  a: { name: '뿌리 휘감기', cd: 3, desc: '지정 150 + 슬로우', use(f) { const e = foe(f); setAnim(f, 'cast', .3); zone(f, { x: e.x, y: e.y, r: 80, delay: .9, dmg: 150, color: 0x4cd89a, onHit: t => slowOn(t, 1.5, .5) }); } },
  z: { name: '망령 소환', cd: 16, desc: '망령 1마리 소환', use(f) { setAnim(f, 'cast', .5); for (let i = 0; i < 1; i++) addMinion('mob_wraith', clamp(f.x + rnd(-260, 260), PAD, W - PAD), clamp(f.y + rnd(-200, 200), PAD, H - PAD), { hp: 1000, realm: f.realm }); vfx.ring(P3(f), { r0: .5, r1: 9, dur: .6, color: 0x4cd89a }); } },
}, { range: 620, pref: 520 });
function addMinion(id, x, y, o = {}) {
  const d = CHARS[id], m = mkFighter(d, x, y, { kind: 'ai' });
  if (o.realm) m.realm = o.realm; m.team = 9; m.minion = true; m.awake = true; m.max = m.hp = o.hp || d.hp; m.pm = o.pm || 1; m.shield = m.shieldMax = 0; m.face = Math.PI;
  if (o.big) { m.big = o.big; m.r = 22 * o.big; } if (o.rooted) m.rooted = true;
  B.fighters.push(m); if (!o.notag) ui.addTag(m); vfx.ring(P3(m), { r0: .5, r1: 5, dur: .5, color: d.color }); return m;
}

/* ===== 사일런트솔트: 침묵의 때 (HP 10000 이하) ===== */
function enterHour(f) {
  f.form = 'hour'; const p = P3(f, 1.3);
  vfx.burst('glow', p, 90, { speed: 5, speed2: 18, life: 1.2, life2: 2, size: 1.2, c0: 0xffffff, c1: 0x05060f, up: 2 });
  vfx.burst('spark', p, 60, { speed: 6, speed2: 20, life: .8, size: .7, c0: 0xffffff, c1: 0x7d9bff });
  for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: .5, r1: 10 + i * 6, dur: .6 + i * .2, color: i % 2 ? 0xffffff : 0x7d9bff });
  shake(.9, .6); ui.flash('#05060f', .7, .6); ui.pop(P3(f, 3.8), '🌑 침묵의 때', '#cfd8ff', true);
  toast(f, '침묵의 때! 데미지·범위 +30%, 스킬이 변화합니다');
}
function hourAura(f) {
  if (Math.random() < .6) { const a = rnd(0, 6.283), d = rnd(.4, 1.4); vfx.emit('glow', { x: f.root.position.x + Math.cos(a) * d, y: rnd(.2, 2.6), z: f.root.position.z + Math.sin(a) * d, vy: rnd(1, 3), life: .8, s0: .5, s1: 0, c0: 0x05060f, c1: 0x7d9bff, a: .8, drag: 0 }); }
}

/* ===== 사일런트솔트 궁극기: 신의 은포크 심판 ===== */
function buildFork() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xe6edff, metalness: .85, roughness: .22, emissive: 0x8fb0ff, emissiveIntensity: .9 });
  for (const x of [-1.1, 0, 1.1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 6, 8), m); p.position.set(x, 3.4, 0); g.add(p);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.2, 1.2, 8), m); tip.rotation.x = Math.PI; tip.position.set(x, .3, 0); g.add(tip);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3, .4, .4), m); bar.position.y = 6.5; g.add(bar);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.32, .3, 11, 10), m); shaft.position.y = 12; g.add(shaft);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xbfd4ff, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(10); glow.position.y = 8; g.add(glow);
  g.scale.setScalar(1.7); return g;
}
function buildChains() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xcfd8e8, metalness: .9, roughness: .25, emissive: 0x6f8fff, emissiveIntensity: .8 });
  for (let i = 0; i < 16; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(.35, .1, 6, 10), m), a = i / 16 * 12.566; l.position.set(Math.cos(a) * 1.6, .3 + i / 16 * 3, Math.sin(a) * 1.6); l.rotation.set(rnd(0, 3), a, rnd(0, 3)); g.add(l); }
  return g;
}
function buildSealTree() {
  const g = new THREE.Group(), bark = new THREE.MeshStandardMaterial({ color: 0x1d2a2a, roughness: .9, emissive: 0x1a4d66, emissiveIntensity: .5 }), leaf = new THREE.MeshStandardMaterial({ color: 0x2a8f78, emissive: 0x4fe0b0, emissiveIntensity: .7, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.9, 10, 10), bark); trunk.position.y = 5; g.add(trunk);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, r = new THREE.Mesh(new THREE.BoxGeometry(.7, .6, 3.4), bark); r.position.set(Math.cos(a) * 2, .3, Math.sin(a) * 2); r.rotation.y = -a; g.add(r); }
  for (const [x, y, z, s] of [[0, 11.5, 0, 3.6], [2.2, 10, 1, 2.4], [-2, 10.4, -1.2, 2.6], [.6, 13.4, .4, 2.2]]) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaf); c.position.set(x, y, z); g.add(c); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0x7dffd0, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(16); glow.position.y = 9; g.add(glow);
  return g;
}
const addExtra = m => { world.scene.add(m); B.extra.push(m); return m; };
function startForkUlt(f) {
  if (!f.awake) { toast(f, '각성 필요: 메뉴에서 각성을 완료하세요'); return false; }
  if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
  if (B.mind || B.seal || B.abyss || B.lult || B.cut || B.forks.length) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  const foes = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && !o.minion && !o.realm);
  if (!foes.length) return false;
  f.gauge = 0; const n = Math.min(5, Math.max(2, foes.length));
  setAnim(f, 'cast', 1.4); f.pose = 'raise';
  runScript(f, [], 1.5, () => { f.pose = null; });
  for (let i = 0; i < n; i++) B.forks.push({ owner: f, t: foes[i % foes.length], i, tm: 0, T0: 1.2 + i * .7, st: 'tele', mesh: addExtra(buildFork()), dmg: Math.round(2500 * Math.pow(2.2, i)) });
  for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: .5, r1: 8 + i * 5, dur: .6 + i * .2, color: i % 2 ? 0xffffff : 0x9fb8ff });
  vfx.column(P3(f), { r: 2, h: 40, dur: 1.4, color: 0x9fb8ff, alpha: .5 });
  ui.flash('#e6efff', .5, .5); shake(.6, .5); ui.vignette(true); ui.title('신의 은포크 심판', 'JUDGMENT OF THE SILVER FORK');
  const bb = B; setTimeout(() => { if (B === bb) { ui.title('', ''); if (!bb.seal) ui.vignette(false); } }, 2600);
}
function updForks(dt) {
  if (!B.forks.length) return;
  let all = true;
  for (const k of B.forks) {
    if (k.st === 'stuck') continue;
    all = false; const t = k.t, p = P3(t); k.tm += dt;
    if (!k.tele) { k.tele = vfx.decal(p, { tex: 'rune', r: 3.4, color: 0xcfdcff, alpha: .9, spin: 2 }); k.tele2 = vfx.decal(p, { tex: 'ring', r: 3.6, color: 0xffffff, alpha: .9, y: .07 }); }
    k.tele.obj.position.x = k.tele2.obj.position.x = p.x; k.tele.obj.position.z = k.tele2.obj.position.z = p.z;
    k.mesh.position.x = p.x; k.mesh.position.z = p.z;
    if (k.st === 'tele') {
      const u = Math.min(1, k.tm / k.T0); k.mesh.position.y = lerp(70, 30, ease.out(u)); k.mesh.rotation.y += dt * 1.5; k.tele.obj.material.opacity = .4 + u * .55;
      if (k.tm >= k.T0) { k.st = 'fall'; k.fall = 0; }
    } else {
      k.fall += dt; const u = Math.min(1, k.fall / .35); k.mesh.position.y = lerp(30, 0, u * u);
      if (u >= 1) forkImpact(k);
    }
  }
  if (all && !B.fkSeq) beginChain();
  if (B.fkSeq) updChain(dt);
}
function forkImpact(k) {
  const t = k.t, f = k.owner, p = P3(t); k.st = 'stuck'; vfx.remove(k.tele); vfx.remove(k.tele2);
  erupt(p, 4.5, 0xcfdcff, 30); vfx.ring(p, { r0: 1, r1: 20, dur: .7, color: 0xffffff });
  vfx.burst('spark', p.clone().setY(1), 90, { speed: 8, speed2: 30, life: .8, life2: 1.6, size: .9, c0: 0xffffff, c1: 0x9fb8ff, grav: 4 });
  shake(1.1, .7); B.hitstop = Math.max(B.hitstop, .15); ui.flash('#e6efff', .7, .4);
  if (t.hp > 0) { if (inBarrier(f, t)) ui.pop(P3(t, 3.4), '장막이 막았다!', '#fff3b0'); else { hurt(f, t, k.dmg); k.hit = true; } }
}
function beginChain() {
  const hits = [...new Set(B.forks.filter(k => k.hit && k.t.hp > 0).map(k => k.t))];
  B.fkSeq = { t: 0, hits, chains: [], tree: null, owner: B.forks[0].owner };
  for (const t of hits) { t.st.stun = Math.max(t.st.stun, 4); const ch = addExtra(buildChains()); ch.position.copy(P3(t)); ch.scale.setScalar(.01); B.fkSeq.chains.push(ch); ui.pop(P3(t, 3.8), '⛓ 사슬 봉인!', '#cfd8ff', true); }
  if (hits.length) { B.fkSeq.tree = addExtra(buildSealTree()); B.fkSeq.tree.position.copy(P3(hits[0])); B.fkSeq.tree.scale.setScalar(.01); }
}
function updChain(dt) {
  const q = B.fkSeq; q.t += dt;
  q.chains.forEach(c => { c.rotation.y += dt * 2; c.scale.setScalar(ease.out(Math.min(1, q.t / .4))); });
  if (q.tree) { const u = ease.out(sstep(.4, 1.7, q.t)); q.tree.scale.set(u, Math.max(.01, u), u); if (Math.random() < .5) vfx.emit('glow', { x: q.tree.position.x + rnd(-2, 2), y: 0, z: q.tree.position.z + rnd(-2, 2), vy: rnd(3, 8), life: .8, s0: .6, s1: 0, c0: 0x7dffd0, drag: 0 }); }
  if (q.t < 2.1) return;
  const t = q.hits[0], f = q.owner, sealable = t && t.hp > 0 && !B.abyss && !B.lult && !B.explore && !B.raid && !B.fx && !B.mind && !B.cut;
  B.forks.forEach(k => world.scene.remove(k.mesh)); B.forks = []; B.fkSeq = null;
  q.chains.forEach(c => world.scene.remove(c));
  if (sealable) startSeal(f, t, q.tree); else if (q.tree) world.scene.remove(q.tree);
  ui.vignette(false);
}

/* ===== 봉인수 내부 ===== */
function clearStates(t) {
  if (t.ldom) endLdom(t);   // 봉인되면 빛의 아공간도 풀린다
  if (t.cast) { if (t.cast.type === 'field') endField(t); else if (t.cast.type === 'paradise') endParadise(t); else { if (t.cast.type === 'control') { const e = foe(t); e.st.ctl = 0; e.ctlBy = null; } t.cast = null; } }
  if (t.drain) endDrain(t); if (t.veil) endVeil(t); t.pose = null; t.drT = 0; t.hidden = false; t.script = null; t.st.ctl = 0; t.ctlBy = null;
}
function dropOwned(pred) {
  B.lakes.filter(pred).forEach(removeLake); B.lakes = B.lakes.filter(x => !pred(x));
  B.hexes.filter(pred).forEach(removeHex); B.hexes = B.hexes.filter(x => !pred(x));
  B.angels.filter(pred).forEach(a => world.scene.remove(a.g)); B.angels = B.angels.filter(x => !pred(x));
  B.barriers.filter(pred).forEach(removeBarrier); B.barriers = B.barriers.filter(x => !pred(x));
  B.lights.filter(pred).forEach(removeLight); B.lights = B.lights.filter(x => !pred(x));
}
function startSeal(f, t, tree) {
  clearStates(t); dropOwned(x => x.owner === t); if (B.storm && B.storm.f === t) endStorm(true);
  B.projs.forEach(p => { if (p.owner === t) killProj(p); });
  B.zones.forEach(z => { if (z.owner === t) { vfx.remove(z.tele); vfx.remove(z.tele2); if (z.mesh) world.scene.remove(z.mesh); z.done = true; z.t = 1e9; } });
  B.seal = { owner: f, target: t, ret: { x: t.x, y: t.y }, phase: 'wraith', tree, treeF: null, t: 0 }; B.viewSeal = false; camState.init = false;
  t.realm = 1; t.x = W / 2 - 330; t.y = H / 2; t.st.stun = 0; t.st.inv = 1.2; t.face = 0;
  world.setSealRealm(true); ui.flash('#bfe8ff', .9, .7); shake(.9, .6);
  if (B.fighters[0] === t) { ui.title('봉인수 내부', 'THE SEALED TREE'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2200); toast(t, '망령을 모두 쓰러뜨리고 봉인수를 부수면 봉인이 풀립니다'); }
  else toast(f, '적을 봉인수에 가뒀습니다. G키 또는 버튼으로 내부 화면을 볼 수 있어요');
  for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283 + .5; addMinion('mob_wraith', clamp(W / 2 + 80 + Math.cos(a) * 280, W / 2 - 500, W / 2 + 500), clamp(H / 2 + Math.sin(a) * 240, H / 2 - 380, H / 2 + 380), { realm: 1 }); }
}
function updSeal(dt) {
  const s = B.seal; if (!s) return; const t = s.target; s.t += dt;
  for (const m of B.fighters) if (m.minion && m.hp <= 0) { m.deadT = (m.deadT || 0) + dt; if (m.deadT > 1.2 && !m.gone) { m.gone = true; removeFighter(m); } }
  B.fighters = B.fighters.filter(m => !m.gone);
  if (t.hp <= 0 || B.over) return;
  if (s.phase === 'wraith' && !B.fighters.some(m => m.minion && m.hp > 0 && m.def.id === 'mob_wraith')) {
    s.phase = 'tree'; s.treeF = addMinion('mob_tree', W / 2 + 230, H / 2, { hp: 9000, big: 3.2, rooted: true, realm: 1 });
    ui.flash('#4cd89a', .5, .5); shake(.7, .5); ui.pop(P3(s.treeF, 7), '🌳 봉인수 출현!', '#7dffd0', true); toast(t, '봉인수를 공격하세요!');
  } else if (s.phase === 'tree' && s.treeF.hp <= 0) endSeal();
}
function endSeal() {
  const s = B.seal; if (!s) return; const t = s.target;
  B.fighters.forEach(m => { if (m.minion) removeFighter(m); }); B.fighters = B.fighters.filter(m => !m.minion);
  dropOwned(x => x.realm === 1 || (x.owner && x.owner.realm === 1)); if (B.storm && B.storm.f.realm) endStorm(true);
  B.projs.forEach(p => { if (p.realm) killProj(p); });
  B.zones.forEach(z => { if (z.realm) { vfx.remove(z.tele); vfx.remove(z.tele2); if (z.mesh) world.scene.remove(z.mesh); z.done = true; z.t = 1e9; } });
  t.realm = 0; t.x = s.ret.x; t.y = s.ret.y; B.seal = null; B.viewSeal = false; camState.init = false;
  world.setSealRealm(false);
  if (s.tree) { const p = s.tree.position.clone(); vfx.burst('glow', p.clone().setY(5), 80, { speed: 4, speed2: 14, life: 1.2, size: 1.4, c0: 0xffffff, c1: 0x4cd89a }); vfx.ring(p, { r0: 1, r1: 16, dur: .8, color: 0x7dffd0 }); world.scene.remove(s.tree); }
  becomeSealSoul(t); ui.flash('#e6efff', .8, .6); shake(.9, .6);
}
function toggleSealView() {
  const s = realmS(); if (!s || B.fighters[0] !== s.owner) return;
  B.viewSeal = !B.viewSeal; camState.init = false; ui.toast(B.viewSeal ? (B.abyss ? '드래곤의 심연 화면' : '봉인수 내부 화면') : '내 화면');
}
let sealBtn = null;
function updSealBtn() {
  if (!sealBtn) { sealBtn = document.createElement('button'); sealBtn.id = 'sealview'; sealBtn.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:80;padding:8px 16px;border-radius:999px;border:2px solid #7dffd0;background:rgba(6,22,26,.85);color:#bfffe8;font:700 14px sans-serif;display:none;cursor:pointer'; sealBtn.addEventListener('click', toggleSealView); document.body.appendChild(sealBtn); }
  const s = realmS(), show = !!(s && B.fighters[0] === s.owner); sealBtn.style.display = show ? 'block' : 'none';
  if (show) { const ab = !!B.abyss; sealBtn.textContent = B.viewSeal ? '↩ 내 화면으로 (G)' : (ab ? '👁 드래곤의 심연 보기 (G)' : '👁 봉인수 내부 보기 (G)'); sealBtn.style.borderColor = ab ? '#ff6070' : '#7dffd0'; sealBtn.style.color = ab ? '#ffc0c8' : '#bfffe8'; }
  if (B) world.viewAbyss(!!(B.abyss && !B.abyss.done && viewRealm()));
}
function becomeSealSoul(t) {
  clearStates(t); const ratio = Math.max(.01, t.hp / t.max);
  t.sealSoul = true; t.form = 'base'; t.formT = 0; t.ult.armed = false; t.gauge = 0;
  t.max = Math.max(1, Math.round(t.def.hp * .3)); t.hp = Math.max(1, Math.round(ratio * t.max)); t.shield = Math.round(t.shield * .3); t.shieldMax = Math.round(t.shieldMax * .3); t.st.inv = 1.5;
  ghostify(t, true); const p = P3(t, 1.3);
  vfx.burst('glow', p, 80, { speed: 4, speed2: 14, life: 1.4, size: 1, c0: 0xffffff, c1: 0x8fb0ff, up: 3 });
  ui.pop(P3(t, 3.8), '👻 영혼 상태로 풀려남', '#cfe0ff', true);
  toast(t, '영혼 상태: 체력 -70%, 데미지 -50%, 쿨타임 +50%, 패시브 소멸');
}

/* ===== 리치드래곤 궁극기: 드래곤의 심연 ===== */
CHARS.lich.skills.dragon.r = CHARS.lich.skills.base.r;
CHARS.lich_chaser = { ...CHARS.lich, mob: true, aiPref: 0, atkRange: 0, dragon: undefined, awake: undefined, ult: undefined, skills: { base: { a: { name: '추격', cd: 99, desc: '', use() { } } } } };
const _Y = new THREE.Vector3(0, 1, 0), _D = new THREE.Vector3();
function setLine(m, a, b) { _D.subVectors(b, a); const L = Math.max(.01, _D.length()); m.position.copy(a).addScaledVector(_D, .5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(_Y, _D.normalize()); }
function startLichUlt(f) {
  if (!f.awake) { toast(f, '각성 필요: 메뉴에서 각성을 완료하세요'); return false; }
  if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
  const e = foe(f);
  if (f.form !== 'base' || B.mind || B.seal || B.abyss || B.lult || B.cut || B.forks.length || B.explore || B.raid || B.fx || !e || e.hp <= 0 || e.minion || ally(f, e)) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  f.gauge = 0; setAnim(f, 'cast', 3); f.pose = 'float'; runScript(f, [], 4.6, () => { f.pose = null; });
  B.projs.forEach(killProj); B.projs = [];
  B.lult = { t: 0, f, e, clones: [], lines: [], glass: null, big: null, fl: {} };
  ui.vignette(true); ui.flash('#ff2038', .5, .5); ui.title('드래곤의 심연', 'THE DRAGON ABYSS');
  const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2400);
}
function updLult(dt) {
  const q = B.lult; if (!q) return; const t = q.t += dt, e = q.e, f = q.f, N = 6;
  if (e.hp <= 0 || f.hp <= 0 || B.over) { ui.glass(false); B.lult = null; ui.vignette(false); return; }
  e.st.lock = Math.max(e.st.lock, .2); const ep = P3(e, 1.3);
  while (q.clones.length < N && t >= q.clones.length * .28) {
    const i = q.clones.length, c = buildCookie(CHARS.lich), g = new THREE.Group(); g.add(c.root); g.userData = { a: i / N * 6.283 + .4 }; addExtra(g); q.clones.push(g);
    q.lines.push(addExtra(new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff2038, transparent: true, opacity: .95 }))));
    const gp = W3(e.x + Math.cos(g.userData.a) * 520, e.y + Math.sin(g.userData.a) * 520, 0); vfx.ring(gp, { r0: .5, r1: 8, dur: .6, color: 0xff2038 }); vfx.burst('heart', gp.clone().setY(1.5), 16, { speed: 4, speed2: 9, life: .9, size: .6, c0: 0xff7ae0, c1: 0xff2038 });
  }
  const pull = ease.io(sstep(2.0, 3.2, t)), R = lerp(520, 860, pull);
  q.clones.forEach((g, i) => {
    const a = g.userData.a, cx = e.x + Math.cos(a) * R, cy = e.y + Math.sin(a) * R; g.position.copy(W3(cx, cy, Math.sin(t * 3 + i) * .25));
    g.rotation.y = Math.PI / 2 - Math.atan2(e.y - cy, e.x - cx);
    const from = g.position.clone().setY(1.5); setLine(q.lines[i], from, ep); q.lines[i].material.opacity = .65 + Math.sin(t * 20 + i) * .3 * pull;
    if (pull > 0 && Math.random() < .5) vfx.emit('glow', { x: lerp(from.x, ep.x, Math.random()), y: lerp(from.y, ep.y, Math.random()), z: lerp(from.z, ep.z, Math.random()), life: .4, s0: .4, s1: 0, c0: 0xffffff, c1: 0xff2038, drag: 0 });
  });
  if (pull > 0) { shake(.2 + pull * .5, .12); e.root.position.x += Math.sin(t * 60) * .05 * pull; }
  if (t >= 3.0 && !q.glass) {
    q.glass = true; ui.glass(true); ui.flash('#ffffff', .6, .8); shake(1.3, .8); B.hitstop = Math.max(B.hitstop, .12);
    const g = new THREE.Group(); g.add(buildCookie(CHARS.lich).root); g.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .55; o.material.depthTest = false; o.renderOrder = 999; } });
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); g.position.copy(camera.position).addScaledVector(dir, 16); g.position.y -= 5.5; g.scale.setScalar(3.4); g.lookAt(camera.position); addExtra(g); q.big = g;
  }
  if (t >= 4.0 && !q.fall) { q.fall = true; ui.glassFall(); ui.flash('#ff2038', .6, .7); shake(1.6, 1); }
  if (t >= 4.6) { ui.glass(false); B.lult = null; startAbyss(f, e); }
}
function startAbyss(f, t) {
  // 적만 별도 세계(realm 1)로 보낸다. 시전자와 본 맵은 그대로 진행되고, G키로 심연 화면을 볼 수 있다.
  clearStates(t); dropOwned(x => x.owner === t); if (B.storm && B.storm.f === t) endStorm(true);
  B.extra.forEach(m => world.scene.remove(m)); B.extra = [];
  B.projs.forEach(p => { if (p.owner === t) killProj(p); });
  B.zones.forEach(z => { if (z.owner === t) { vfx.remove(z.tele); vfx.remove(z.tele2); if (z.mesh) world.scene.remove(z.mesh); z.done = true; z.t = 1e9; } });
  const A = B.abyss = { owner: f, target: t, ret: { x: t.x, y: t.y }, t: 0, open: false, caught: 0, meshes: [], portal: { x: W / 2 - 1250, y: H / 2 + (Math.random() < .5 ? -520 : 520) } };
  B.viewSeal = false; camState.init = false; f.pose = null; f.cast = null;
  t.realm = 1; t.x = W / 2 - 650; t.y = H / 2; t.st.stun = 0; t.st.lock = 0; t.st.inv = 1;
  world.setAbyss(true); ui.flash('#ff2038', .9, .8); shake(.9, .6);
  if (B.fighters[0] === t) { ui.title('드래곤의 심연', '추격자를 피해 출구로 탈출하세요'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2600); }
  else toast(f, '적을 드래곤의 심연에 가뒀습니다. G키 또는 버튼으로 심연 화면을 볼 수 있어요');
  // 기둥(장애물)
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a0a10, roughness: .7, emissive: 0x5a0a18, emissiveIntensity: .5, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const x = W / 2 + rnd(-1500, 1300), y = H / 2 + rnd(-800, 800); if (Math.hypot(x - t.x, y - t.y) < 260 || Math.hypot(x - (W / 2 + 500), y - H / 2) < 260 || Math.hypot(x - A.portal.x, y - A.portal.y) < 240) continue;
    B.objs.push({ x, y, r: 70, realm: 1 }); const m = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 11, 7), mat); m.position.copy(P3({ x, y, realm: 1 }, 5.5)); addExtra(m); A.meshes.push(m);
  }
  // 출구(닫힘 → 10초 후 열림)
  const pm = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, .35, 10, 40), new THREE.MeshBasicMaterial({ color: 0x555566 })); ring.position.y = 3.6; pm.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 40, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x555566, transparent: true, opacity: .3, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 20; pm.add(beam);
  pm.position.copy(P3({ x: A.portal.x, y: A.portal.y, realm: 1 }, 0)); addExtra(pm); A.pm = pm; A.ring = ring; A.beam = beam; A.meshes.push(pm);
  // 추격자
  const c = A.chaser = addMinion('lich_chaser', W / 2 + 500, H / 2, { notag: true, realm: 1 }); c.st.inv = 1e9; c.spdBoost = 1.12; c.face = Math.PI;
  t.st.silence = Math.max(t.st.silence, 1);
  toast(t, '드래곤의 심연! 10초 뒤 출구가 열립니다. 추격자에게 잡히지 마세요');
}
function updAbyss(dt) {
  const A = B.abyss; if (!A || A.done) return; const t = A.target, c = A.chaser; A.t += dt;
  if (B.over) return;
  const vw = viewRealm(); if (A.vig !== vw) { A.vig = vw; ui.vignette(vw); ui.cinema(vw && A.caught > 0); }
  t.st.silence = Math.max(t.st.silence, .5);
  if (!A.open && A.t >= 10) { A.open = true; A.ring.material.color.set(0x7dffd0); A.beam.material.color.set(0x7dffd0); A.beam.material.opacity = .5; ui.flash('#7dffd0', .4, .4); ui.pop(P3(t, 3.8), '🚪 출구가 열렸다!', '#7dffd0', true); toast(t, '출구가 열렸습니다!'); }
  if (A.open) { A.ring.rotation.z += dt * 2; if (Math.random() < .6) vfx.emit('glow', { x: A.pm.position.x + rnd(-2, 2), y: 0, z: A.pm.position.z + rnd(-2, 2), vy: rnd(3, 9), life: .8, s0: .6, s1: 0, c0: 0x7dffd0, drag: 0 }); }
  else A.ring.material.color.setHex(Math.floor(A.t * 4) % 2 ? 0x777788 : 0x444455);
  if (A.caught) {
    A.caught += dt; const u = A.caught;
    for (const [i, at] of [.3, .8, 1.3, 1.8].entries()) if (u >= at && !(A['s' + i])) {
      A['s' + i] = 1; const ec = P3(t, 1.5); vfx.slashBB(ec, { rot: (i % 2 ? 1 : -1) * (.5 + i * .3), len: 8, color: 0xffffff }); vfx.slashBB(ec, { rot: (i % 2 ? -.7 : .7), len: 6, color: 0xff2038 });
      vfx.burst('spark', ec, 40, { speed: 8, speed2: 22, life: .6, size: .7, c0: 0xffffff, c1: 0xff2038, grav: 4 }); shake(1, .5); B.hitstop = Math.max(B.hitstop, .12); ui.flash('#ff2038', .5, .35);
    }
    if (u >= 3) endAbyss(false);
    return;
  }
  if (dist(c, t) < c.r + t.r + 14) {
    A.caught = .01; t.st.stun = 99; c.st.stun = 99; if (vw) { ui.cinema(true); ui.title('붙잡혔다…', '리치드래곤 쿠키의 도끼'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2600); }
    ui.pop(P3(t, 3.8), '붙잡혔다!', '#ff6070', true); return;
  }
  if (A.open && dist(t, A.portal) < 95) { endAbyss(true); return; }
  if (A.t > 70) A.caught = .01;
}
function endAbyss(escaped) {
  const A = B.abyss; if (!A) return; const t = A.target; A.done = true;
  B.fighters.forEach(m => { if (m.minion && m.realm === 1) removeFighter(m); }); B.fighters = B.fighters.filter(m => !(m.minion && m.realm === 1));
  A.meshes.forEach(m => world.scene.remove(m));
  B.objs = B.objs.filter(o => o.realm !== 1);
  dropOwned(x => x.realm === 1 || (x.owner && x.owner.realm === 1)); if (B.storm && B.storm.f.realm) endStorm(true);
  B.projs.forEach(p => { if (p.realm) killProj(p); });
  B.zones.forEach(z => { if (z.realm) { vfx.remove(z.tele); vfx.remove(z.tele2); if (z.mesh) world.scene.remove(z.mesh); z.done = true; z.t = 1e9; } });
  t.realm = 0; t.x = A.ret.x; t.y = A.ret.y; B.abyss = null; B.viewSeal = false; camState.init = false;
  world.setAbyss(false); ui.vignette(false); ui.cinema(false); t.st.stun = 0; t.st.silence = 0; t.st.inv = 1; ui.flash('#ffffff', .8, .6); shake(.8, .5);
  if (escaped) {
    t.permRev = true; t.permSlow = true; t.mindOpen = true;
    ui.pop(P3(t, 3.8), '🏃 심연에서 탈출!', '#7dffd0', true); ui.pop(P3(t, 5), '🔄 방향키 영구 반전 · 🐌 영구 슬로우 · 🧠 정신계 공격 적용', '#ff9ac8', true);
    toast(t, '탈출했지만… 이 경기 동안 방향키 반전·슬로우가 계속되고, 정신계 공격에 노출됩니다');
  } else {
    t.st.stun = 30; ui.pop(P3(t, 3.8), '💫 30초 스턴!', '#ff6070', true); toast(t, '붙잡혀 30초간 기절합니다');
  }
}

/* ===== 버닝스파이스 쿠키 (비스트, HP 32000, 보호막 없음) ===== */
const BRN = 0xff6a1a;
function burnOn(t, src, dur = 4, dps = 300) {   // 화상: 0.5초마다 도트 피해
  if (!t || t.hp <= 0 || t.undy > 0) return;
  t.burn = { t: Math.max(dur, t.burn ? t.burn.t : 0), dps: Math.max(dps, t.burn ? t.burn.dps : 0), src, tick: .5 };
  ui.pop(P3(t, 3.2), '🔥 화상', '#ff8a30');
}
// 입력을 막고 매 프레임 upd(u, dt)를 돌리는 연속 동작 (끝나면 upd(1,0) 한 번 더 호출)
function act(f, dur, upd, end) { f.script = { t: 0, steps: [], end: dur, onEnd: () => { if (f.act) f.act.upd(1, 0); f.act = null; end && end(); } }; f.act = { t: 0, dur, upd }; }
function updCommon(f, dt) {   // 전 캐릭터 공통: 화상, 불사, 거대화, 수명, 자연 회복
  if (f.hp <= 0) { f.burn = null; return; }
  if (f.def.id === 'pva') { for (const k of ['slow', 'silence', 'stun', 'charm', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) f.st[k] = 0; f.burn = null; f.mindBuff = false; }   // 각성 퓨어바닐라: 디버프 면역
  if (f.undy > 0) {
    f.undy -= dt; const p = P3(f, 1.2);
    if (Math.random() < .7) vfx.emit('glow', { x: p.x + rnd(-.7, .7), y: rnd(.2, 2.6), z: p.z + rnd(-.7, .7), vy: rnd(2, 6), life: .6, s0: .6, s1: 0, c0: 0xffd070, c1: 0xff3a00, drag: 0 });
    if (f.undy <= 0) { f.undy = 0; f.hp = 0; ui.pop(P3(f, 3.6), '💀 불사 종료', '#ff6070', true); onDeath(f); return; }
  }
  if (f.burn) {
    f.burn.t -= dt; f.burn.tick -= dt; const p = P3(f, 1);
    if (Math.random() < .8) vfx.emit('glow', { x: p.x + rnd(-.5, .5), y: rnd(.3, 2.2), z: p.z + rnd(-.5, .5), vy: rnd(2, 5), life: .5, s0: .5, s1: 0, c0: 0xffc060, c1: 0xff3a00, drag: 0 });
    if (f.burn.tick <= 0) { f.burn.tick = .5; const d = f.burn.dps * .5; hurt(f.burn.src, f, d, { quiet: true, field: true }); ui.pop(P3(f, 2.8), Math.round(d), '#ff8a30'); }
    if (f.burn.t <= 0) f.burn = null;
  }
  if (f.giant > 0) { f.giant -= dt; if (f.giant <= 0) { f.giant = 0; f.r = 22; ui.pop(P3(f, 4), '거대화 종료', '#ffb070'); } }
  if (f.ttl !== undefined && f.hp > 0) { f.ttl -= dt; if (f.ttl <= 0) { f.hp = 0; vfx.burst('spark', P3(f, 1.2), 24, { speed: 4, speed2: 10, life: .6, size: .5, c0: 0xffffff, c1: BRN }); } }
  // 자연 회복: 공격도 피격도 없이 5초가 지나면 초당 최대 체력의 1.2%
  if (f.hp < f.max && !f.undy && !f.minion && !f.def.mob && !(B.raid && f === B.raid.boss) && !(B.fx && f !== B.fighters[0]) && B.time - (f.cmb ?? -99) > 5) {
    const h = Math.min(f.max - f.hp, f.max * .012 * dt); f.hp += h; f.regenAcc = (f.regenAcc || 0) + h;
    if (f.regenAcc >= f.max * .03) { ui.pop(P3(f, 3.2), '+' + Math.round(f.regenAcc), '#7dff9b'); f.regenAcc = 0; }
  }
}
function startUndy(t) {   // 버닝스파이스 패시브: 죽으면 10초 불사
  t.undyUsed = true; t.undy = 10; t.hp = 1; t.shield = 0; t.burn = null; clearStates(t);
  for (const k of ['stun', 'silence', 'slow', 'lock', 'rev', 'charm', 'ctl']) t.st[k] = 0; t.flash = 0;
  const p = P3(t, 1.3);
  vfx.burst('glow', p, 80, { speed: 4, speed2: 16, life: 1, life2: 1.8, size: 1.2, c0: 0xffffff, c1: 0xff3a00, up: 3 }); vfx.burst('spark', p, 50, { speed: 6, speed2: 18, life: .8, size: .6, c0: 0xffe090, c1: 0xff4a10, grav: 3 });
  vfx.ring(P3(t), { r0: .5, r1: 12, dur: .8, color: BRN }); vfx.column(P3(t), { r: 2, h: 26, dur: 1, color: 0xff6a1a, alpha: .7 }); shake(1, .6); ui.flash('#ff6a1a', .6, .5);
  ui.pop(P3(t, 3.8), '🔥 불사!', '#ffb050', true); toast(t, '불사! 10초 안에 적을 쓰러뜨리면 체력 1000을 회복합니다');
}
function undyKill(s) {
  s.undy = 0; s.hp = Math.min(s.max, s.hp + 1000);
  vfx.ring(P3(s), { r0: .5, r1: 9, dur: .7, color: 0x7dff9b }); vfx.burst('glow', P3(s, 1.3), 40, { speed: 3, speed2: 10, life: .9, size: .9, c0: 0xffffff, c1: 0x7dff9b, up: 3 });
  ui.pop(P3(s, 3.8), '🔥 +1000 되살아났다!', '#7dff9b', true); toast(s, '불사 중 처치! 체력 1000 회복');
}
function breakTerrain(cx, cy, R) {   // 반경 안의 지형지물(충돌+모델)을 부순다
  B.objs = B.objs.filter(o => o.realm || Math.hypot(o.x - cx, o.y - cy) >= R + o.r);
  const gone = world.breakProps(cx, cy, R);
  for (const p of gone) { const w = W3r(p.x, p.y, 1.2); vfx.burst('spark', w, 26, { speed: 6, speed2: 18, life: .9, life2: 1.5, size: .7, c0: 0xffffff, c1: BRN, grav: 8 }); vfx.burst('glow', w, 8, { speed: 2, speed2: 6, life: 1, size: 1.6, c0: 0xffa050, c1: 0x401000, up: 2 }); vfx.ring(W3r(p.x, p.y, 0), { r0: .5, r1: Math.max(4, (p.r || 60) * S * 1.6), dur: .5, color: BRN }); }
  const c = W3r(cx, cy, 0); vfx.ring(c, { r0: 1, r1: R * S, dur: .8, color: BRN }); vfx.ring(c, { r0: 1, r1: R * S * .7, dur: 1, color: 0xffd070, alpha: .6 }); vfx.column(c, { r: R * S * .25, h: 30, dur: .8, color: 0xff6a1a, alpha: .6 });
  return gone.length;
}
CHARS.mob_spice = mobDef('mob_spice', '향신료 병사', BRN, 2400, '버닝스파이스의 군단 · 근접', {
  a: { name: '향신료 칼날', cd: 1.2, desc: '근접 200 + 화상', use(f) { setAnim(f, 'slash', .25); swing(f, 135, 1.1, 200, 0xffa040).forEach(t => { if (Math.random() < .4) burnOn(t, f, 3, 150); }); } },
}, { range: 140, pref: 80 });
function summonLegion(f) {
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  B.fighters.forEach(m => { if (m.legion && m.legionOf === f && m.hp > 0) m.hp = 0; });
  for (let i = 0; i < 4; i++) {
    const a = f.face + (i - 1.5) * .8, x = clamp(f.x + Math.cos(a) * 190, PAD, W - PAD), y = clamp(f.y + Math.sin(a) * 190, PAD, H - PAD);
    const m = addMinion('mob_spice', x, y, { hp: 2400, pm: f.pm || 1, realm: f.realm, notag: true });
    m.team = f.team; m.legion = true; m.legionOf = f; m.ttl = 24; m.face = f.face;
    vfx.burst('glow', P3(m, 1), 20, { speed: 3, speed2: 8, life: .7, size: .8, c0: 0xffd070, c1: 0xff3a00, up: 2 });
  }
}
function leapSlam(f, t) {   // 도끼가 맞으면: 하늘로 뛰어올라 떨어지며 내려찍기 (무적/아공간/보호의 장막도 뚫는다)
  if (f.hp <= 0 || f.script) return;
  const sx = f.x, sy = f.y; let done = false;
  f.st.inv = Math.max(f.st.inv, 1.4); f.pose = 'leap'; setAnim(f, 'cast', .3);
  act(f, 1.3, u => {
    if (u < .4) f.air = 13 * ease.out(u / .4);
    else if (u < .75) { f.air = 13; const k = ease.io((u - .4) / .35); f.face = ang(f, t); f.x = lerp(sx, t.x, k); f.y = lerp(sy, t.y, k); }
    else { f.air = 13 * (1 - ((u - .75) / .25) ** 2); f.x = t.x; f.y = t.y; }   // 낙하 중에도 끝까지 따라가서 무조건 맞는다
    if (u > .04 && Math.random() < .8) vfx.emit('glow', { x: f.root.position.x + rnd(-.6, .6), y: f.root.position.y + rnd(0, 2), z: f.root.position.z + rnd(-.6, .6), vy: -2, life: .5, s0: .8, s1: 0, c0: 0xffc060, c1: 0xff3a00, drag: 0 });
    if (u >= .99 && !done) {
      done = true; f.air = 0; f.pose = null; f.st.inv = 0; setAnim(f, 'slash', .3);
      // 내려찍기는 무조건 적중: 아공간/투명화/무적도 뚫는다 (도끼에 맞은 대상 한정)
      if (t.hp > 0 && realmOf(t) === realmOf(f)) {
        if (t.cast && t.cast.type === 'sub') { t.cast = null; t.st.stun = Math.max(t.st.stun, .8); ui.pop(P3(t, 3.6), '아공간 파괴!', '#ffb050', true); }
        t.hidden = false; t.st.inv = 0; t.bushHid = false;
      }
      const brs = B.barriers.filter(b => !b.noBreak && (b.owner === t || ally(b.owner, t)) && Math.hypot(t.x - b.x, t.y - b.y) < b.r + 200);   // 퓨어바닐라 장막: 내려찍는 순간 장막을 부순다
      if (brs.length) { brs.forEach(removeBarrier); B.barriers = B.barriers.filter(b => !brs.includes(b)); ui.pop(P3(t, 4.2), '장막 파괴!', '#ffb050', true); }
      shock(f, 200, BRN, 2500, tt => burnOn(tt, f, 5, 350));
      const c = P3(f); vfx.column(c, { r: 2.6, h: 28, dur: .7, color: 0xff6a1a, alpha: .8 }); vfx.burst('spark', P3(f, .6), 60, { speed: 8, speed2: 24, life: .8, size: .7, c0: 0xffffff, c1: BRN, grav: 6 }); vfx.ring(c, { r0: .5, r1: 14, dur: .6, color: 0xffd070 });
      shake(1.2, .5); B.hitstop = Math.max(B.hitstop, .12); ui.flash('#ff8a30', .5, .3);
    }
  }, () => { f.air = 0; f.pose = null; f.st.inv = 0; });
}
function dashV(f) {   // 돌진: 맞추면 컷신
  const e = foe(f);
  if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 900) { toast(f, '사거리 밖'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  setAnim(f, 'slash', .2); f.pose = 'leap'; f.st.inv = Math.max(f.st.inv, .8); let hit = false;
  act(f, .75, (u, dt) => {
    if (hit) return;
    const a = ang(f, e); f.face = a; f.x = clamp(f.x + Math.cos(a) * 2400 * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * 2400 * dt, PAD, H - PAD);
    const p = P3(f, 1.2); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .4, s0: 1.2, s1: 0, c0: 0xffc060, c1: 0xff3a00, drag: 0 });
    if (e.hp > 0 && dist(f, e) < f.r + e.r + 24) {
      hit = true; f.script = null; f.act = null; f.pose = null; f.st.inv = 0;
      const hp0 = e.hp + e.shield; hurt(f, e, 2000, { dir: a });
      if (e.hp > 0 && e.hp + e.shield < hp0) startBurnCut(f, e); else if (e.hp > 0) ui.pop(P3(e, 3.4), '막힘!', '#fff3b0');
    }
  }, () => { if (!hit) { f.pose = null; f.st.inv = 0; ui.pop(P3(f, 3.4), '빗나감', '#ffb070'); } });
}
CHARS.burn = {
  id: 'burn', name: '버닝스파이스 쿠키', color: BRN, fx: 0xff7a24, cost: 1000, hp: 32000, pref: 3.6, atkRange: 125, aiPref: 85, tag: '화염 · 근접 도끼 · 패시브: 불사',
  passive: '죽으면 10초 동안 불사 상태가 되어 적을 계속 공격할 수 있습니다. 불사가 풀리기 전에 적을 쓰러뜨리면 체력 1000을 회복하고 되살아납니다. (한 경기에 1번)',
  skills: {
    base: {
      a: { name: '도끼질', cd: .5, desc: '도끼로 4연타(400). 마지막 타격에 화상. 거대화 중에는 1000', use(f) {
        let n = B.time - (f.comboT ?? -9) < 1.5 ? (f.combo || 0) + 1 : 1; if (n > 4) n = 1; f.combo = n; f.comboT = B.time;
        const g = f.giant > 0, last = n === 4, rg = g ? 175 : 120;
        setAnim(f, 'slash', last ? .35 : .22); f.swingDir = n % 2 ? 1 : -1;
        const hits = swing(f, last ? rg * 1.25 : rg, last ? 1.5 : 1.0, g ? 1000 : 400, last ? 0xffd070 : BRN);
        if (last) { hits.forEach(t => burnOn(t, f, 4, 300)); const c = P3(f, .9).add(new THREE.Vector3(Math.cos(f.face), 0, Math.sin(f.face)).multiplyScalar(rg * S * .8)); vfx.burst('spark', c, 24, { speed: 6, speed2: 14, life: .6, size: .6, c0: 0xffffff, c1: BRN, grav: 4 }); shake(.4, .2); }
        f.cd.a = last ? 1.0 : .5; return 'nocd';
      } },
      z: { name: '거대화', cd: 24, desc: '10초간 거대하게 변해 받는 피해 35% 감소, 평타 데미지 1000', use(f) {
        setAnim(f, 'cast', .5); f.giant = 10; f.r = 34;
        vfx.ring(P3(f), { r0: 1, r1: 12, dur: .7, color: BRN }); vfx.burst('glow', P3(f, 1.2), 60, { speed: 4, speed2: 14, life: 1, size: 1.2, c0: 0xffffff, c1: 0xff3a00, up: 3 });
        shake(.8, .4); ui.pop(P3(f, 4.4), '🔥 거대화!', '#ffb050', true);
      } },
      x: { name: '도끼 투척', cd: 9, desc: '도끼를 던져 2000. 맞으면 하늘로 뛰어올라 상대에게 떨어지며 내려찍어 2500 + 화상', use(f) {
        setAnim(f, 'slash', .3); shoot(f, { a: f.face, sp: 820, r: 26, dmg: 2000, color: BRN, kind: 'axe', life: 1.05, onHit: t => leapSlam(f, t) });
      } },
      c: { name: '분노의 포효', cd: 38, desc: '포효로 주위 지형을 파괴하고 1500 피해, 향신료 군단 4기를 24초간 소환', use(f) {
        setAnim(f, 'cast', .8); f.pose = 'raise';
        runScript(f, [{ at: .55, fn: () => {
          shock(f, 380, BRN, 1500); if (!f.realm) breakTerrain(f.x, f.y, 560); summonLegion(f);
          for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: .5, r1: 10 + i * 8, dur: .6 + i * .2, color: i % 2 ? 0xffd070 : BRN });
          ui.flash('#ff8a30', .7, .5); shake(1.3, .8); ui.pop(P3(f, 4.2), '🔥 분노의 포효!', '#ffb050', true);
        } }], 1.0, () => { f.pose = null; });
      } },
      v: { name: '불꽃의 심판', cd: 40, desc: '적에게 돌진해 맞추면 2000 + [컷신] 도끼질 연타 후 내려찍어 주위가 파괴되고 적이 소멸(5000). 못 맞추면 헛스윙', use(f) { return dashV(f); } },
    }
  }
};
/* 버닝스파이스 컷신: 돌진 적중 → 연속 도끼질 → 도약 → 내려찍기 → 소멸 */
function startBurnCut(f, e) {
  B.projs.forEach(killProj); B.projs = [];
  B.cut = { kind: 'burn', t: 0, dur: 8.8, f, e, fl: {}, hits: 0, a0: ang(e, f) };
  world.setCut(true); ui.cinema(true); camera.near = .1; ui.title(f.def.name, 'BURNING SPICE');
  f.x = e.x + Math.cos(B.cut.a0) * 150; f.y = e.y + Math.sin(B.cut.a0) * 150; f.face = ang(f, e); f.pose = 'raise'; e.anim = null; f.air = 0;
}
function updBurnCut(dt) {
  const c = B.cut, f = c.f, e = c.e, t = c.t += dt, fl = c.fl, fw = P3(f, 0), ew = P3(e, 0), ec = P3(e, 1.5);
  f.root.position.set(fw.x, f.air || 0, fw.z);   // 컷신 주인공은 animate 가 위치를 안 건드린다
  const dv = ew.clone().sub(fw).setY(0); if (dv.lengthSq() < .01) dv.set(1, 0, 0); dv.normalize();
  const side = new THREE.Vector3(-dv.z, 0, dv.x);
  let pos, look, fov;
  if (t < 1.2) {                      // ① 도끼를 치켜든 대치
    const u = t / 1.2; f.pose = 'raise'; f.face = ang(f, e);
    if (Math.random() < .8) vfx.emit('glow', { x: fw.x + rnd(-1, 1), y: rnd(0, 3), z: fw.z + rnd(-1, 1), vy: rnd(3, 8), life: .7, s0: .6, s1: 0, c0: 0xffc060, c1: 0xff3a00, drag: 0 });
    if (u > .6 && !fl.a) { fl.a = 1; ui.flash('#ff6a1a', .5, .3); ui.title('', ''); }
    pos = fw.clone().addScaledVector(dv, -lerp(7, 5, u)).addScaledVector(side, lerp(3, 2, u)).add(new THREE.Vector3(0, lerp(1.4, 2.2, u), 0)); look = fw.clone().addScaledVector(dv, 1.5).add(new THREE.Vector3(0, 2, 0)); fov = lerp(40, 34, u);
  } else if (t < 4.0) {               // ② 이리저리 빠르게 도끼질 (25타 × 100)
    const n = Math.min(25, Math.floor((t - 1.2) / .11));
    while (c.hits < n) {
      c.hits++; const i = c.hits, a = rnd(0, 6.283); f.x = e.x + Math.cos(a) * 130; f.y = e.y + Math.sin(a) * 130; f.face = ang(f, e); f.pose = null; setAnim(f, 'slash', .1); f.swingDir = i % 2 ? 1 : -1;
      const hc = ec.clone().add(new THREE.Vector3(rnd(-.6, .6), rnd(-.5, .5), rnd(-.6, .6)));
      vfx.slashBB(hc, { rot: rnd(-1.5, 1.5), len: rnd(6, 11), color: i % 2 ? 0xffffff : BRN }); vfx.burst('spark', hc, 14, { speed: 6, speed2: 16, life: .45, size: .5, c0: 0xffffff, c1: BRN, grav: 4 });
      hurt(f, e, 100, { quiet: true }); ui.pop(P3(e, 2.4 + rnd(0, 1.4)), '100', '#ffb050'); if (i % 3 === 0) { shake(.5, .15); ui.flash('#ff8a30', .2, .1); }
    }
    const an = t * 2.4;
    pos = ew.clone().add(new THREE.Vector3(Math.cos(an) * 6.5, 2.4 + Math.sin(t * 3) * .6, Math.sin(an) * 6.5)); look = ec.clone(); fov = 40;
  } else if (t < 5.2) {               // ③ 하늘 높이 도약
    const u = (t - 4.0) / 1.2;
    if (!fl.b) { fl.b = 1; f.x = e.x + Math.cos(c.a0) * 70; f.y = e.y + Math.sin(c.a0) * 70; f.face = ang(f, e); setAnim(f, 'cast', .4); ui.flash('#ffd070', .5, .3); vfx.ring(P3(f), { r0: .5, r1: 9, dur: .5, color: BRN }); }
    f.pose = 'leap'; f.air = 16 * ease.out(u);
    const p = P3(f, 0); if (Math.random() < .9) vfx.emit('glow', { x: p.x + rnd(-.8, .8), y: f.air + rnd(0, 2), z: p.z + rnd(-.8, .8), vy: -3, life: .6, s0: 1, s1: 0, c0: 0xffc060, c1: 0xff3a00, drag: 0 });
    pos = ew.clone().addScaledVector(side, 9).add(new THREE.Vector3(0, lerp(2, 4, u), 0)).addScaledVector(dv, -3); look = ew.clone().add(new THREE.Vector3(0, lerp(2, 10, u), 0)); fov = lerp(40, 54, u);
  } else if (t < 5.5) {               // ④ 쿵! 내려찍기
    const u = (t - 5.2) / .3; f.air = 16 * (1 - u * u);
    pos = ew.clone().addScaledVector(side, lerp(9, 6, u)).add(new THREE.Vector3(0, lerp(4, 2.5, u), 0)).addScaledVector(dv, -3); look = ew.clone().add(new THREE.Vector3(0, lerp(10, 1.5, u), 0)); fov = lerp(54, 46, u);
    if (u >= .98 && !fl.s) {
      fl.s = 1; f.air = 0; f.pose = null; setAnim(f, 'slash', .4);
      hurt(f, e, 2500, { dir: ang(f, e) });
      if (!f.realm) breakTerrain(e.x, e.y, 950);
      e.root.visible = false;   // 적이 불꽃 속에 소멸
      vfx.burst('glow', ec, 120, { speed: 4, speed2: 22, life: 1.4, life2: 2.4, size: 1.6, c0: 0xffffff, c1: 0xff3a00, up: 6 }); vfx.burst('spark', ec, 140, { speed: 8, speed2: 30, life: 1, life2: 2, size: .7, c0: 0xffffff, c1: BRN, grav: 6 });
      for (let i = 0; i < 4; i++) vfx.ring(ew, { r0: 1, r1: 18 + i * 10, dur: .6 + i * .25, color: i % 2 ? 0xffd070 : BRN }); vfx.column(ew, { r: 4, h: 60, dur: 1.6, color: 0xff6a1a, alpha: .8 }); vfx.column(ew, { r: 1.6, h: 60, dur: 1.4, color: 0xffffff, alpha: .8 });
      ui.flash('#ffffff', 1, .9); shake(2, 1.1);
    }
  } else if (t < 7.4) {               // ⑤ 잿더미 속 여운
    const u = (t - 5.5) / 1.9; f.pose = 'stab2'; f.air = 0;
    if (Math.random() < .9) vfx.emit('glow', { x: ew.x + rnd(-9, 9), y: rnd(2, 12), z: ew.z + rnd(-9, 9), vy: rnd(-2, 3), life: 1.2, s0: .7, s1: 0, c0: 0xffa050, c1: 0x401000, a: .8, drag: 0 });
    if (t > 6.9 && !fl.r) { fl.r = 1; if (e.hp > 0) { e.root.visible = true; vfx.ring(ew, { r0: .5, r1: 8, dur: .6, color: 0xffffff }); } }
    pos = ew.clone().addScaledVector(side, lerp(7, 11, u)).add(new THREE.Vector3(0, lerp(3, 8, u), 0)).addScaledVector(dv, -4); look = ew.clone().add(new THREE.Vector3(0, 1.5, 0)); fov = lerp(46, 50, u);
  } else {                            // ⑥ 게임 화면 복귀
    const u = Math.min(1, (t - 7.4) / 1.4), g = gameCamPose();
    if (!fl.e) { fl.e = 1; e.root.visible = true; world.setCut(false); ui.cinema(false); ui.title('', ''); f.pose = null; f.air = 0; }
    pos = camState.pos.clone().lerp(g.pos, ease.io(u)); look = camState.look.clone().lerp(g.look, ease.io(u)); fov = lerp(camState.fov, g.fov, ease.io(u));
    if (t >= c.dur) { B.cut = null; f.pose = null; f.air = 0; camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov; return; }
  }
  camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov;
}
/* ===== 세인트릴리 쿠키 (HP 23000, 원거리 꽃 마법사 / 서포터) ===== */
const LILY = 0xffc8ea, LILYG = 0x6fe0a0;
function addFxm(m, dur, fn) { addExtra(m); B.fxm.push({ m, t: 0, dur, fn }); }   // 시간에 따라 움직이는 연출용 메시
function updFxm(dt) {
  for (const q of B.fxm) { q.t += dt; q.fn(Math.min(1, q.t / q.dur), q.m, q.t); }
  B.fxm = B.fxm.filter(q => { if (q.t >= q.dur) { world.scene.remove(q.m); return false; } return true; });
}
function stemFx(x, y, delay) {   // 거대한 줄기가 솟아 내려친다
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x3fae5e, emissive: 0x14602a, emissiveIntensity: .5, roughness: .6, flatShading: true });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(.6, 1.4, 17, 8).translate(0, 8.5, 0), mat));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff9ad0, emissive: 0xff5aa8, emissiveIntensity: .8 })); tip.position.y = 17; g.add(tip);
  g.position.copy(W3(x, y, 0)); g.scale.setScalar(.01); let hit = false; const T = delay + .8;
  addFxm(g, T, (u, m, t) => {
    const k = t < delay ? ease.out(t / delay) : 1 - sstep(delay + .3, T, t); m.scale.setScalar(Math.max(.01, k)); m.rotation.x = t < delay ? lerp(-.9, .12, ease.out(t / delay)) : .12; m.rotation.z = Math.sin(t * 9) * .04;
    if (t >= delay && !hit) { hit = true; const c = W3(x, y, 0); vfx.ring(c, { r0: .5, r1: 8, dur: .45, color: LILYG }); vfx.burst('spark', c.clone().setY(.8), 22, { speed: 6, speed2: 16, life: .6, size: .6, c0: 0xffffff, c1: LILYG, grav: 6 }); shake(.45, .2); }
  });
}
function thornFx(x, y, r, dur) {   // 가시밭
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x2f8a4c, emissive: 0x0f4a22, emissiveIntensity: .5, flatShading: true });
  for (let i = 0; i < 26; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * r * S, h = rnd(2.2, 4.6), c = new THREE.Mesh(new THREE.ConeGeometry(.28, h, 5).translate(0, h / 2, 0), mat); c.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); c.rotation.set(rnd(-.35, .35), 0, rnd(-.35, .35)); c.userData.d = rnd(0, .35); g.add(c); }
  g.position.copy(W3(x, y, 0));
  addFxm(g, dur, (u, m, t) => { m.children.forEach(c => { const k = ease.out(Math.min(1, Math.max(0, (t - c.userData.d) / .25))) * (1 - sstep(dur - .5, dur, t)); c.scale.setScalar(Math.max(.01, k)); }); });
}
function buildLilyMesh(R) {   // 거대한 백합꽃
  const g = new THREE.Group(), pm = new THREE.MeshStandardMaterial({ color: 0xfff6fb, emissive: 0xff9ad8, emissiveIntensity: .45, roughness: .45, side: THREE.DoubleSide });
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 6; i++) {
    const pv = new THREE.Object3D(); pv.rotation.order = 'YXZ'; pv.rotation.y = i / 6 * 6.283 + ring * .52; pv.rotation.x = -(.55 + ring * .5);
    const pt = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), pm); pt.scale.set(R * .2, R * .03, R * (.62 - ring * .1)); pt.position.z = R * (.56 - ring * .08); pv.add(pt); g.add(pv);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(R * .09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe066 })); core.position.y = R * .12; g.add(core);
  for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283, st = new THREE.Mesh(new THREE.CylinderGeometry(R * .008, R * .008, R * .3).translate(0, R * .15, 0), new THREE.MeshBasicMaterial({ color: 0xfff6f0 })); st.position.set(Math.cos(a) * R * .06, 0, Math.sin(a) * R * .06); st.rotation.z = Math.cos(a) * .4; st.rotation.x = Math.sin(a) * .4; g.add(st); }
  return g;
}
function breakDomains(t) {   // 상대의 영역(필드/호수/아공간/장막/낙원/폭풍우 등)을 부순다
  let n = 0; const mine = x => x.owner === t;
  if (t.cast && t.cast.type === 'field') { endField(t); n++; }
  if (t.cast && t.cast.type === 'paradise') { endParadise(t); n++; }
  if (t.veil) { endVeil(t); n++; }
  if (B.storm && B.storm.f === t) { endStorm(true); n++; }
  n += B.lakes.filter(mine).length + B.hexes.filter(mine).length + B.angels.filter(mine).length + B.barriers.filter(mine).length + B.lights.filter(mine).length; dropOwned(mine);
  if (n) { ui.pop(P3(t, 4.4), '💥 영역 파괴!', '#ffd0f0', true); vfx.ring(P3(t), { r0: .5, r1: 12, dur: .6, color: LILY }); }
  return n;
}
function guardianBoost(f) {   // 아군(자신 포함)의 영역/봉인수를 강화한다
  const mine = o => o && (o === f || ally(f, o)); let n = 0;
  for (const arr of [B.barriers, B.lights, B.lakes, B.hexes]) for (const s of arr) if (mine(s.owner) && !s.boost) {
    s.boost = true; if (s.dur) s.dur += 8; n++; const p = P3(s); vfx.ring(p, { r0: 1, r1: (s.r || 200) * S * 1.2, dur: .7, color: LILY }); vfx.column(p, { r: 1.4, h: 22, dur: .8, color: LILY, alpha: .6 });
  }
  for (const o of B.fighters) if (mine(o) && o.cast && (o.cast.type === 'field' || o.cast.type === 'paradise') && !o.cast.boost) { o.cast.boost = true; n++; vfx.ring(P3(o), { r0: 1, r1: 10, dur: .7, color: LILY }); }
  if (B.seal && mine(B.seal.owner) && !B.seal.boost) {   // 봉인수: 내부 망령/봉인수가 더 단단해진다
    B.seal.boost = true; n++; B.fighters.forEach(m => { if (m.minion && m.realm === 1) { m.max = m.hp = Math.round(m.hp * 1.5); m.pm = (m.pm || 1) * 1.5; } });
    ui.pop(P3(B.seal.owner, 4.2), '🌳 봉인수 강화!', '#bfffe8', true);
  }
  return n;
}
CHARS.lily = {
  id: 'lily', name: '세인트릴리 쿠키', color: LILY, fx: 0xffe0f4, cost: 900, hp: 23000, pref: 5.5, atkRange: 520, aiPref: 380, tag: '꽃 · 줄기 · 가시밭 · 백합 · 수호자의 힘',
  skills: {
    base: {
      a: { name: '꽃 발사', cd: .75, desc: '마법지팡이로 꽃을 발사. 원거리 데미지 200', use(f) { setAnim(f, 'cast', .22); shoot(f, { a: f.face, sp: 700, r: 13, dmg: 200, color: LILY, kind: 'flower', life: 1.0 }); } },
      z: { name: '거대 줄기', cd: 9, desc: '거대한 줄기 세 개를 소환해 상대를 마구 때린다. 1타 400 × 3타', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
        setAnim(f, 'cast', .6); f.pose = 'raise'; const steps = [];
        for (let i = 0; i < 3; i++) steps.push({ at: .05 + i * .42, fn: () => { const t = foe(f); if (!t || t === B.ghost || t.hp <= 0) return; const x = clamp(t.x + rnd(-40, 40), PAD, W - PAD), y = clamp(t.y + rnd(-40, 40), PAD, H - PAD); zone(f, { x, y, r: 110, delay: .4, dmg: 400, color: LILYG }); stemFx(x, y, .4); } });
        runScript(f, steps, 1.5, () => { f.pose = null; });
      } },
      x: { name: '가시밭', cd: 13, desc: '상대가 있는 자리에 가시밭을 소환. 데미지 1400 + 2초 스턴', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
        setAnim(f, 'cast', .5); const x = e.x, y = e.y;
        zone(f, { x, y, r: 135, delay: .7, dmg: 1400, color: LILYG, onHit: t => { t.st.stun = Math.max(t.st.stun, 2); ui.pop(P3(t, 3.4), '💫 가시 스턴', '#bfffd0'); } }); thornFx(x, y, 135, 2.6);
      } },
      c: { name: '백합의 수호', cd: 35, desc: '거대한 백합꽃을 피워 광역 3000. 10초간 상대 공격을 막고 상대를 튕겨내며, 안의 세인트릴리와 아군은 공격력 버프 + 초당 2% 회복', use(f) {
        setAnim(f, 'cast', .9); f.pose = 'raise'; const R = 300, g = buildLilyMesh(R * S); g.position.copy(P3(f, 0)); g.scale.setScalar(.01); const T = 10.6;
        addFxm(g, T, (u, m, t) => { const k = t < .6 ? ease.out(t / .6) : t > T - .6 ? 1 - (T - t) / .6 : 1; m.scale.setScalar(Math.max(.01, k)); m.rotation.y += .004; });
        runScript(f, [{ at: .6, fn: () => {
          const b = { owner: f, x: f.x, y: f.y, r: R, t: 0, dur: 10, acc: 0, push: 0, lily: true, col: LILY, mesh: g }, p = P3(f), RS = R * S;
          b.dome = vfx.dome(p, RS, LILY); b.rune = vfx.decal(p, { tex: 'rune', r: RS, color: LILY, alpha: .8, spin: .5 }); b.ring = vfx.decal(p, { tex: 'ring', r: RS, color: 0xffffff, alpha: .9, y: .07 });
          B.barriers.push(b); B.projs.filter(q => q.owner !== f && !ally(q.owner, f) && Math.hypot(q.x - b.x, q.y - b.y) < b.r).forEach(killProj);
          shock(f, R, LILY, 3000); vfx.burst('glow', P3(f, .8), 70, { speed: 4, speed2: 16, life: 1.1, size: 1.1, c0: 0xffffff, c1: LILY, up: 3 }); ui.flash('#ffe0f4', .5, .4); shake(.8, .5); ui.pop(P3(f, 4.2), '🌸 백합의 수호!', '#ffd0f0', true);
        } }], 1.0, () => { f.pose = null; });
      } },
      v: { name: '수호자의 힘 개방', cd: 30, desc: '아군(자신 포함)의 영역·봉인수가 있으면 그것을 강화(지속 +8초, 효과 강화). 없으면 상대에게 유도탄 발사: 2000 + 5초간 쿨타임 정지·스킬 봉인 + 상대 영역 파괴', use(f) {
        setAnim(f, 'cast', .6);
        if (guardianBoost(f)) { ui.flash('#ffe0f4', .4, .35); ui.pop(P3(f, 4.2), '✨ 수호자의 힘!', '#ffd0f0', true); return; }
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
        shoot(f, { a: ang(f, e), sp: 640, r: 20, dmg: 2000, color: LILY, kind: 'flower', homing: 1400, turn: 4.5, life: 2.6, onHit: t => {
          t.st.cdfreeze = Math.max(t.st.cdfreeze, 5); t.st.silence = Math.max(t.st.silence, 5); ui.pop(P3(t, 3.4), '⛓ 쿨타임 정지 · 스킬 봉인', '#ffd0f0', true); breakDomains(t);
        } });
      } },
    }
  }
};
/* ===== 각성 퓨어바닐라 쿠키 (HP 27000, 기본 보호막 2000, 디버프·정신계 면역) ===== */
const PVA = 0xfff2b0, PVB = 0x2a4bff;
function buildGoldEye(sc) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffd45c, emissiveIntensity: .8 })); w.scale.set(1.5, .8, .4); g.add(w);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb020 })); iris.position.z = .15; iris.scale.set(1, 1, .5); g.add(iris);
  const pup = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x4a2a00 })); pup.scale.set(.4, 1.7, .5); pup.position.z = .25; g.add(pup);
  g.scale.setScalar(sc); g.userData.sc = sc; return g;
}
function startLdom(f) {   // Z: 빛의 아공간
  if (f.ldom) { toast(f, '이미 빛의 아공간이 전개되어 있습니다'); return false; }
  setAnim(f, 'cast', .8); let broke = 0;
  for (const o of B.fighters) if (o !== f && !ally(f, o) && realmOf(o) === realmOf(f)) {   // 쉐도우밀크의 아공간(숨기·장막·심연의 손길)을 파괴
    if (o.cast && o.cast.type === 'sub') { o.cast = null; o.hidden = false; o.st.inv = 0; o.st.stun = Math.max(o.st.stun, .8); broke++; }
    if (o.veil) { endVeil(o); broke++; }
  }
  const hs = B.hexes.filter(h => h.owner !== f && !ally(f, h.owner)); hs.forEach(removeHex); B.hexes = B.hexes.filter(h => !hs.includes(h)); broke += hs.length;
  const d = f.ldom = { x: f.x, y: f.y, r: 1000, t: 0, eyes: [] }, p = P3(d), R = d.r * S;
  d.rune = vfx.decal(p, { tex: 'rune', r: R, color: PVA, alpha: .8, spin: .15 }); d.rune2 = vfx.decal(p, { tex: 'rune', r: R * .62, color: 0xffffff, alpha: .55, spin: -.3, y: .06 }); d.ring = vfx.decal(p, { tex: 'ring', r: R, color: 0xffffff, alpha: .95, y: .07 });
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + rnd(-.2, .2), rr = R * rnd(.3, .95), e = buildGoldEye(rnd(2.5, 4.5)); e.position.set(p.x + Math.cos(a) * rr, rnd(5, 16), p.z + Math.sin(a) * rr); e.userData.o = i * .06; e.userData.ph = rnd(0, 6.283); e.scale.setScalar(.001); world.scene.add(e); d.eyes.push(e); }
  vfx.ring(p, { r0: 1, r1: R, dur: 1.1, color: PVA }); vfx.ring(p, { r0: 1, r1: R * .7, dur: 1.4, color: 0xffffff, alpha: .7 }); vfx.column(p, { r: 3, h: 50, dur: 1, color: PVA, alpha: .7 });
  ui.flash('#fff6c0', .8, .55); shake(.8, .5); ui.pop(P3(f, 4.4), broke ? '☀ 아공간 파괴 · 빛의 아공간!' : '☀ 빛의 아공간!', '#fff0a8', true);
  toast(f, '빛의 아공간: 아군 정신계·디버프 면역 / 적 이동기 봉인 / 적이 준 피해의 15% 반사');
}
function endLdom(f, quiet) {
  const d = f.ldom; if (!d) return; f.ldom = null;
  [d.rune, d.rune2, d.ring].forEach(i => vfx.remove(i)); d.eyes.forEach(e => world.scene.remove(e));
  if (!quiet && B) { vfx.ring(P3(d), { r0: 1, r1: d.r * S * .6, dur: .8, color: PVA }); ui.pop(P3(f, 4.2), '빛의 아공간 해제', '#fff0a8'); }
}
function updLdoms(dt) {
  for (const f of B.fighters) {
    const d = f.ldom; if (!d) continue;
    if (f.hp <= 0) { endLdom(f); continue; }
    d.t += dt; const p = P3(d), R = d.r * S;
    for (const e of d.eyes) { const k = ease.out(sstep(e.userData.o, e.userData.o + .5, d.t)), bl = Math.abs(Math.sin(d.t * 1.4 + e.userData.ph)) > .93 ? .15 : 1, sc = e.userData.sc; e.scale.set(sc * k, sc * k * bl, sc * k); e.lookAt(camera.position); }
    if (Math.random() < .6) { const a = rnd(0, 6.283), rr = Math.sqrt(Math.random()) * R; vfx.emit('glow', { x: p.x + Math.cos(a) * rr, y: rnd(.2, 3), z: p.z + Math.sin(a) * rr, vy: rnd(2, 6), life: 1.4, s0: .5, s1: 0, c0: 0xffffff, c1: PVA, a: .7, drag: 0 }); }
    for (const o of B.fighters) {
      if (o.hp <= 0 || realmOf(o) !== realmOf(f)) continue;
      const inside = Math.hypot(o.x - d.x, o.y - d.y) < d.r + o.r;
      if (o === f || ally(f, o)) { if (inside) { for (const k of ['slow', 'silence', 'stun', 'charm', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) o.st[k] = 0; o.burn = null; } continue; }
      if (inside && (o.script || (o.cast && o.cast.type === 'sub')) && o._lx !== undefined) {   // 이동기(돌진·아공간 이동 등)는 일반 이동 속도로만 움직일 수 있다
        const dd = Math.hypot(o.x - o._lx, o.y - o._ly), lim = 150 * 1.6 * dt + 2;
        if (dd > lim) { const k = lim / dd; o.x = o._lx + (o.x - o._lx) * k; o.y = o._ly + (o.y - o._ly) * k; if (o._blk === undefined || B.time - o._blk > .9) { o._blk = B.time; ui.pop(P3(o, 3.4), '🚫 이동기 봉인', '#fff0a8'); } }
      }
      o._lx = o.x; o._ly = o.y;
    }
  }
}
function lightWave(f) {   // X: 광범위한 빛의 파동 — 정신계 해제 + 적 변신 해제
  setAnim(f, 'cast', .6); const R = 750, p = P3(f); let n = 0;
  vfx.ring(p, { r0: 1, r1: R * S, dur: .9, color: PVA }); vfx.ring(p, { r0: 1, r1: R * S * .7, dur: 1.1, color: 0xffffff, alpha: .7 }); vfx.burst('glow', P3(f, 1.2), 70, { speed: 6, speed2: 22, life: 1, size: 1.1, c0: 0xffffff, c1: PVA, flat: true });
  ui.flash('#fff6c0', .5, .45); shake(.7, .4);
  for (const o of B.fighters) if (realmOf(o) === realmOf(f) && o.hp > 0 && Math.hypot(o.x - f.x, o.y - f.y) < R + o.r) {
    if (o === f || ally(f, o)) { for (const k of ['slow', 'silence', 'stun', 'charm', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) o.st[k] = 0; continue; }
    hurt(f, o, 800);
    if (o.form === 'dragon' || o.form === 'witch') { revertForm(o); ui.pop(P3(o, 4), '✨ 변신 해제!', '#fff0a8', true); n++; }
  }
  if (B.mind && B.mind.f !== f && !ally(f, B.mind.f)) { endMind(); ui.pop(P3(f, 4.2), '✨ 정신세계 해제!', '#ff9ae6', true); }
  ui.pop(P3(f, 3.4), n ? '빛의 파동 · 변신 해제' : '빛의 파동', '#fff0a8');
}
function buildKMoon(R) {   // 지식의 달: 앞면(+z) 노랑, 뒷면 진한 파랑
  const g = new THREE.Group(), geo = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe680 })); front.rotation.x = Math.PI / 2;
  const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x08155e })); back.rotation.x = -Math.PI / 2;
  const sp = c => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const gF = sp(0xffe27a), gB = sp(0x2a4bff); gF.scale.setScalar(R * 4.4); gB.scale.setScalar(R * 4.4); g.add(front, back, gF, gB); gB.material.opacity = 0;
  return { group: g, front, back, gF, gB, R };
}
function startMoonK(f) {   // V: 지식의 달
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
  const moon = buildKMoon(18); moon.group.position.set(0, 36, -72); world.scene.add(moon.group);
  B.projs.forEach(killProj); B.projs = [];
  B.cut = { kind: 'moonk', t: 0, dur: 13.2, f, e, moon, fl: {}, hits: 0, strips: [], home: { x: f.x, y: f.y } };
  world.setCut(true); ui.cinema(true); f.pose = 'raise'; camera.near = .1; ui.title(f.def.name, 'MOON OF KNOWLEDGE');
}
function updMoonK(dt) {
  const c = B.cut, f = c.f, e = c.e, t = c.t += dt, fl = c.fl, M = c.moon.group.position, base = W3(c.home.x, c.home.y, 0), eb = P3(e, 0), V3 = THREE.Vector3;
  f.root.position.set(base.x, f.air || 0, base.z);
  const ry = c.moon.group.rotation.y; c.moon.gF.material.opacity = Math.max(0, Math.cos(ry)) * .85; c.moon.gB.material.opacity = Math.max(0, -Math.cos(ry)) * .95;
  const beam = (a, b) => { if (c.bt === undefined || t - c.bt > .09) { c.bt = t; vfx.line('glow', M.clone().add(new V3(rnd(-9, 9), rnd(-9, 9), 8)), P3(f, 1.7), 8, { size: .8, size1: .1, c0: a, c1: b, life: .8, rad: .45, v: 1 }); } };
  let pos, look, fov;
  if (t < 1.8) {                      // ① 두 손을 들어 올린다
    const u = t / 1.8; f.pose = 'raise';
    pos = new V3(base.x + lerp(3.4, 1.6, ease.io(u)), lerp(1.4, 2, u), base.z + lerp(8.5, 6, u)); look = base.clone().add(new V3(0, lerp(1.6, 2.4, u), 0)); fov = lerp(40, 34, u);
  } else if (t < 4.4) {               // ② 달의 앞면: 노란 빛
    const u = (t - 1.8) / 2.6, k = ease.io(u); beam(0xfff2a0, 0xffc933);
    if (!fl.a) { fl.a = 1; ui.flash('#ffe680', .6, .4); ui.title('', ''); }
    pos = new V3(lerp(base.x + 1.6, 0, k), lerp(2, 9, k), lerp(base.z + 6, 22, k)); look = base.clone().add(new V3(0, 2.4, 0)).lerp(M, ease.io(sstep(.1, 1, u))); fov = lerp(34, 52, u);
  } else if (t < 7.0) {               // ③ 달이 돌아 뒷면: 진한 파란 빛
    const u = (t - 4.4) / 2.6; c.moon.group.rotation.y = Math.PI * ease.io(u);
    if (u < .5) beam(0xfff2a0, 0xffc933); else beam(0x6a8aff, 0x1a2a9a);
    if (u > .5 && !fl.b) { fl.b = 1; ui.flash('#2a4bff', .6, .4); }
    pos = new V3(0, lerp(9, 10, u), lerp(22, 24, u)); look = M.clone().add(new V3(0, -1, 0)); fov = 54;
    B.shake = Math.max(B.shake, .1); B.shakeT = .2;
  } else if (t < 8.4) {               // ④ 노랑 + 파랑의 힘이 퓨어바닐라에게로
    const u = (t - 7.0) / 1.4; f.pose = 'raise'; f.air = 3 * ease.out(u); beam(0xfff2a0, 0x2a4bff);
    if (!fl.c) { fl.c = 1; ui.flash('#ffffff', .8, .5); vfx.column(P3(f), { r: 2.6, h: 40, dur: 1.4, color: 0xffe680, alpha: .8 }); vfx.column(P3(f), { r: 1.6, h: 40, dur: 1.4, color: PVB, alpha: .8 }); for (let i = 0; i < 4; i++) vfx.ring(P3(f), { r0: 1, r1: 12 + i * 7, dur: .7 + i * .2, color: i % 2 ? 0xfff2b0 : 0x4a6bff }); shake(1, .6); }
    for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = rnd(3, 7); vfx.emit('glow', { x: base.x + Math.cos(a) * d, y: rnd(0, 6), z: base.z + Math.sin(a) * d, vx: -Math.cos(a) * 6, vy: rnd(0, 3), vz: -Math.sin(a) * 6, life: .5, s0: .4, s1: .05, a: .7, c0: i % 2 ? 0xfff2a0 : 0x4a6bff, c1: 0xffffff, drag: 0 }); }
    pos = new V3(base.x + lerp(-4, 3.2, u), lerp(2.2, 4, u), base.z + lerp(7, 9, u)); look = base.clone().add(new V3(0, 2.8 + f.air, 0)); fov = 40;
  } else if (t < 9.6) {               // ⑤ 하늘에 거대한 빛의 장막
    const u = (t - 8.4) / 1.2; f.air = lerp(3, 6, ease.out(u));
    if (!fl.s) {
      fl.s = 1; const sm = new THREE.MeshBasicMaterial({ map: tex('glow'), color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, st = new THREE.Mesh(new THREE.PlaneGeometry(10, 48), sm.clone()); st.position.set(eb.x + Math.cos(a) * 22, 26, eb.z + Math.sin(a) * 22); st.lookAt(eb.x, 26, eb.z); st.userData.a = a; addExtra(st); c.strips.push(st); }
      ui.pop(P3(f, 5.4), '🌙 빛의 장막', '#fff0a8', true); shake(.8, .6);
    }
    c.strips.forEach((s, i) => { s.material.opacity = .6 * ease.out(u) * (.85 + Math.sin(t * 3 + i) * .15); });
    pos = new V3(base.x + 1, 2, base.z + 10); look = eb.clone().add(new V3(0, lerp(10, 28, u), 0)); fov = lerp(46, 62, u);
  } else if (t < 12.0) {              // ⑥ 많은 빛이 쏟아진다 (500 × 14 = 7000)
    const u = (t - 9.6) / 2.4, n = Math.min(14, Math.floor((t - 9.6) / .16) + 1);
    while (c.hits < n) {
      c.hits++; const ec = P3(e, 0); vfx.column(ec.clone().add(new V3(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5))), { r: 1.6, h: 60, dur: .4, color: c.hits % 2 ? 0xfff2b0 : 0x6a8aff, alpha: .9 });
      vfx.ring(ec, { r0: .5, r1: 6, dur: .35, color: PVA }); vfx.burst('spark', ec.clone().setY(1), 16, { speed: 6, speed2: 16, life: .5, size: .5, c0: 0xffffff, c1: PVA, grav: 5 });
      hurt(f, e, 500, { quiet: true }); ui.pop(P3(e, 2.4 + rnd(0, 1.4)), '500', '#fff0a8', c.hits % 5 === 0); if (c.hits % 3 === 0) { shake(.6, .2); ui.flash('#fff6c0', .25, .15); }
    }
    if (Math.random() < .9) vfx.column(eb.clone().add(new V3(rnd(-9, 9), 0, rnd(-9, 9))), { r: rnd(.5, 1.2), h: 60, dur: .35, color: Math.random() < .5 ? 0xfff2b0 : 0x6a8aff, alpha: .8 });
    c.strips.forEach((s, i) => { s.material.opacity = .6 * (.85 + Math.sin(t * 5 + i) * .15) * (1 - sstep(11.2, 12, t)); });
    const mid = base.clone().lerp(eb, .35);
    pos = mid.clone().add(new V3(lerp(-7, 7, u), lerp(10, 13, u), 15)); look = eb.clone().add(new V3(0, 2, 0)); fov = 46;
  } else {                            // ⑦ 게임 화면 복귀
    const u = Math.min(1, (t - 12.0) / 1.2), g = gameCamPose();
    if (!fl.e) { fl.e = 1; c.strips.forEach(s => world.scene.remove(s)); c.strips = []; world.scene.remove(c.moon.group); world.setCut(false); ui.cinema(false); ui.title('', ''); f.pose = null; f.air = 0; }
    f.air = 0;
    pos = camState.pos.clone().lerp(g.pos, ease.io(u)); look = camState.look.clone().lerp(g.look, ease.io(u)); fov = lerp(camState.fov, g.fov, ease.io(u));
    if (t >= c.dur) { B.cut = null; f.pose = null; camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov; return; }
  }
  camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov;
}
CHARS.pva = {
  id: 'pva', base: 'pv', name: '각성 퓨어바닐라 쿠키', color: PVA, fx: 0xfff6c8, cost: 0, hp: 27000, shield: 2000, pref: 5.5, atkRange: 560, aiPref: 380, tag: '각성 · 빛의 아공간 · 반사막 · 지식의 달',
  passive: '디버프와 정신계 공격을 받지 않습니다. (은포크에 봉인되면 빛의 아공간이 풀립니다)',
  skills: {
    base: {
      a: { name: '굽이치는 빛', cd: .8, desc: '곡선을 그리며 날아가 적을 쫓는 유도탄 빛을 발사. 데미지 250', use(f) { setAnim(f, 'cast', .22); f.curve = -(f.curve || 1); shoot(f, { a: f.face + f.curve * .9, sp: 600, r: 13, dmg: 250, color: PVA, kind: 'orb', life: 1.6, homing: 1400, turn: 2.8 }); } },
      z: { name: '빛의 아공간', cd: 50, desc: '빛의 눈이 가득한 아공간 전개. 쉐도우밀크의 아공간은 파괴. 안의 아군은 정신계·디버프 면역, 적의 이동기 봉인, 적이 준 피해의 15%가 되돌아감. 봉인되지 않는 한 유지', use(f) { return startLdom(f); } },
      x: { name: '빛의 파동', cd: 20, desc: '주위로 광범위한 빛의 파동. 정신계 공격 해제, 적의 변신(드래곤·마녀 등) 해제, 적에게 800', use(f) { lightWave(f); } },
      c: { name: '수호의 반사막', cd: 40, desc: '엄청 큰 보호막이 따라다님(12초). 안의 아군은 보호막 재충전 + 초당 3% 회복. 모든 공격 반사, 버닝스파이스도 못 부숨, 적을 튕겨냄', use(f) {
        setAnim(f, 'cast', .6); const R = 520, b = { owner: f, x: f.x, y: f.y, r: R, t: 0, dur: 12, acc: 0, push: 0, refl: true, noBreak: true, follow: true, col: PVA }, p = P3(f), RS = R * S;
        b.dome = vfx.dome(p, RS, PVA); b.rune = vfx.decal(p, { tex: 'rune', r: RS, color: PVA, alpha: .8, spin: .5 }); b.ring = vfx.decal(p, { tex: 'ring', r: RS, color: 0xffffff, alpha: .9, y: .07 });
        vfx.ring(p, { r0: .5, r1: RS * 1.3, dur: .7, color: PVA }); vfx.burst('glow', P3(f, .6), 50, { speed: 3, speed2: 12, life: 1, size: 1, c0: 0xffffff, c1: PVA, flat: true });
        ui.flash('#fff6c0', .4, .35); B.barriers.push(b); toast(f, '수호의 반사막!');
      } },
      v: { name: '지식의 달', cd: 60, desc: '[컷신] 달의 앞면은 노란 빛, 뒷면은 진한 파란 빛. 두 힘을 받아 하늘에 거대한 빛의 장막을 펼치고 수많은 빛을 쏟아부음. 7000', use(f) { return startMoonK(f); } },
    }
  }
};
CHARS.pv.awakeId = 'pva';
const ORDER = ['silent', 'lich', 'shadow', 'sugar', 'dark', 'pv', 'burn', 'lily'];

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
    cd: { a: 0, z: 0, x: 0, c: 0, v: 0 }, st: { slow: 0, slowF: 1, silence: 0, stun: 0, charm: 0, inv: 0, lock: 0, cdfreeze: 0, knock: 0, rev: 0, ctl: 0, lightBuff: 0 },
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
  if (f.big) f.root.scale.setScalar(f.big); else if (f.def.id === 'burn') f.root.scale.setScalar(lerp(f.root.scale.x, f.giant > 0 ? 1.85 : 1, .12)); else if (f.def.id === 'dark') f.root.scale.setScalar(lerp(f.root.scale.x, f.form === 'witch' ? 1.3 : 1, .15));
  const T = f.at, dead = f.hp <= 0, dragon = f.form === 'dragon';
  // 위치/방향
  const tp = P3(f, 0);
  if (!B.cut || f !== B.cut.f) f.root.position.set(tp.x, f.root.position.y * (f.lift ? 1 : 0) + (f.pose === 'float' ? 1.2 + Math.sin(T * 4) * .15 : 0) + (f.pose === 'sleep' && f.cast && f.cast.type === 'paradise' ? 1.9 : 0) + (f.air || 0), tp.z);
  const want = Math.PI / 2 - f.face; let d = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw)); f.yaw += d * Math.min(1, dt * 16);
  f.root.rotation.y = f.yaw;
  // 모델 전환
  f.rig.root.visible = !dragon && !f.hidden && !f.bushHid; if (f.drg) f.drg.root.visible = dragon && !f.bushHid;
  if (dragon) { f.dragonPop = Math.min(1, f.dragonPop + dt * 2.5); const s = ease.out(f.dragonPop); f.drg.root.scale.setScalar(Math.max(.01, s * (1 + Math.sin(f.dragonPop * 9) * .06 * (1 - f.dragonPop)))); }
  f.blob.scale.setScalar(dragon ? 2 : 1); f.blob.position.y = .05 - (f.air || 0) / (f.root.scale.y || 1); f.blob.visible = !f.hidden && !f.bushHid;
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
  addEventListener('keydown', e => { if (B && !e.repeat && e.code === 'KeyG') toggleSealView(); });
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
  if (ray.ray.intersectPlane(plane, hitV)) { mouse.wx = (hitV.x - (viewRealm() ? RDX : 0)) / S + W / 2; mouse.wy = hitV.z / S + H / 2; }
}
function readInput(f) {
  const k = f.ctrl.kind;
  if (k === 'h1') { const keys = Q1.splice(0), tm = TOUCH.mx || TOUCH.my, m = camRel(tm ? TOUCH.mx : (down.KeyD ? 1 : 0) - (down.KeyA ? 1 : 0), tm ? TOUCH.my : (down.KeyS ? 1 : 0) - (down.KeyW ? 1 : 0)); return { mx: m.x, my: m.y, a: !!(down.Space || mouse.down || TOUCH.atk), keys }; }
  if (k === 'h2') { const keys = Q2.splice(0), m = camRel((down.ArrowRight ? 1 : 0) - (down.ArrowLeft ? 1 : 0), (down.ArrowDown ? 1 : 0) - (down.ArrowUp ? 1 : 0)); return { mx: m.x, my: m.y, a: !!down.Enter, keys }; }
  if (k === 'npc') return { mx: f.x < (B.explore ? B.explore.goalX * W : W) ? 1 : 0, my: 0, a: false, keys: [] };
  return aiInput(f);
}
function aiInput(f) {
  const e = foe(f), d = dist(f, e), def = f.def, pref = def.aiPref ?? (def.id === 'silent' ? 90 : def.id === 'lich' ? 260 : 230), a = ang(f, e), dt = B.dt;
  const inp = { mx: 0, my: 0, a: false, keys: [] };
  if (B.abyss && !B.abyss.done && f === B.abyss.target) {
    const A = B.abyss, c = A.chaser, dc = dist(f, c), pa = A.open ? ang(f, A.portal) : ang(c, f); let mx = Math.cos(pa), my = Math.sin(pa);
    if (dc < 320) { const aw = ang(c, f); mx = mx * .4 + Math.cos(aw); my = my * .4 + Math.sin(aw); } inp.mx = mx; inp.my = my; return inp;
  }
  if (f.aggro && B.explore && d > f.aggro && f.hp >= f.max * .999) return inp;
  f.ai.t -= dt; if (f.ai.t <= 0) { f.ai.t = .6 + Math.random() * .8; f.ai.strafe = Math.random() < .5 ? 1 : -1; }
  if (d > pref) { inp.mx = Math.cos(a); inp.my = Math.sin(a); } else if (d < pref * .6) { inp.mx = -Math.cos(a); inp.my = -Math.sin(a); } else { inp.mx = -Math.sin(a) * f.ai.strafe; inp.my = Math.cos(a) * f.ai.strafe; }
  inp.a = d < def.atkRange;
  for (const k of ['z', 'x', 'c', 'v']) {
    if (f.cd[k] > 0 || Math.random() > dt * .9) continue;
    if (k === 'v' && f.def.id === 'silent' && d > 250) continue;
    if (f.def.id === 'burn' && ((k === 'v' && (d > 820 || d < 160)) || (k === 'x' && (d > 800 || d < 140)) || (k === 'z' && d > 420))) continue;
    if (f.def.id === 'burn' && f.undy > 0 && k === 'z') continue;
    if (f.def.id === 'pva' && ((k === 'z' && f.ldom) || (k === 'c' && d > 700) || (k === 'x' && d > 800) || (k === 'v' && d > 1200))) continue;
    if (f.def.id === 'pv' && k === 'c' && !(f.st.lock > 0 || f.st.ctl > 0 || f.st.silence > 0 || B.mind || foe(f).veil || (foe(f).cast && foe(f).cast.type))) continue;
    if (k === 'v' && f.form !== 'base' && f.form !== 'hour') continue;
    if (k === 'v' && f.cast) continue;
    if (f.def.id === 'sugar' && (k === 'c' || k === 'v') && f.hp / f.max > .7 && f.shield / f.shieldMax > .6) continue;
    inp.keys.push(k);
  }
  if (f.def.id === 'shadow') { if (f.veil && !f.cast && f.cd.q <= 0 && Math.random() < dt * .6) inp.keys.push('q'); if (f.awake && f.gauge >= 100 && !f.ult.armed && Math.random() < dt * 2) inp.keys.push('r'); }
  if ((f.def.id === 'silent' || (f.def.id === 'lich' && f.form === 'base' && !f.minion)) && f.awake && f.gauge >= 100 && Math.random() < dt * 2) inp.keys.push('r');
  if (f.cast && f.cast.type === 'field' && f.cast.t > 6) inp.keys.push('v');
  if (f.cast && f.cast.type === 'paradise' && f.cast.t > 30) inp.keys.push('v');
  return inp;
}
function aimPoint(f) {
  const os = f.st.charm > 0 ? B.objs.filter(o => (o.realm || 0) === realmOf(f)) : [];
  if (os.length) { let best = os[0]; for (const o of os) if (dist(f, o) < dist(f, best)) best = o; return best; }
  if (f.ctrl.kind === 'h1') {
    if (isTouch) {   // 터치: 기본은 상대 자동 조준, 스킬 버튼을 드래그해서 뗀 직후에는 그 방향으로 조준
      const t = TOUCH.aim; if (t && performance.now() < TOUCH.until) { const d = camRel(t.dx / t.m, t.dy / t.m), L = 150 + 580 * clamp(t.m / 70, 0, 1); return { x: f.x + d.x * L, y: f.y + d.y * L }; }
      return foe(f);
    }
    return { x: mouse.wx, y: mouse.wy };
  }
  return foe(f);
}
// 아공간/영역을 전개하는 스킬 (각성 퓨어바닐라의 빛의 아공간이 켜져 있으면 다른 쿠키는 전개 불가)
const DOMAIN_SKILLS = { silent: ['v'], lich: ['c'], shadow: ['z', 'x', 'v'], sugar: ['z', 'v'], pv: ['x'] };
const domainBlocked = (f, k) => !!(DOMAIN_SKILLS[f.def.id] && DOMAIN_SKILLS[f.def.id].includes(k) && B.fighters.some(p => p.ldom && p.hp > 0 && p !== f && !ally(p, f) && realmOf(p) === realmOf(f)));
function tryUse(f, k) {
  const s = f.def.skills[f.form][k];
  if (f.sealSoul && k === 'r' && f.def.id === 'shadow') return;
  if (!s || f.cd[k] > 0 || f.script || B.cut) return;
  if (domainBlocked(f, k)) { if (!f.domMsg || B.time - f.domMsg > 1.2) { f.domMsg = B.time; toast(f, '빛의 아공간 안에서는 아공간·영역을 전개할 수 없습니다'); ui.pop(P3(f, 3.4), '🚫 전개 불가', '#fff0a8'); } return; }
  const pvc = f.def.id === 'pv' && k === 'c';
  if (f.st.stun > 0 || (f.st.lock > 0 && !pvc)) return;
  if (f.cast && !((f.cast.type === 'field' || f.cast.type === 'paradise') && k === 'v')) return;
  if (k !== 'a' && f.st.silence > 0 && !pvc) { toast(f, '침묵 상태!'); return; }
  const r = s.use(f, aimPoint(f));
  if (r !== false) f.cmb = B.time;   // 자연 회복은 공격/피격 후 일정 시간이 지나야 시작
  if (r !== false && r !== 'nocd') f.cd[k] = s.cd * (f.soul || f.sealSoul ? 1.5 : 1);
}

/* ================= 업데이트 ================= */
function updFighter(f, dt) {
  if (B.explore && f.hp <= 0) return;
  if (f.sealHold) return;
  updCommon(f, dt);
  if (f.def.id === 'silent' && f.form === 'base' && !f.sealSoul && !f.soul && f.hp > 0 && f.hp <= 10000) enterHour(f);
  if (f.form === 'hour') hourAura(f);
  if (!(f.st.cdfreeze > 0)) for (const k in f.cd) f.cd[k] = Math.max(0, f.cd[k] - dt);
  for (const k of ['slow', 'silence', 'stun', 'charm', 'inv', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl', 'lightBuff']) f.st[k] = Math.max(0, f.st[k] - dt);
  if (f.permRev) f.st.rev = Math.max(f.st.rev, .2); if (f.permSlow && f.st.slow < .2) slowOn(f, .2, .65);
  f.flash = Math.max(0, f.flash - dt); f.drT = Math.max(0, f.drT - dt);
  if (f.form !== 'base' && f.form !== 'hour' && !f.script) { f.formT -= dt; if (f.formT <= 0) { revertForm(f); toast(f, '변신 종료'); } }
  let inp = readInput(f); f.last = { mx: inp.mx, my: inp.my };
  if (f.st.ctl > 0 && f.ctlBy && f.ctlBy.hp > 0) { const s = f.ctlBy.last || { mx: 0, my: 0 }; inp = { mx: s.mx, my: s.my, a: false, keys: f.def.id === 'pv' ? inp.keys.filter(k => k === 'c') : [] }; }
  if (f.st.rev > 0) { inp = { ...inp, mx: -inp.mx, my: -inp.my }; }
  const ap = aimPoint(f);
  if (!f.script && f.st.stun <= 0 && f.st.lock <= 0) f.face = ang(f, ap);
  if (f.act) { if (f.script) { f.act.t += dt; f.act.upd(Math.min(1, f.act.t / f.act.dur), dt); } else f.act = null; }
  if (f.script) { const s = f.script; s.t += dt; for (const st of s.steps) if (!st.d && s.t >= st.at) { st.d = true; st.fn(); } if (s.t >= s.end) { f.script = null; s.onEnd && s.onEnd(); } }
  const canAct = !f.script && f.st.stun <= 0 && f.st.lock <= 0 && !B.cut;
  if (canAct) { for (const k of inp.keys) tryUse(f, k); if (inp.a && !f.cast) tryUse(f, 'a'); }
  else if (f.def.id === 'pv' && !f.script && f.st.stun <= 0 && !B.cut && inp.keys.includes('c')) tryUse(f, 'c');
  if (f.cast && f.cast.type === 'field') updField(f, dt);
  if (f.cast && f.cast.type === 'sleep') updSleep(f, dt);
  if (f.drain) updDrain(f, dt);
  if (f.cast && f.cast.type === 'sub') updSub(f, dt);
  if (f.cast && f.cast.type === 'control') updControl(f, dt);
  if (f.veil) updVeil(f, dt);
  if (f.cast && f.cast.type === 'paradise') updParadise(f, dt);
  const ox = f.x, oy = f.y;
  if (canAct && !f.cast && !f.rooted) {
    const len = Math.hypot(inp.mx, inp.my) || 1, sp = 150 * spdMul(f) * (f.st.slow > 0 ? f.st.slowF : 1), on = inp.mx || inp.my ? 1 : 0;
    f.x += inp.mx / len * sp * dt * on; f.y += inp.my / len * sp * dt * on;
  }
  f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD);
  if (f.realm) {
    if (B.abyss) { const dx = f.x - W / 2, dy = f.y - H / 2, dd = Math.hypot(dx, dy), mx = 1900; if (dd > mx) { f.x = W / 2 + dx / dd * mx; f.y = H / 2 + dy / dd * mx; } }
    else { f.x = clamp(f.x, W / 2 - 520, W / 2 + 520); f.y = clamp(f.y, H / 2 - 400, H / 2 + 400); }
  }
  for (const o of B.objs) { if ((o.realm || 0) !== realmOf(f)) continue; const d = dist(f, o); if (d < f.r + o.r) { const a = ang(o, f); f.x = o.x + Math.cos(a) * (f.r + o.r); f.y = o.y + Math.sin(a) * (f.r + o.r); } }
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
    const seen = f === me || (B.mode !== 'ai' && B.mode !== 'duel') || f.bush < 0 || f.bush === me.bush || dist(f, me) < 280 || f.flash > 0 || f.cast || f.hp <= 0;
    f.bushHid = !seen;
  });
}
let camFov = 0;
const PARTS = ['fighters', 'projs', 'zones', 'lakes', 'hexes', 'angels', 'barriers', 'lights'];
function inRealm(rl, fn) {
  const orig = {}; for (const k of PARTS) { orig[k] = B[k]; B[k] = orig[k].filter(x => (x.realm || 0) === rl); }
  CUR = rl;
  try { fn(); } finally {
    CUR = 0;
    for (const k of PARTS) {
      const sub = B[k], keep = new Set(sub), old = new Set(orig[k]);
      sub.forEach(x => { if (!old.has(x) && x.realm === undefined) x.realm = rl; });
      B[k] = orig[k].filter(x => (x.realm || 0) !== rl || keep.has(x)).concat(sub.filter(x => !old.has(x)));
    }
  }
}
const inR = fn => { if (B.seal || B.abyss) { inRealm(0, fn); inRealm(1, fn); } else fn(); };
function update(dt) {
  B.dt = dt; updSealBtn();
  B.shakeT = Math.max(0, B.shakeT - dt); if (B.shakeT <= 0) B.shake = Math.max(0, B.shake - dt * 3);
  vfx.update(dt, 0);
  B.fighters.forEach(f => animate(f, dt));
  if (B.cut) { updateCut(dt); return; }
  if (B.over) return;
  if (B.intro || B.hold) return;
  B.time += dt;
  if (B.healer && !B.over) { const h = B.healer; h.t += dt; if (h.t >= h.every) { h.t = 0; const me = B.fighters[0]; if (me.hp > 0) { const v = Math.round(me.max * h.pct); me.hp = Math.min(me.max, me.hp + v); ui.pop(P3(me, 3.4), '+' + v, '#7dff9b', true); vfx.ring(P3(me), { r0: .5, r1: 5, dur: .8, color: 0xfff3a0 }); vfx.column(P3(me), { r: 1.6, h: 12, dur: .9, color: 0xfff3a0, alpha: .7 }); ui.flash('#fff6c0', .5, .25); ui.toast('☀️ 퓨어바닐라 쿠키의 치유!'); } } }
  if (B.fxT && !B.over) { B.fxT -= dt; if (B.fxT <= 0) { B.over = B.ghost || B.fighters[1]; setTimeout(finish, 600); } }
  if (B.raid && !B.over) { B.raid.t -= dt; if (B.raid.t <= 0) { B.raid.t = 0; B.over = B.raid.boss; setTimeout(finish, 900); } }
  inR(() => B.fighters.forEach(f => updFighter(f, dt)));
  updBush();
  for (const m of B.fighters) if (m.legion && m.hp <= 0) { m.deadT = (m.deadT || 0) + dt; if (m.deadT > 1) m.gone = true; }
  if (B.fighters.some(m => m.gone && m.legion)) { B.fighters.filter(m => m.gone && m.legion).forEach(removeFighter); B.fighters = B.fighters.filter(m => !(m.gone && m.legion)); }
  updFxm(dt); updLdoms(dt); updForks(dt); updSeal(dt); updLult(dt); updAbyss(dt);
  inR(() => { updProjs(dt); updBarriers(dt); updLights(dt); updStorm(dt); updZones(dt); updLakes(dt); updAngels(dt); updHexes(dt); });
  if (B.mind) { B.mind.t -= dt; if (B.mind.t <= 0) endMind(); }
  if (B.explore) { updExplore(dt); return; }
  const dead = B.fighters.find(f => f.hp <= 0 && !f.minion);
  if (dead && !B.over) { B.over = B.abyss ? B.abyss.owner : (B.fighters.find(o => o !== dead && !o.minion && !ally(dead, o)) || foe(dead)); if (B.mind) endMind(); ui.vignette(false); setTimeout(finish, 2200); }
}
function finish() {
  if (!B) return;
  if (B.fx) { const cb = B.fx.done, win = B.over === B.fighters[0]; cleanup(); ui.hideHud(); toLobby(); cb && cb({ win }); return; }
  if (B.mode === 'duel') {   // 1v1 결투: 먼저 3승
    const s = B.series, p1win = B.over === B.fighters[0]; s.w[p1win ? 0 : 1]++;
    if (s.w[0] < 3 && s.w[1] < 3) {
      ui.toast(`라운드 ${s.round} ${p1win ? '승리' : '패배'}  ·  ${s.w[0]} : ${s.w[1]}`); s.round++;
      const bb = B, a = bb.fighters[0].def.id, b = bb.fighters[1].def.id, mid = bb.map.id;
      setTimeout(() => { if (B === bb) startBattle(a, b, 'duel', mid, s); }, 2200); return;
    }
    const win = s.w[0] >= 3, gain = win ? 500 : 150; SAVE.coins += gain; ui.recordMatch(SAVE, B.fighters[0].def.base || B.fighters[0].def.id, win);
    if (win) { const id = B.fighters[1].def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; SAVE.mat += 2; } persist();
    ui.result(win ? '결투 승리!' : '결투 패배...', `${s.w[0]} : ${s.w[1]}  ·  +${gain} 코인` + (win ? '  ·  각성 재료 +2' : '')); return;
  }
  if (B.mode === 'raid') { const r = ui.recordRaid(B.raid.dmg); ui.result(B.over === B.fighters[0] ? '보스 처치!' : '레이드 종료', `이번 피해 ${Math.round(B.raid.dmg).toLocaleString()}${r.isBest ? ' (최고 기록!)' : ''} · 최고 ${r.best.toLocaleString()}`); return; }
  const w = B.over, p1win = w === B.fighters[0]; let sub = '';
  if (B.mode === 'ai') { const gain = p1win ? 300 : 100; SAVE.coins += gain; ui.recordMatch(SAVE, B.fighters[0].def.base || B.fighters[0].def.id, p1win); if (p1win) { const id = w.def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; SAVE.mat += 1; } persist(); sub = '+' + gain + ' 코인' + (p1win ? '  ·  각성 재료 +1' : ''); }
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
export function runFight(foe, fx) { return new Promise(done => startBattle(picked, foe || picked, 'raidfight', fx.map || 'plain', null, { ...fx, done })); }
export function startBattle(p1, p2, mode, mapId, series, fx) {
  p1 = formOf(p1);   // 각성한 캐릭터를 각성 형태로 쓰는 중이면 각성 버전으로 출전
  cleanup(); lobbyHide(); world.setLobby(false);
  const map = MAPS.find(m => m.id === mapId) || MAPS[Math.floor(Math.random() * MAPS.length)], L = layoutMap(map); W = map.W; H = map.H; mouse.wx = W / 2; mouse.wy = H / 2;
  B = { barriers: [], lights: [], storm: null, fighters: [], projs: [], zones: [], lakes: [], angels: [], ghost: { x: W / 2, y: H / 2, r: 0, hp: 1, max: 1, st: {}, def: { id: 'ghost' }, cast: null, cd: {}, shield: 0, root: { position: new THREE.Vector3() } }, hexes: [], forks: [], extra: [], fxm: [], fkSeq: null, seal: null, abyss: null, lult: null, mind: null, cut: null, over: null, shake: 0, shakeT: 0, hitstop: 0, mode, time: 0, dt: .016,
    objs: L.objs, bushes: L.bushes, map, intro: true, fx: fx || null, series: mode === 'duel' ? (series || { w: [0, 0], round: 1 }) : null };
  const EX = fx && fx.explore;
  if (EX) B.fighters.push(mkFighter(CHARS[p1], EX.start[0] * W, EX.start[1] * H, { kind: 'h1' }));
  else B.fighters.push(mkFighter(CHARS[p1], W * .1, H / 2, { kind: 'h1' }), mkFighter(CHARS[p2], W - W * .1, H / 2, mode === 'local' ? { kind: 'h2' } : { kind: 'ai' }));
  if (mode === 'raid') { const boss = B.fighters[1]; boss.max = boss.hp = RAID_BOSS_HP; boss.awake = true; B.raid = { t: RAID_TIME, dmg: 0, boss }; }
  if (fx && !EX) {   // 레이드 전용 전투: 보스 체력/공격력/범위, 시작 체력, 힐러, 제한 시간
    const foeF = B.fighters[1], me = B.fighters[0]; if (fx.hp) foeF.max = foeF.hp = fx.hp; foeF.pm = fx.pm || 1; foeF.area = fx.area || 1; foeF.awake = true; if (fx.big) { foeF.big = fx.big; foeF.r = 22 * fx.big; }
    if (fx.myHp) me.hp = Math.max(1, me.max * fx.myHp); if (fx.myShield) { me.shield = me.shieldMax = fx.myShield; }
    if (fx.heal) B.healer = { t: 0, every: fx.heal.every, pct: fx.heal.pct }; if (fx.timeout) B.fxT = fx.timeout;
  }
  if (!EX) { B.fighters[1].face = Math.PI; B.fighters[1].yaw = Math.PI / 2 - Math.PI; } B.fighters[0].yaw = Math.PI / 2;
  world.setMap(map, L); world.setMind(false); world.setCut(false);
  camState.init = false; camState.fov = 42; camFov = 0;
  ui.showGame(true); ui.beginBattle(B); world.resize(); showTouch(true, B.fighters[0]);
  if (EX) { setupExplore(EX, fx); B.intro = false; cam.fit = false; ui.toast(EX.title || '탐험 시작'); return; }
  const bb = B; ui.intro(B.fighters, () => { if (B === bb) { bb.intro = false; ui.toast('전투 시작!  ·  ' + map.name); } });
}
function cleanup() {
  if (!B) return;
  B.fighters.forEach(f => { if (f.drain) endDrain(f); if (f.ldom) endLdom(f, true); }); B.fighters.forEach(removeFighter); B.projs.forEach(killProj);
  B.lakes.forEach(removeLake); B.hexes.forEach(removeHex); B.fighters.forEach(f => f.veil && world.scene.remove(f.veil.group)); B.angels.forEach(a => world.scene.remove(a.g)); B.zones.forEach(z => z.mesh && world.scene.remove(z.mesh));
  B.fighters.forEach(f => { if (f.cast && f.cast.group) world.scene.remove(f.cast.group); }); world.setParadise(false);
  B.extra.forEach(m => world.scene.remove(m)); ui.glass(false); world.setAbyss(false); if (sealBtn) sealBtn.style.display = 'none';
  if (B.cut) { if (B.cut.moon) world.scene.remove(B.cut.moon.group); (B.cut.eyes || []).forEach(e => world.scene.remove(e)); if (B.cut.kind === 'burn') B.fighters.forEach(f => { f.root.visible = true; }); }
  B.barriers.forEach(removeBarrier); B.lights.forEach(removeLight); if (B.storm) endStorm(true); world.setStorm(false);
  [...vfx.items].forEach(i => vfx.drop(i));
  ui.introCancel(); ui.title('', ''); ui.cinema(false); ui.vignette(false); world.setMind(false); world.setCut(false); B = null;
}
let picked = 'silent';
export function init() {
  canvas = document.getElementById('cv'); world = createWorld(canvas); camera = world.camera; vfx = new VFX(world.scene, camera);
  loadManifest(); bindInput();
  initTouch({ camDrag: (dx, dy) => { cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .005, .25, 1.45); }, camZoom: k => { cam.dist = clamp(cam.dist * k, 5, 42); }, press: k => Q1.push(k), toggleCam: () => { if (B) { cam.fit = !cam.fit; ui.toast(cam.fit ? '시점: 둘 다 보기' : '시점: 내 캐릭터 추적'); } } });
  if (isTouch) { world.setQuality(1); vfx.density = .5; }
  ui.initUI({
    CHARS, ORDER, SAVE, persist, picked: () => picked, pick: id => { picked = id; }, formOf, AWAKE_COST,
    reset: () => { Object.assign(SAVE, { coins: 0, unlocked: ['silent'], awake: [], wins: {}, totalWins: 0, ev: null, mat: 0, awakeOn: {} }); persist(); },
    start: (a, b, m) => startBattle(a, b, m), raid: () => startBattle(picked, 'shadow', 'raid'), fight: runFight, back: () => { cleanup(); ui.hideHud(); toLobby(); },
    cheat: () => { SAVE.unlocked = [...ORDER]; SAVE.awake = ['silent', 'lich', 'shadow']; SAVE.hub = SAVE.hub || {}; SAVE.hub.pass = Object.assign({ xp: 0, f: {}, p: {} }, SAVE.hub.pass, { prem: true }); SAVE.hub.shards = (SAVE.hub.shards || 0) + 500; SAVE.tickets = (SAVE.tickets || 0) + 10; SAVE.mat = (SAVE.mat || 0) + 30; persist(); },
  });
  toLobby();
  requestAnimationFrame(frame);
  window.WB = { get B() { return B; }, runFight, hurt, step: dt => update(dt), startBattle, tryUse, CHARS, SAVE, vfx, world, THREE };
}
