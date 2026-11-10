// 전투 로직 + 스킬 연출 + 컷신. 로직은 2D 좌표(x,y)로 계산하고 3D 월드(x,z)로 매핑한다.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { MAPS, layoutMap } from './maps.js';
import { RAID_BOSS_HP, RAID_TIME } from './hub.js';
import { isTouch, TOUCH, initTouch, showTouch, updateTouch } from './touch.js';
import { VFX, ease, isDark } from './vfx.js';
import { buildCookie, buildDragon, buildMoon, heartMesh } from './models.js';
import { poseBone, buildDragonHead } from './dragonglb.js';
import { makeVCModel, vcReady, buildPitayaHead } from './vcglb.js';
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
const foe = f => { let best = null, bd = 1e18; for (const o of B.fighters) { if (o === f || o.hp <= 0 || o.nofoe || ally(o, f) || realmOf(o) !== realmOf(f) || (f.pinkT > 0 && o === f.pinkBy)) continue; const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2; if (d < bd) { bd = d; best = o; } } return best || B.fighters.find(o => o !== f && realmOf(o) === realmOf(f)) || B.ghost; };

/* ================= 데미지 / 상태 ================= */
const dmgMul = f => (f.pm || 1) * (f.yBuff || f.yBuffT > 0 ? 1.3 : 1) * (f.st.lightBuff > 0 ? 1.25 : 1) * (f.mindBuff ? 1.05 : 1) * (f.form === 'dragon' ? 1.1 : 1) * (f.soul ? .25 : 1) * (f.form === 'hour' ? 1.3 : 1) * (f.sealSoul ? .5 : 1) * (f.bigSword > 0 ? 3 : 1) * (1 - Math.min(.5, (f.voidP || 0) * .1)) * (f.def.id === 'gold' && !(f.pseal > 0) ? 2 - Math.max(0, f.hp) / f.max : 1);
const defRed = f => Math.min(.95, (f.defUp > 0 ? .3 : 0) + (f.form === 'pdragon' ? .5 : 0) + (f.inFZ ? .3 : 0) + (f.dscale > 0 ? .7 : 0) + (f.inPF ? .3 : 0) + (f.mindBuff ? .05 : 0) + (f.giant > 0 ? .35 : 0) + (f.def.id === 'burnA' && f.form === 'beast' ? .55 + (f.molt || 0) * .01 : 0));   // 불지네 괴수화: 받는 피해 45% (필멸의 탈피 스택마다 1%p 추가 감소)
const spdMul = f => (f.spdBoost || 1) * (f.mindBuff ? 1.15 : 1) * (f.form === 'dragon' ? 1.1 : 1);
function troRec(win) {   // 이기면 트로피 획득, 지면 잃는다 (캐릭터별, 0 미만으로는 안 내려감)
  const id = B.fighters[0].def.base || B.fighters[0].def.id, b = (SAVE.tro && SAVE.tro[id]) || 0; ui.recordMatch(SAVE, id, win); const a = SAVE.tro[id] || 0, d = a - b;
  return `  ·  🏆 ${d >= 0 ? '+' : ''}${d} (${a})`;
}
const toast = (f, t) => { if (f.ctrl.kind !== 'ai') ui.toast(t); };
const shake = (a, t = .3) => { B.shake = Math.max(B.shake, a); B.shakeT = Math.max(B.shakeT, t); };

function hurt(src, t, n, o = {}) {
  if (t.hp <= 0 || t.st.inv > 0 || t.undy > 0) return;
  if (t.def.id === 'goldA' && t.form === 'sky' && src !== t) return;   // 각성 골드치즈: 하늘에 떠 있는 동안은 공격이 맞지 않는다
  if (src && src !== t && src.st && src.st.charmS > 0 && !o.charmR && !ally(src, t) && realmOf(src) === realmOf(t)) {   // 매혹의 하트비: 공격이 아군이나 자기 자신에게 간다
    const al = B.fighters.filter(x => x !== src && x.hp > 0 && ally(src, x) && realmOf(x) === realmOf(src)), nt = [src, ...al][Math.floor(Math.random() * (al.length + 1))];
    if (!o.quiet) ui.pop(P3(src, 3.6), '💘 착각!', '#ff9ae6'); hurt(src, nt, n, Object.assign({}, o, { charmR: true })); return;
  }
  if (src && src !== t && ally(src, t) && !o.charmR) return;
  if (src && src !== t && !t.minion) t.lastAtk = { f: src, t: B.time };   // 바운티: 처치자 판정
  if (src && src !== t && realmOf(src) !== realmOf(t)) return;
  if (src && src !== t && !o.refl && B.barriers.length) {   // 각성 퓨어바닐라의 반사막: 막는 대신 그대로 되돌려 보낸다
    const rb = B.barriers.find(b => b.refl && b.owner !== src && !ally(b.owner, src) && (b.owner === t || ally(b.owner, t)) && Math.hypot(t.x - b.x, t.y - b.y) < b.r);
    if (rb) { if (!o.quiet) ui.pop(P3(t, 2.6), '↩ 반사!', '#fff3b0'); hurt(t, src, n, { refl: true, quiet: o.quiet, field: o.field }); return; }
  }
  if (src && src !== t && B.barriers.length && inBarrier(src, t)) { if (!o.quiet) ui.pop(P3(t, 2.6), '막힘!', '#fff3b0'); return; }
  if (t.holy > 0 && src && src !== t && !ally(src, t) && !o.refl) { if (!o.quiet || Math.random() < .2) ui.pop(P3(t, 2.6), '🛡 반사!', '#ffd0dc'); if (src.hp > 0) hurt(t, src, n * .5, { refl: true, quiet: true, field: true }); return; }   // 베리 홀리: 막고 절반을 반사
  let d = n * (src ? dmgMul(src) : 1) * (1 - defRed(t));
  if (t.dscale > 0 && src && src !== t && !ally(src, t) && !o.refl && !o.charmR) hurt(t, src, n * .4, { refl: true, quiet: true, field: true });   // 용의 비늘: 같은 공격이 40% 로 되돌아간다
  d = hbHurtAdjust(t, src, d, o); if (t.tdeb > 0) d *= 1.1;   // 시간지기의 평타: 받는 피해 +10%   // 홀리베리: z 피해 감소 / v 불굴(자신 85%, 아군 40% + 대신 맞기)
  if (t.drT > 0) d *= 1 - t.drV;
  if (t.cocoon) { const c = t.cocoon; c.hp -= d; t.cmb = B.time; if (src && src !== t) src.cmb = B.time; ui.pop(P3(t, 2.6), '🕸 ' + Math.round(d), '#e8e8f0'); c.mesh.scale.setScalar(1.12); setTimeout(() => c.mesh && c.mesh.scale.setScalar(1), 80); if (c.hp <= 0) cocoonBreak(t); return; }
  if (t.gabs) { t.gabs.sum += d; t.cmb = B.time; if (src && src !== t) src.cmb = B.time; if (!o.quiet || Math.random() < .2) ui.pop(P3(t, 2.6), '✦ ' + Math.round(d), '#ffd84a'); vfx.burst('glow', P3(t, 1.6), 3, { speed: 3, life: .4, size: .5, c0: 0xffffff, c1: 0xffd84a }); return; }
  if (t.absorb && t.absorb.t > 0 && src && src !== t && !ally(src, t) && !o.charmR) { absorbRec(t, src, d, o); return; }   // 대천사의 흡수
  const dk = src && src !== t && src.def.id === 'dark' && !src.sealSoul && !(src.pseal > 0);   // 어둠마녀 패시브: 보호막 흡수 20% (적중마다, 지속 피해 제외) + 피해 10% 관통
  if (dk && t.shield > 0 && !o.field) { const ab = t.shield * .2; t.shield -= ab; src.shield += ab; src.shieldMax = Math.max(src.shieldMax, src.shield); if (ab >= 1) ui.pop(P3(src, 3.2), '🛡 +' + Math.round(ab), '#ff8a98'); }
  const pierce = dk ? d * .1 : 0; if (dk) d -= pierce;
  if (o.proj && o.proj.sbreak && src && t.shield > 0 && !ally(src, t)) { const sh = t.shield; t.shield = 0; src.shield = (src.shield || 0) + sh; src.shieldMax = Math.max(src.shieldMax || 0, src.shield); ui.pop(P3(src, 3.4), '🛡 흡수 +' + Math.round(sh), '#ffe9a0'); ui.pop(P3(t, 3), '🛡 파괴!', '#ffd84a'); }
  let hpD = d; if (t.shield > 0) { const ab = Math.min(t.shield, d); t.shield -= ab; hpD = d - ab; }
  t.hp = Math.max(0, t.hp - hpD - pierce); t.flash = .12; d += pierce; t.cmb = B.time; if (src && src !== t) src.cmb = B.time;
  if (d > 0 && src && src !== t && !ally(src, t) && B.pfields && B.pfields.length) { const pf = B.pfields.find(p => p.owner.hp > 0 && (p.owner === t || ally(p.owner, t)) && realmOf(p.owner) === realmOf(t) && Math.hypot(t.x - p.x, t.y - p.y) < p.R); if (pf) { t.shield = (t.shield || 0) + d; t.shieldMax = Math.max(t.shieldMax || 0, t.shield); if (!o.quiet || Math.random() < .2) ui.pop(P3(t, 3.2), '🛡 +' + Math.round(d), '#ffc0e0'); } }   // 용언의 보호막: 맞은 만큼 보호막
  if (d > 0 && !t.minion) { const L = t.dmgLog || (t.dmgLog = []); L.push([B.time, d]); while (L.length && L[0][0] < B.time - 60) L.shift(); }   // 최근 1분 받은 피해 기록 (시간의 장판)
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
  if (t.hp <= 0 && t.form === 'pdragon') { endPDragon(t); return; }   // 변신한 용과드래곤이 쓰러지면 쿠키로 돌아온다
  if (t.hp <= 0 && t.form === 'angel') { endArchangel(t); return; }   // 대천사가 격추되면 세인트릴리만 남는다
  if (t.hp <= 0) {
    if (src && src !== t && src.undy > 0) undyKill(src);   // 버닝스파이스 패시브: 불사 중 처치하면 체력 1000 회복
    if (t.ult && t.ult.armed && !t.soul) enterSoul(t); else if (t.def.id === 'burn' && !t.undyUsed && !t.minion && !(t.pseal > 0)) startUndy(t); else if (t.def.id === 'burnA' && !t.beastUsed && !t.minion && !(t.pseal > 0)) startBeast(t); else if (t.def.id === 'mysticA' && !t.beastUsed && !t.minion && !(t.pseal > 0)) startVoidCocoon(t); else if (t.def.id === 'mysticA' && t.form === 'beast' && !t.kingUsed && !t.minion && !(t.pseal > 0)) startSpiderKing(t); else onDeath(t);
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
  if (p.kind === 'silk') {   // 고치의 실: 가늘고 흰 실 가닥
    const sm = new THREE.Group(), th = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.4, 5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfaf4e0 })); sm.add(th);
    for (let i = -2; i <= 2; i++) { const kn = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff })); kn.position.set(Math.sin(i * 1.7) * .12, Math.cos(i * 1.3) * .1, i * .5); sm.add(kn); }
    g.add(sm); g.userData.mesh = sm; glow.scale.setScalar(p.r * S * 6);
  }
  if (p.kind === 'flour') {   // 미스틱플라워의 밀가루: 고운 가루 입자가 뭉쳐 날아간다
    const N = 140, pos = new Float32Array(N * 3), R = p.r * S * 2.2;
    for (let i = 0; i < N; i++) { const u = Math.random(), v = Math.random(), th = u * 6.283, ph = Math.acos(2 * v - 1), rr = R * Math.pow(Math.random(), .6); pos[i * 3] = rr * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = rr * Math.sin(ph) * Math.sin(th) * .8; pos[i * 3 + 2] = rr * Math.cos(ph) * 1.2; }
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const fm = new THREE.Points(gm, new THREE.PointsMaterial({ color: 0xfffaf0, size: .16, sizeAttenuation: true, transparent: true, opacity: .9, depthWrite: false }));
    g.add(fm); g.userData.mesh = fm; glow.scale.setScalar(p.r * S * 6);
  }
  if (p.kind === 'rock') { const rm = new THREE.Mesh(new THREE.DodecahedronGeometry(p.r * S * 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1, flatShading: true })); g.add(rm); g.userData.mesh = rm; glow.scale.setScalar(p.r * S * 4); }
  if (p.kind === 'dkdrag') { const dg = dkaDragon(p.white); dg.scale.setScalar(p.r * S * .35); g.add(dg); g.userData.mesh = dg; glow.scale.setScalar(p.r * S * 7); }
  if (p.kind === 'gspear') { const sp = goldSpear(p.r * S * 5.5, p.r * S * .1); g.add(sp); g.userData.mesh = sp; glow.scale.setScalar(p.r * S * 8); }
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
  p.vis = projVisual(p); p.life0 = p.life; B.projs.push(p);
  vfx.burst('spark', P3(f, 1.2).add(new THREE.Vector3(Math.cos(o.a), 0, Math.sin(o.a)).multiplyScalar(1)), 8, { speed: 3, life: .25, size: .3, c0: p.color });
}
function killProj(p) { p.life = 0; if (p.vis) { world.scene.remove(p.vis); p.vis.traverse(o => { if (o.material) o.material.dispose(); }); p.vis = null; } }
function updProjs(dt) {
  for (const p of B.projs) {
    if (p.homing) { const t = foe(p.owner); if (t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < p.homing) { const want = Math.atan2(t.y - p.y, t.x - p.x), cur = Math.atan2(p.vy, p.vx), d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), na = cur + clamp(d, -p.turn * dt, p.turn * dt), sp = Math.hypot(p.vx, p.vy); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; } }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.age = (p.age || 0) + dt;
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.life = 0;
    const wp = P3(p, p.h0 !== undefined ? lerp(p.h0, 1.2, Math.min(1, p.age / .45)) : 1.2);
    if (p.vis) {
      p.vis.position.copy(wp);
      if (p.kind === 'heart') { p.vis.userData.mesh.rotation.y += dt * 8; p.vis.userData.mesh.rotation.z = Math.sin(B.time * 14) * .3; }
      if (p.kind === 'axe') p.vis.userData.mesh.rotation.x += dt * 20;
      if (p.kind === 'rock') p.vis.userData.mesh.rotation.x += dt * 9;
      if (p.kind === 'flower') p.vis.userData.mesh.rotation.z += dt * 9;
      if (p.kind === 'flour') { const fm = p.vis.userData.mesh; fm.rotation.x += dt * 3; fm.rotation.y += dt * 2.4; fm.scale.setScalar(1 + Math.sin(B.time * 18) * .08); }
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
        p.hit.add(t); hurt(p.owner, t, p.dmg, { dir: Math.atan2(p.vy, p.vx), proj: p }); p.onHit && p.onHit(t);
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
      if (z.onSelf && z.owner.hp > 0 && realmOf(z.owner) === realmOf(z) && Math.hypot(z.owner.x - z.x, z.owner.y - z.y) < z.r + z.owner.r) z.onSelf(z.owner);
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
  if (e !== B.ghost && immune(e) && (e.def.id === 'pva' || e.def.id === 'mystic' || inLdom(e))) { ui.pop(P3(e, 3.4), '저항!', '#fff0a8'); toast(f, '각성 퓨어바닐라 쿠키와 빛의 아공간 안의 아군에게는 정신계 공격이 통하지 않습니다'); return false; }
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
  B.fighters.forEach((o, i) => { const r = m.ret[i]; if (r) { o.x = r.x; o.y = r.y; } });   // 정신세계 중 소환수가 늘어나도 터지지 않게
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
const realmS = () => B && (B.seal || (B.abyss && !B.abyss.done ? B.abyss : null) || (B.dream ? B.dream.rs : null) || (B.voidR ? B.voidR.rs : null) || (B.gk ? B.gk.rs : null));   // 별도 세계(봉인수 내부 / 드래곤의 심연) 상태
const viewRealm = () => { const s = realmS(); return !!(s && (B.fighters[0] === s.target || B.viewSeal)); };
function gameCamPose() {
  let a, b; if (viewRealm()) a = b = realmS().target; else { const main = B.fighters.filter(o => !o.minion && !o.realm); a = main[0] || B.fighters[0]; b = main[1] || a; } const sep = dist(a, b) * S;
  const cv = a.cutV ? a : b.cutV ? b : null;   // 컷신 중에는 시전자(공중에 떠 있어도)를 화면 중앙에 고정해서 따라간다
  const tgt = cv && B.camFocus ? P3(B.camFocus, 1 + (B.camFocus.air || 0)) : cv ? P3(cv, 1 + (cv.air || 0) * .85 + (cv.platY || 0)) : cam.fit && a !== b ? W3((a.x + b.x) / 2, (a.y + b.y) / 2, 1 + ((a.platY || 0) + (b.platY || 0)) / 2) : P3(a, 1 + (a.platY || 0));
  const big = (a.form === 'pdragon' || b.form === 'pdragon' ? 2.4 : 1) * (a.cutV || b.cutV ? 2.1 : 1) * (a.form === 'angel' || b.form === 'angel' ? 3 : 1) * (B.lfaces && B.lfaces.length || (B.lfogs && B.lfogs.some(g => g.head.length)) ? 1.55 : 1) * (a.form === 'dragon' || b.form === 'dragon' ? 1.9 : 1) * (a.big || b.big ? 1.9 : 1) * (a.boss > 0 || b.boss > 0 ? 1.7 : 1);
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
  passive: '갈라진 자국: 적의 영역·정신계 공간 안에서 평타를 쓸 때마다 균열이 남고, 3번 쓰면 그 영역이 갈라져 파괴됩니다.',
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
        name: '하트비 · 변신(각성)', cd: 40, desc: '일반: 하늘에 거대한 리치드래곤의 얼굴이 생겨 매혹의 하트비를 마구 내린다. 다 맞으면 6000, 맞은 적은 5초간 매혹되어 공격이 아군이나 자기 자신에게 향한다. 각성 후: 25초간 리치드래곤(HP 52000)으로 변신', use(f, p) {
          if (!f.awake) { startLichRain(f, p); return; }
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
const immune = t => ((t.def.id === 'pva' || t.def.id === 'mystic' || t.def.id === 'mysticA') && !(t.pseal > 0)) || inLdom(t) || (!t.mindOpen && (t.def.id === 'silent' || t.form === 'dragon' || !!t.def.spirit || !!t.def.kin));
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
      x: { name: '설탕 호수', cd: 8, desc: '일직선으로 광역 핑크빛 설탕 호수를 만들어 4초간 서서히 스며들듯 피해를 준다. 안에 머무르면 총 4000', use(f) { setAnim(f, 'cast', .5); makeLake(f, { kind: 'strip', x: f.x, y: f.y, a: f.face, len: 760, wid: 170, dur: 4, dmg: 4000, color: 0xff9ad8, hi: 0xffffff }); } },
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
      if (l.t >= .35 && l.t < l.dur - .4) {   // 설탕 호수: 서서히 스며들어 지속시간 동안 총 dmg 가 완전히 들어간다
        if (!l.hit) { l.hit = true; shake(.5, .3); }
        const dps = l.dmg / (l.dur - .35 - .4);
        for (const t of B.fighters) {
          if (t === l.owner || t.hp <= 0 || ally(l.owner, t) || realmOf(t) !== realmOf(l.owner)) continue;
          const dx = t.x - l.x, dy = t.y - l.y, al2 = dx * Math.cos(l.a) + dy * Math.sin(l.a), pe = Math.abs(-dx * Math.sin(l.a) + dy * Math.cos(l.a));
          if (al2 > -t.r && al2 < l.len + t.r && pe < l.wid / 2 + t.r) {
            if (inBarrier(l.owner, t)) continue;
            hurt(l.owner, t, dps * dt, { field: true, quiet: true });
            t.lakeAcc = (t.lakeAcc || 0) + dps * dt * dmgMul(l.owner);
            if (t.lakeAcc >= 500) { t.lakeAcc -= 500; ui.pop(P3(t, 2.6), '500', '#ff9ad8'); hitFX(t, l.hi, false); }
          }
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
      a: { name: '핏빛 구체', cd: .95, desc: '시뻘건 유도 마법구체를 발사. 범위 안에서만 유도. 데미지 120', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 500, r: 12, dmg: 120, color: 0xff2438, kind: 'orb', life: 1.2, homing: f.pseal > 0 ? 0 : 340, turn: 3.6 }); } },
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
  for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) t.st[k] = 0;
  if (t.mflame) { t.mflame = null; ui.pop(P3(t, 4), '🔥 필멸의 불꽃 해제!', '#fff3b0', true); }   // 필멸의 불꽃은 퓨어바닐라의 정화로만 꺼진다
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
function startSeal(f, t, tree, enh) {
  clearStates(t); dropOwned(x => x.owner === t); if (B.storm && B.storm.f === t) endStorm(true);
  B.projs.forEach(p => { if (p.owner === t) killProj(p); });
  B.zones.forEach(z => { if (z.owner === t) { vfx.remove(z.tele); vfx.remove(z.tele2); if (z.mesh) world.scene.remove(z.mesh); z.done = true; z.t = 1e9; } });
  B.seal = { owner: f, target: t, ret: { x: t.x, y: t.y }, phase: enh ? 'wave' : 'wraith', enh: !!enh, wave: 0, tree, treeF: null, t: 0 }; B.viewSeal = false; camState.init = false;
  t.realm = 1; t.x = W / 2 - 330; t.y = H / 2; t.st.stun = 0; t.st.inv = 1.2; t.face = 0;
  world.setSealRealm(true); ui.flash('#bfe8ff', .9, .7); shake(.9, .6);
  if (B.fighters[0] === t) { ui.title('봉인수 내부', 'THE SEALED TREE'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2200); toast(t, '망령을 모두 쓰러뜨리고 봉인수를 부수면 봉인이 풀립니다'); }
  else toast(f, '적을 봉인수에 가뒀습니다. G키 또는 버튼으로 내부 화면을 볼 수 있어요');
  if (enh) spawnSoulWave(B.seal); else for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283 + .5; addMinion('mob_wraith', clamp(W / 2 + 80 + Math.cos(a) * 280, W / 2 - 500, W / 2 + 500), clamp(H / 2 + Math.sin(a) * 240, H / 2 - 380, H / 2 + 380), { realm: 1 }); }
}
function updSeal(dt) {
  const s = B.seal; if (!s) return; const t = s.target; s.t += dt;
  for (const m of B.fighters) if (m.minion && m.hp <= 0) { m.deadT = (m.deadT || 0) + dt; if (m.deadT > 1.2 && !m.gone) { m.gone = true; removeFighter(m); } }
  B.fighters = B.fighters.filter(m => !m.gone);
  if (t.hp <= 0 || B.over) return;
  if (s.enh && s.phase === 'wave' && !B.fighters.some(m => m.soulOf && m.hp > 0)) { if (s.wave < 3) spawnSoulWave(s); else s.phase = 'wraith'; }   // 3웨이브가 끝나면 봉인수 출현
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
  B.viewSeal = !B.viewSeal; camState.init = false; ui.toast(B.viewSeal ? (B.dream ? '👁 상대의 꿈 화면' : B.gk ? '👁 가상의 골드치즈 왕국 화면' : B.voidR ? '👁 공허 화면' : B.abyss ? '드래곤의 심연 화면' : '봉인수 내부 화면') : '내 화면');
}
let sealBtn = null;
function updSealBtn() {
  if (!sealBtn) { sealBtn = document.createElement('button'); sealBtn.id = 'sealview'; sealBtn.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:80;padding:8px 16px;border-radius:999px;border:2px solid #7dffd0;background:rgba(6,22,26,.85);color:#bfffe8;font:700 14px sans-serif;display:none;cursor:pointer'; sealBtn.addEventListener('click', toggleSealView); document.body.appendChild(sealBtn); }
  const s = realmS(), dr = !!((B.dream && B.fighters[0] === B.dream.f) || (B.voidR && B.fighters[0] === B.voidR.f) || (B.gk && B.fighters[0] === B.gk.f)), show = !!(s && B.fighters[0] === s.owner); sealBtn.style.display = show ? 'block' : 'none';
  if (dr) { sealBtn.textContent = B.viewSeal ? '↩ 내 화면으로 (G)' : (B.dream ? '👁 상대의 꿈 보기 · 꿈 ' + B.dream.stage : B.gk ? '👁 가상의 골드치즈 왕국 보기' : '👁 공허 보기') + ' (G)'; sealBtn.style.borderColor = '#e0b8ff'; sealBtn.style.color = '#f0dcff'; }
  else if (show) { const ab = !!B.abyss; sealBtn.textContent = B.viewSeal ? '↩ 내 화면으로 (G)' : (ab ? '👁 드래곤의 심연 보기 (G)' : '👁 봉인수 내부 보기 (G)'); sealBtn.style.borderColor = ab ? '#ff6070' : '#7dffd0'; sealBtn.style.color = ab ? '#ffc0c8' : '#bfffe8'; }
  if (B) { world.viewAbyss(!!(B.abyss && !B.abyss.done && viewRealm())); world.viewDream(!!((B.dream || B.voidR || B.gk) && viewRealm())); }
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
  if (f.pseal > 0) f.pseal -= dt;   // 각성 다크카카오: 패시브 봉인 남은 시간
  if (f.shock > 0) { f.shock -= dt; f.shockT -= dt; if (f.shockT <= 0) { f.shockT = 3; f.st.stun = Math.max(f.st.stun, .8); vfx.burst('spark', P3(f, 1.4), 24, { speed: 7, speed2: 16, life: .45, size: .5, c0: 0xffffff, c1: 0xffe040 }); ui.pop(P3(f, 3.8), '⚡ 감전!', '#ffe84a', true); } if (f.shock <= 0) f.shockT = 0; }   // 감전: 3초에 한 번 기절
  if (f.dimm > 0) f.dimm -= dt;
  if (((f.def.id === 'pva' || f.def.id === 'mystic' || f.def.id === 'mysticA') && !(f.pseal > 0)) || f.dimm > 0) { for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) f.st[k] = 0; f.burn = null; f.mflame = null; f.noHeal = 0; f.mindBuff = false; }   // 각성 퓨어바닐라: 디버프 면역
  if (f.noHeal > 0) { f.noHeal -= dt; if (f.hpPrev !== undefined && f.hp > f.hpPrev) f.hp = f.hpPrev; }   // 회복 불가: 늘어난 체력은 되돌린다
  f.hpPrev = f.hp;
  if (f.mflame) {   // 필멸의 불꽃: 초당 500, 퓨어바닐라의 버프(마법의 빛)나 미스틱플라워의 힐(f.mysticHeal)이 있어야만 해제
    const m = f.mflame; m.tick -= dt; const p = P3(f, 1);
    if (Math.random() < .9) vfx.emit('glow', { x: p.x + rnd(-.5, .5), y: rnd(.3, 2.4), z: p.z + rnd(-.5, .5), vy: rnd(2, 6), life: .5, s0: .6, s1: 0, c0: 0xff4a20, c1: 0x300000, drag: 0 });
    if (f.st.lightBuff > 0 || f.mysticHeal > 0) { f.mflame = null; ui.pop(P3(f, 4), '🔥 필멸의 불꽃 해제!', '#fff3b0', true); }
    else if (m.tick <= 0) { m.tick = .5; const d = m.dps * .5; hurt(m.src, f, d / dmgMul(m.src), { quiet: true, field: true }); ui.pop(P3(f, 2.8), Math.round(d), '#ff3a20'); }
  }
  if (f.boss > 0) { f.boss -= dt; if (f.boss <= 0) endBoss(f); }
  if (f.spdBoostT > 0) { f.spdBoostT -= dt; if (f.spdBoostT <= 0) { f.spdBoostT = 0; f.spdBoost = 1; } }
  if (((f.def.id === 'mystic' || f.def.id === 'mysticA') && !(f.pseal > 0)) || f.dimm > 0) { f.dim = 0; f.dimN = 0; }   // 미스틱플라워: 모든 디버프 면역 (시야 디버프 포함)
  if (f.dim > 0) { f.dim -= dt; if (f.dim <= 0) { f.dimN = Math.max(0, (f.dimN || 0) - 1); f.dim = f.dimN > 0 ? 5 : 0; } }   // 암흑의 기운: 3중첩, 마지막 적중 후 5초마다 1중첩씩 풀린다
  if (f === B.fighters[0]) ui.dim(f.dim > 0 ? f.dimN || 0 : 0);
  if (f.bigSword > 0) { f.bigSword -= dt; if (f.bigSword <= 0) { f.bigSword = 0; if (f.bladeM) { f.root.remove(f.bladeM); f.bladeM = null; } ui.pop(P3(f, 4), '검 크기 원래대로', '#c8b0ff'); } else if (f.bladeM) { const k = Math.min(1, (12 - f.bigSword) / .5); f.bladeM.scale.setScalar(.2 + .7 * ease.out(k)); f.bladeM.rotation.y += dt * 1.5; } }
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
  for (const k of ['stun', 'silence', 'slow', 'lock', 'rev', 'charm', 'charmS', 'ctl']) t.st[k] = 0; t.flash = 0;
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
/* ===== 각성 버닝스파이스 쿠키 (HP 40000, 보호막 1000, 패시브: 죽으면 괴수화 부활 HP 12000) ===== */
function mflameOn(t, src, n = 0) {   // 필멸의 불꽃: 초당 500, 퓨어바닐라의 버프/미스틱플라워의 힐로만 해제. n = 부여하는 필멸 스택 수 (괴수화 스킬: 평타1 Z3 X4 C5)
  if (!t || t.hp <= 0 || t.undy > 0 || t.def.id === 'pva' || t.def.id === 'mystic' || (B.fighters.some(m => m.def.id === 'mystic' && m.hp > 0 && m.aura && (m === t || ally(m, t)) && Math.hypot(t.x - m.x, t.y - m.y) < 380 + t.r)) || inLdom(t)) return;
  const dps = 500 * (src.boss > 0 ? 3 : 1);
  if (!t.mflame) { t.mflame = { src, dps, tick: .5, stacks: 0 }; ui.pop(P3(t, 3.4), '🔥 필멸의 불꽃', '#ff3a20', true); } else { t.mflame.dps = Math.max(t.mflame.dps, dps); t.mflame.src = src; }
  if (n > 0) { t.mflame.stacks = Math.min(99, (t.mflame.stacks || 0) + n); ui.pop(P3(t, 3.0), '필멸 ×' + t.mflame.stacks, '#ff9a60'); }
}
function startBeast(t) {   // 패시브: 죽으면 괴수화하여 부활 (HP 12000)
  t.beastUsed = true; t.form = 'beast'; t.formT = 1e9; t.max = 12000; t.hp = 12000; t.shield = 0; t.shieldMax = 0; t.burn = null; t.mflame = null; t.noHeal = 0; t.hpPrev = 12000; t.r = 48; clearStates(t);
  for (const k of ['stun', 'silence', 'slow', 'lock', 'rev', 'charm', 'charmS', 'ctl', 'cdfreeze']) t.st[k] = 0; t.st.inv = 1.5; t.flash = 0;
  const p = P3(t, 1.4);
  vfx.burst('glow', p, 110, { speed: 5, speed2: 22, life: 1.2, life2: 2, size: 1.4, c0: 0xffffff, c1: 0xff2a00, up: 3 }); vfx.burst('spark', p, 80, { speed: 8, speed2: 24, life: 1, size: .8, c0: 0xffe090, c1: 0xff3a10, grav: 3 });
  for (let i = 0; i < 3; i++) vfx.ring(P3(t), { r0: .5, r1: 10 + i * 6, dur: .7 + i * .2, color: i % 2 ? 0xffd070 : 0xff2a00 }); vfx.column(P3(t), { r: 3.2, h: 40, dur: 1.4, color: 0xff3a10, alpha: .8 });
  ui.flash('#ff2a00', .8, .6); shake(1.4, .8); ui.pop(P3(t, 4.6), '👹 괴수화!', '#ff6a30', true); toast(t, '괴수화! 체력 12000으로 부활했습니다');
}
function startBoss(f) {   // V: 맵을 반으로 가르고 불바다 + 20초간 거대 보스 모드
  const r = f.hp / f.max; f.bossSave = { max: f.max, pm: f.pm || 1, area: f.area || 1 }; f.boss = 20;
  f.max = 999999; f.hp = Math.max(1, r * 999999); f.shield = f.shieldMax = 0; f.rooted = true; f.pm = f.bossSave.pm * 6; f.area = f.bossSave.area * 2.5; f.r = 110;   // 비례 변환, 이동 불가, 딜·범위 폭증
  const cx = W / 2; breakTerrain(W / 2, H / 2, Math.hypot(W, H)); B.bushes = []; world.clearBushes();   // 모든 지형지물 소멸
  const fs = B.fire = { owner: f, t: 0, dur: 20, tick: 0, meshes: [] };
  const fm = new THREE.Mesh(new THREE.PlaneGeometry(W * S, H * S), new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: .0, depthWrite: false, blending: THREE.AdditiveBlending })); fm.rotation.x = -Math.PI / 2; fm.position.y = .12; fm.renderOrder = 3; addExtra(fm); fs.sea = fm;
  const cm = new THREE.Mesh(new THREE.PlaneGeometry(3, H * S), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: .0, depthWrite: false, blending: THREE.AdditiveBlending })); cm.rotation.x = -Math.PI / 2; cm.position.set(W3(cx, H / 2).x, .14, 0); cm.renderOrder = 4; addExtra(cm); fs.crack = cm;   // 맵을 가르는 균열
  const p = P3(f, 1.5); vfx.burst('glow', p, 140, { speed: 6, speed2: 30, life: 1.4, life2: 2.4, size: 1.8, c0: 0xffffff, c1: 0xff2a00, up: 4 }); for (let i = 0; i < 4; i++) vfx.ring(P3(f), { r0: 1, r1: 30 + i * 18, dur: .8 + i * .3, color: i % 2 ? 0xffd070 : 0xff2a00 });
  ui.flash('#ff2a00', 1, .7); shake(2, 1.2); ui.title(f.def.name, 'BOSS MODE'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2400);
  ui.pop(P3(f, 7), '🔥 불바다 · 보스 모드!', '#ff6a30', true); toast(f, '맵이 갈라지고 불바다! 20초간 이동할 수 없지만 체력 999999, 모든 스킬이 거대해집니다');
}
function endBoss(f) {
  const sv = f.bossSave || { max: f.def.hp, pm: 1, area: 1 }, r = f.hp / f.max; f.boss = 0;
  f.max = f.form === 'beast' ? 12000 : f.def.hp; f.hp = Math.max(1, Math.min(f.max, r * f.max)); f.rooted = false; f.pm = sv.pm; f.area = sv.area; f.r = f.form === 'beast' ? 48 : 22; f.hpPrev = f.hp;
  ui.pop(P3(f, 4.4), '보스 모드 종료', '#ffb070', true); vfx.ring(P3(f), { r0: 1, r1: 20, dur: .8, color: 0xff6a30 });
}
function updFire(dt) {
  const fs = B.fire; if (!fs) return; fs.t += dt; fs.tick -= dt;
  const u = fs.t / fs.dur, fade = Math.min(1, fs.t / .8) * (1 - sstep(.9, 1, u));
  fs.sea.material.opacity = (.34 + Math.sin(fs.t * 6) * .08) * fade; fs.crack.material.opacity = (.8 + Math.sin(fs.t * 9) * .2) * fade; fs.crack.scale.x = 1 + Math.sin(fs.t * 5) * .3;
  for (let i = 0; i < 5; i++) { const x = rnd(0, W), y = rnd(0, H); vfx.emit('glow', { x: W3r(x, y).x, y: .3, z: W3r(x, y).z, vy: rnd(3, 9), life: rnd(.6, 1.2), s0: rnd(.8, 1.6), s1: 0, c0: 0xffc060, c1: 0xff2a00, a: .8, drag: 0 }); }
  if (fs.tick <= 0) {
    fs.tick = 1;   // 1초당 200
    for (const o of B.fighters) if (o.hp > 0 && !o.realm && o !== fs.owner && !ally(fs.owner, o) && !o.minion) { hurt(fs.owner, o, 200 / dmgMul(fs.owner), { quiet: true, field: true }); ui.pop(P3(o, 2.8), '200', '#ff6a30'); }   // 보스 모드 딜 배수와 무관하게 초당 200
  }
  if (fs.t >= fs.dur) { world.scene.remove(fs.sea); world.scene.remove(fs.crack); B.fire = null; }
}
function footFx(x, y, delay) {   // 붉은 에너지로 이루어진 거대한 인간의 발바닥
  const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const sole = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat); sole.scale.set(1.8, .35, 3.2); g.add(sole);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat); heel.scale.set(1.5, .3, 1.4); heel.position.z = -2.6; g.add(heel);
  [[-1.1, .66], [-.55, .62], [0, .58], [.55, .52], [1.1, .44]].forEach(([tx, ts], i) => { const t = new THREE.Mesh(new THREE.SphereGeometry(ts * .55, 10, 8), mat); t.position.set(tx, 0, 3.6 + (i === 0 || i === 4 ? -.3 : i === 2 ? .2 : 0)); t.scale.y = .5; g.add(t); });
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending })); core.scale.set(1.1, .25, 2.4); g.add(core);
  g.scale.setScalar(1.7); g.rotation.y = rnd(0, 6.283); const T = delay + .45, gp = W3(x, y, 0); let hit = false; g.position.copy(gp).setY(44);
  addFxm(g, T, (u, m, t) => {
    if (t < delay) { m.position.y = lerp(44, .4, (t / delay) ** 2); m.children.forEach(c => c.material.opacity = Math.min(.6, t / .15 * .6)); }
    else { m.position.y = .4; const k = (t - delay) / .45; mat.opacity = .85 * (1 - k); m.scale.setScalar(1.7 * (1 + k * .15)); }
    if (t >= delay && !hit) { hit = true; vfx.ring(gp, { r0: .5, r1: 8, dur: .5, color: 0xff6a30 }); vfx.burst('spark', gp.clone().setY(.6), 24, { speed: 7, speed2: 18, life: .6, size: .6, c0: 0xffffff, c1: 0xff3a10, grav: 6 }); shake(.5, .2); }
  });
}
CHARS.burnA = {
  id: 'burnA', base: 'burn', name: '각성 버닝스파이스 쿠키', color: BRN, fx: 0xff5a1a, cost: 0, hp: 40000, shield: 1000, pref: 3.6, atkRange: 190, aiPref: 100, tag: '화염 · 괴수화 · 필멸의 불꽃 · 불바다',
  passive: '죽으면 괴수화하여 체력 12000으로 부활합니다. (한 경기에 1번)',
  skills: {
    base: {
      a: { name: '쾅 내려찍기', cd: 1.1, desc: '도끼로 쾅 내려찍는 광역 공격 700. 맞은 적은 3초간 체력 회복 불가', use(f) {
        setAnim(f, 'slash', .4); f.swingDir = 1; const ar = f.area || 1, c = { x: f.x + Math.cos(f.face) * 130 * ar, y: f.y + Math.sin(f.face) * 130 * ar }, R = 200 * ar, w = W3r(c.x, c.y, 0);
        vfx.ring(w, { r0: .5, r1: R * S, dur: .45, color: BRN }); vfx.ring(w, { r0: .3, r1: R * S * .6, dur: .6, color: 0xffd070, alpha: .7 }); vfx.burst('spark', w.clone().setY(.6), 30, { speed: 7, speed2: 18, life: .6, size: .6, c0: 0xffffff, c1: BRN, grav: 5 }); shake(.5 * Math.min(2, ar), .25); B.hitstop = Math.max(B.hitstop, .05);
        for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - c.x, t.y - c.y) < R + t.r) { hurt(f, t, 700, { dir: f.face }); t.noHeal = Math.max(t.noHeal || 0, 3); ui.pop(P3(t, 3.8), '💔 회복 불가', '#ffb0b0'); }
      } },
      z: { name: '발바닥 낙하', cd: 35, desc: '위로 점프. 하늘에서 거대한 붉은 에너지의 발바닥이 매우 많이 내려찍음. 발바닥 1개당 2000', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
        setAnim(f, 'cast', .5); f.pose = 'leap'; f.st.inv = Math.max(f.st.inv, 4.5); let sp = 0; const ar = f.area || 1;
        act(f, 4.4, (u, dt) => {
          const t = u * 4.4;
          if (t < .5) f.air = 12 * ease.out(t / .5); else if (t < 3.9) f.air = 12; else f.air = 12 * (1 - ((t - 3.9) / .5) ** 2);
          sp -= dt;
          if (t > .6 && t < 3.9 && sp <= 0) {
            sp = .2; const tg = foe(f); if (!tg || tg === B.ghost) return; const near = Math.random() < .55, a = rnd(0, 6.283), d = near ? rnd(0, 170) : rnd(150, 700 * ar);
            const x = clamp(tg.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(tg.y + Math.sin(a) * d, PAD, H - PAD);
            zone(f, { x, y, r: 125, delay: .55, dmg: 2000, color: 0xff3a20 }); footFx(x, y, .55);
          }
        }, () => { f.air = 0; f.pose = null; f.st.inv = 0; });
      } },
      x: { name: '필멸의 불꽃', cd: 16, desc: '필멸의 불꽃을 4초간 계속 뿜음. 맞으면 초당 500씩 피가 닳고, 퓨어바닐라 쿠키의 버프나 미스틱플라워 쿠키의 힐 없이는 해제 불가', use(f) {
        setAnim(f, 'cast', .5); f.pose = 'raise'; let tick = 0; const ar = f.area || 1, L = 650 * ar;
        act(f, 4, (u, dt) => {
          const tg = foe(f); if (tg && tg !== B.ghost) f.face = ang(f, tg);
          const dx = Math.cos(f.face), dy = Math.sin(f.face), p = P3(f, 2.2);
          for (let i = 0; i < 5; i++) { const sp = rnd(10, 26), sd = rnd(-.22, .22); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, vx: (Math.cos(f.face + sd)) * sp, vy: rnd(-1, 1.5), vz: (Math.sin(f.face + sd)) * sp, life: rnd(.4, .7), s0: rnd(.8, 1.6), s1: .2, c0: 0xffd070, c1: 0xff2a00, a: .9, drag: 1 }); }
          tick -= dt; if (tick <= 0) { tick = .1; for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - f.x, t.y - f.y) < L + t.r && adiff(ang(f, t), f.face) < .5) mflameOn(t, f); }
        }, () => { f.pose = null; });
      } },
      c: { name: '분노의 포효·초음파', cd: 40, desc: '포효(1500) 후 크게 발을 내려찍어 광역 초음파(2500), 도끼를 사방으로 던짐(500 × 8, 이후 적을 추적). 총 8000', use(f) {
        setAnim(f, 'cast', .8); f.pose = 'raise'; const ar = f.area || 1;
        runScript(f, [
          { at: .55, fn: () => { shock(f, 450 * ar, BRN, 1500); ui.flash('#ff8a30', .6, .45); shake(1.2, .7); ui.pop(P3(f, 4.4), '🔥 포효!', '#ffb050', true); for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: .5, r1: 12 + i * 8, dur: .6 + i * .2, color: i % 2 ? 0xffd070 : BRN }); } },
          { at: 1.25, fn: () => { f.pose = null; setAnim(f, 'slash', .4); shock(f, 700 * ar, 0xffd070, 2500); vfx.ring(P3(f), { r0: 1, r1: 700 * ar * S, dur: .9, color: 0xffffff, alpha: .8 }); vfx.column(P3(f), { r: 3, h: 30, dur: .6, color: 0xff6a30, alpha: .7 }); shake(1.6, .9); B.hitstop = Math.max(B.hitstop, .12); ui.flash('#ffd070', .5, .4); ui.pop(P3(f, 4.4), '📢 초음파!', '#ffe090', true); } },
          { at: 1.6, fn: () => { for (let i = 0; i < 8; i++) shoot(f, { a: i / 8 * 6.283, sp: 650, r: 18, dmg: 500, color: BRN, kind: 'axe', life: 2.6, homing: 2200, turn: 3.2, pierce: false }); ui.pop(P3(f, 3.8), '🪓 도끼 난무!', '#ffb050'); } },
        ], 2.0, () => { f.pose = null; });
      } },
      v: { name: '불바다 · 보스 모드', cd: 90, desc: '맵을 반으로 가르고 모든 지형지물을 없애 불바다로(20초, 초당 200). 20초간 거대한 보스가 되어 체력 999999(비례 변환), 이동 불가, 모든 스킬의 딜·범위 폭증', use(f) { if (f.boss > 0) return false; setAnim(f, 'cast', .8); startBoss(f); } },
    }
  }
};
function meteorFx(x, y, delay) {   // 하늘에서 떨어지는 불타는 운석
  const g = new THREE.Group(), rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x3a1408, emissive: 0xff4a10, emissiveIntensity: 1.2, flatShading: true }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending })); g.add(rock, glow);
  const gp = W3(x, y, 0), sx = rnd(-14, 14), sz = rnd(-14, 14); let hit = false;
  addFxm(g, delay + .3, (u, m, t) => {
    const k = Math.min(1, t / delay); m.position.set(gp.x + sx * (1 - k), lerp(46, .8, k * k), gp.z + sz * (1 - k)); rock.rotation.x += .1; rock.rotation.y += .13;
    if (t < delay) { const p = m.position; vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .45, s0: 2, s1: 0, c0: 0xffc060, c1: 0xff2a00, a: .8, drag: 0 }); }
    else { m.visible = false; if (!hit) { hit = true; vfx.ring(gp, { r0: .5, r1: 9, dur: .55, color: 0xff6a30 }); vfx.burst('spark', gp.clone().setY(.6), 26, { speed: 8, speed2: 20, life: .7, size: .7, c0: 0xffffff, c1: 0xff3a10, grav: 6 }); vfx.burst('glow', gp.clone().setY(1), 14, { speed: 3, speed2: 10, life: .8, size: 1.6, c0: 0xffd070, c1: 0xff2a00, up: 3 }); shake(.6, .25); } }
  });
}
function moltFx(f) {   // 필멸의 탈피: 불지네가 껍질을 벗는다
  const p = P3(f, 1.4); vfx.burst('glow', p, 70, { speed: 4, speed2: 18, life: 1, life2: 1.6, size: 1.4, c0: 0xffe0a0, c1: 0xff2a00, up: 2 }); vfx.burst('spark', p, 50, { speed: 8, speed2: 22, life: .9, size: .7, c0: 0xffffff, c1: 0xff6a10, grav: 4 });
  for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: .5, r1: 10 + i * 5, dur: .6 + i * .15, color: i % 2 ? 0xffd070 : 0xff2a00 });
}
CHARS.burnA.skills.beast = {   // 괴수화: 거대 불지네 (받는 피해 45%)
  a: { name: '불지네 돌진', cd: 1.4, desc: '앞으로 돌진하며 공격(600). 이동기', use(f) {
    const tg = foe(f), a = tg && tg !== B.ghost ? ang(f, tg) : f.face, ar = f.area || 1; f.face = a; setAnim(f, 'slash', .4); const hit = new Set(), L = 420 * ar, sp = 1700; let mv = 0;
    act(f, L / sp + .08, (u, dt) => {
      const st = Math.min(L - mv, sp * dt); mv += st; f.x = clamp(f.x + Math.cos(a) * st, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * st, PAD, H - PAD);
      const p = P3(f, 1); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .45, s0: 1.8, s1: 0, c0: 0xffc060, c1: 0xff2a00, a: .8, drag: 0 });
      for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && !hit.has(t) && realmOf(t) === realmOf(f) && dist(f, t) < f.r * 1.3 + t.r + 70 * ar) { hit.add(t); hurt(f, t, 600, { dir: a }); mflameOn(t, f, 1); vfx.burst('spark', P3(t, 1), 14, { speed: 6, speed2: 16, life: .5, size: .5, c0: 0xffffff, c1: BRN, grav: 5 }); shake(.35, .2); }
    });
  } },
  z: { name: '꼬리치기', cd: 12, desc: '거대한 꼬리로 주위를 쓸어버리는 광역 꼬리치기 (3000)', use(f) {
    setAnim(f, 'slash', .6); f.pose = 'raise'; const ar = f.area || 1;
    runScript(f, [{ at: .45, fn: () => { f.pose = null; shock(f, 520 * ar, 0xff7a24, 3000, t => { mflameOn(t, f, 3); const k = ang(f, t); t.x = clamp(t.x + Math.cos(k) * 120, PAD, W - PAD); t.y = clamp(t.y + Math.sin(k) * 120, PAD, H - PAD); }); vfx.column(P3(f), { r: 3, h: 22, dur: .5, color: 0xff6a30, alpha: .7 }); shake(1.1, .5); B.hitstop = Math.max(B.hitstop, .1); ui.pop(P3(f, 4.4), '🐛 꼬리치기!', '#ffb050', true); } }], .9, () => { f.pose = null; });
  } },
  x: { name: '필멸의 불꽃 (불지네)', cd: 24, desc: '필멸의 불꽃을 10초간 뿜음. 총 7000 (맞은 적은 필멸의 불꽃 상태가 됨)', use(f) {
    setAnim(f, 'cast', .5); f.pose = 'raise'; let tick = 0; const ar = f.area || 1, L = 700 * ar, got = new Set();
    act(f, 10, (u, dt) => {
      const tg = foe(f); if (tg && tg !== B.ghost) f.face = ang(f, tg);
      const p = P3(f, 2.4);
      for (let i = 0; i < 7; i++) { const sp = rnd(12, 30), sd = rnd(-.25, .25); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, vx: Math.cos(f.face + sd) * sp, vy: rnd(-1, 1.5), vz: Math.sin(f.face + sd) * sp, life: rnd(.4, .8), s0: rnd(1, 2), s1: .2, c0: 0xffd070, c1: 0xff2a00, a: .9, drag: 1 }); }
      tick -= dt; if (tick <= 0) { tick = .1; for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - f.x, t.y - f.y) < L + t.r && adiff(ang(f, t), f.face) < .55) { hurt(f, t, 70, { quiet: true, field: true }); if (!got.has(t)) { got.add(t); mflameOn(t, f, 4); } else mflameOn(t, f); } }   // 필멸 스택 4 (시전당 1회). 0.1초당 70 × 100틱 = 7000
    }, () => { f.pose = null; });
  } },
  c: { name: '포효 · 메테오', cd: 45, desc: '포효 후 하늘에서 메테오가 여러 개 떨어짐. 총 10000 (포효 1000 + 메테오 12개 × 750)', use(f) {
    setAnim(f, 'cast', .8); f.pose = 'raise'; const ar = f.area || 1;
    const steps = [{ at: .55, fn: () => { shock(f, 500 * ar, BRN, 1000, t => mflameOn(t, f, 5)); ui.flash('#ff8a30', .6, .45); shake(1.2, .7); ui.pop(P3(f, 5), '🔥 포효!', '#ffb050', true); f.pose = null; } }];
    for (let i = 0; i < 12; i++) steps.push({ at: 1.0 + i * .22, fn: () => {
      const tg = foe(f); if (!tg || tg === B.ghost) return; const a = rnd(0, 6.283), d = i < 4 ? rnd(0, 60) : rnd(40, 110 * ar);   // 가만히 있으면 전부 맞는 범위 (총 10000)
      const x = clamp(tg.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(tg.y + Math.sin(a) * d, PAD, H - PAD);
      zone(f, { x, y, r: 130, delay: .7, dmg: 750, color: 0xff4a10 }); meteorFx(x, y, .7);
    } });
    runScript(f, steps, 3.9, () => { f.pose = null; });
  } },
  v: { name: '필멸의 탈피', cd: 22, desc: '필멸의 불꽃이 걸린 적의 필멸 스택 1개를 흡수해 방어력 1% 획득. 그리고 적에게 필멸의 불꽃을 부여', use(f) {
    const ar = f.area || 1, R = 900 * ar, es = B.fighters.filter(t => t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && dist(f, t) < R + t.r);
    if (!es.length) { toast(f, '사거리 밖'); return false; }
    setAnim(f, 'cast', .8); f.pose = 'raise';
    runScript(f, [{ at: .6, fn: () => {
      f.pose = null; moltFx(f); ui.flash('#ff8a30', .5, .4); shake(1, .5);
      for (const t of es) { if (t.hp <= 0) continue; if (t.mflame && t.mflame.stacks > 0) { t.mflame.stacks--; f.molt = Math.min(40, (f.molt || 0) + 1); ui.pop(P3(f, 4.6), '🛡 방어력 +1% (총 ' + f.molt + '%)', '#ffd070', true); } mflameOn(t, f); vfx.ring(P3(t), { r0: .5, r1: 8, dur: .5, color: 0xff3a20 }); }
    } }], 1.0, () => { f.pose = null; });
  } },
};
CHARS.burn.awakeId = 'burnA';
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
      if (o === f || ally(f, o)) { if (inside) { for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) o.st[k] = 0; o.burn = null; } continue; }
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
    if (o === f || ally(f, o)) { for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) o.st[k] = 0; continue; }
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
/* ===== 다크카카오 쿠키 (에인션트, HP 27000, 검사) ===== */
const DKK = 0x8a5cff;
function buildBlade() {   // 거대해진 검 (흑백 이중 날)
  const g = new THREE.Group(), dk = new THREE.Mesh(new THREE.BoxGeometry(.28, 3.2, .12), new THREE.MeshStandardMaterial({ color: 0x14081f, emissive: 0x5a2aa0, emissiveIntensity: 1.1, roughness: .3 })), wh = new THREE.Mesh(new THREE.BoxGeometry(.12, 3.0, .16), new THREE.MeshBasicMaterial({ color: 0xf4ecff, transparent: true, opacity: .75 }));
  const guard = new THREE.Mesh(new THREE.BoxGeometry(1.1, .16, .24), new THREE.MeshStandardMaterial({ color: 0x241038, emissive: 0x8a5cff, emissiveIntensity: .8 })); guard.position.y = -1.6;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(.6, 3.6, .4), new THREE.MeshBasicMaterial({ color: 0xa070ff, transparent: true, opacity: .25, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(dk, wh, guard, glow); g.position.set(1.5, 2.6, 0); return g;
}
function dragonFx(f, white, dur) {   // 검으로 빨려 들어가는 용 (나선 궤적)
  const col = white ? 0xffffff : 0x1a0a2a, g = new THREE.Group(), mat = white ? new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }) : new THREE.MeshStandardMaterial({ color: col, emissive: 0x6a30c0, emissiveIntensity: .9 });
  const segs = []; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.9 - i * .05, 10, 8), mat); segs.push(m); g.add(m); }
  const head = new THREE.Mesh(new THREE.ConeGeometry(.9, 2.2, 8), mat); head.rotation.x = Math.PI / 2; g.add(head);
  const side = white ? 1 : -1, ph = white ? 0 : Math.PI;
  addFxm(g, dur, (u, m, t) => {
    const place = (k, i) => { const R = lerp(14, .5, k) * 1, a = ph + k * 9 * side, y = lerp(16, 3.2, k) + Math.sin(k * 10 + i) * .4; return new THREE.Vector3(f.root.position.x + Math.cos(a) * R, y, f.root.position.z + Math.sin(a) * R); };
    const k0 = Math.min(1, u * 1.08);
    segs.forEach((s, i) => { s.position.copy(place(Math.max(0, k0 - i * .018), i)); s.visible = k0 > i * .018; });
    const hp = place(k0, 0); head.position.copy(hp); const hn = place(Math.min(1, k0 + .02), 0); head.lookAt(hn); m.visible = u < .98;
    if (Math.random() < .6) vfx.emit('glow', { x: hp.x, y: hp.y, z: hp.z, life: .5, s0: 1.2, s1: 0, c0: white ? 0xffffff : 0x8a40ff, c1: white ? 0xffe0a0 : 0x1a0030, a: .8, drag: 0 });
  });
}
CHARS.dkk = {
  id: 'dkk', name: '다크카카오 쿠키', color: DKK, fx: 0xb08cff, cost: 1500, hp: 27000, pref: 3.6, atkRange: 190, aiPref: 110, tag: '암흑 · 대검 · 시야 차단 · 백룡과 흑룡',
  skills: {
    base: {
      a: { name: '암흑 베기', cd: .7, desc: '검을 휘두른다 400. 맞을 때마다 암흑의 기운으로 시야가 좁아짐 (3중첩, 갱신 10초)', use(f) {
        setAnim(f, 'slash', .3); const hits = swing(f, 190 * (f.area || 1), 1.0, 400, DKK);
        for (const t of hits) { if (t.def.id === 'mystic' || (t.team !== undefined && f.team === t.team)) continue; t.dim = 5; t.dimN = Math.min(3, (t.dimN || 0) + 1); ui.pop(P3(t, 3.4), '🌑 시야 ' + t.dimN + '/3', '#b08cff'); }
      } },
      z: { name: '검 거대화', cd: 30, desc: '12초 동안 검이 거대해지며 모든 데미지가 3배', use(f) {
        setAnim(f, 'cast', .6); f.pose = 'raise'; f.bigSword = 12; if (f.bladeM) f.root.remove(f.bladeM); f.bladeM = buildBlade(); f.bladeM.scale.setScalar(.2); f.root.add(f.bladeM);
        vfx.ring(P3(f), { r0: .5, r1: 10, dur: .7, color: DKK }); vfx.burst('glow', P3(f, 1.6), 50, { speed: 3, speed2: 14, life: .9, size: 1, c0: 0xffffff, c1: DKK, up: 3 }); ui.flash('#b08cff', .4, .35); shake(.6, .4); ui.pop(P3(f, 4.4), '⚔ 검 거대화! 데미지 ×3', '#d8c4ff', true);
        runScript(f, [], .6, () => { f.pose = null; });
      } },
      x: { name: '대부채꼴 베기', cd: 14, desc: '방대한 범위를 크게 부채꼴로 벤다 2000', use(f) {
        setAnim(f, 'cast', .5); f.pose = 'raise'; const ar = f.area || 1;
        runScript(f, [{ at: .45, fn: () => { f.pose = null; setAnim(f, 'slash', .4); const hs = swing(f, 720 * ar, 1.25, 2000, DKK); vfx.ring(P3(f), { r0: 1, r1: 720 * ar * S * .8, dur: .6, color: 0xffffff, alpha: .6 }); ui.flash('#b08cff', .35, .3); shake(1.2, .5); B.hitstop = Math.max(B.hitstop, .08); ui.pop(P3(f, 4.4), '🌑 대부채꼴 베기!', '#d8c4ff', true); } }], .9, () => { f.pose = null; });
      } },
      c: { name: '도약 연참', cd: 20, desc: '점프로 적에게 뛰어들어 검 콤보 (총 1500). 보호막을 완전히 제거하며, 보호막이 제거된 타격은 피해가 들어가지 않음', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 1100) { toast(f, '사거리 밖'); return false; }
        setAnim(f, 'cast', .3); f.pose = 'leap'; f.st.inv = Math.max(f.st.inv, .7); const sx = f.x, sy = f.y, T = 2.3; let n = 0;
        act(f, T, (u, dt) => {
          const t = u * T, tg = foe(f); if (!tg || tg === B.ghost || tg.hp <= 0) return; const a = ang(f, tg);
          if (t < .65) { const k = ease.io(t / .65), dx = tg.x - Math.cos(a) * 80, dy = tg.y - Math.sin(a) * 80; f.x = clamp(lerp(sx, dx, k), PAD, W - PAD); f.y = clamp(lerp(sy, dy, k), PAD, H - PAD); f.air = 9 * Math.sin(k * Math.PI); f.face = a; if (n === 0 && t > .6) { vfx.ring(P3(f), { r0: .5, r1: 8, dur: .4, color: DKK }); shake(.5, .2); } }
          else { f.air = 0; f.pose = null; f.face = a; }
          while (n < 5 && t >= .8 + n * .27) {
            n++; setAnim(f, 'slash', .25); f.swingDir = -(f.swingDir || 1);
            const p = P3(f, .9); vfx.slashGround(p, Math.PI / 2 - f.face, { len: 6, color: n % 2 ? 0xffffff : DKK, from: f.swingDir, dur: .25 });
            if (dist(f, tg) < 260 && !inBarrier(f, tg) && !(tg.st.inv > 0 || tg.undy > 0)) {
              if (tg.shield > 0) { tg.shield = 0; tg.shieldMax = 0; ui.pop(P3(tg, 3.6), '🛡 보호막 파괴!', '#d8c4ff', true); vfx.burst('spark', P3(tg, 1.4), 20, { speed: 6, speed2: 14, life: .5, size: .5, c0: 0xffffff, c1: DKK }); }
              else hurt(f, tg, 300, { dir: f.face });
            }
          }
        }, () => { f.air = 0; f.pose = null; f.st.inv = 0; });
      } },
      v: { name: '백룡 · 흑룡의 검기', cd: 60, desc: '[컷신] 검에 하얀 용과 검은 용이 깃들어 강력한 검기를 발사한다 3000', use(f) {
        setAnim(f, 'cast', 1); f.pose = 'raise'; f.st.inv = Math.max(f.st.inv, 3.4); const a0 = foe(f) && foe(f) !== B.ghost ? ang(f, foe(f)) : f.face; f.face = a0;
        ui.cinema(true); ui.title(f.def.name, '백룡 · 흑룡의 검기'); const bb = B;
        dragonFx(f, true, 2.0); dragonFx(f, false, 2.0);
        runScript(f, [
          { at: .2, fn: () => { ui.flash('#ffffff', .6, .5); vfx.ring(P3(f), { r0: 1, r1: 16, dur: 1.2, color: 0xffffff }); } },
          { at: 1.2, fn: () => { ui.flash('#0a0014', .5, .8); vfx.ring(P3(f), { r0: 1, r1: 24, dur: .9, color: DKK }); shake(1, .8); } },
          { at: 2.0, fn: () => {
            ui.cinema(false); ui.title('', ''); f.pose = null; setAnim(f, 'slash', .5); const tg = foe(f), a = tg && tg !== B.ghost ? ang(f, tg) : f.face; f.face = a;
            for (const o of [-.07, 0, .07]) shoot(f, { a: a + o, sp: 1600, r: o ? 40 : 70, dmg: o ? 0 : 3000, color: o < 0 ? 0xffffff : o ? 0x2a0a50 : 0xc8a8ff, life: 1.4, pierce: true });
            vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 22, color: 0xffffff, from: 1, dur: .5 }); vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 22, color: 0x4a1a90, from: -1, dur: .6 });
            ui.flash('#c8a8ff', .5, .6); shake(2, .7); B.hitstop = Math.max(B.hitstop, .12); ui.pop(P3(f, 4.4), '🐉 용의 검기!', '#e8d8ff', true);
          } },
        ], 2.6, () => { f.pose = null; if (B === bb) { ui.cinema(false); ui.title('', ''); } });
      } },
    }
  }
};
/* ===== 각성 다크카카오 쿠키 (id 'dkkA', HP 35000) ===== */
const DKA = 0x9a6cff, SEAL_T = 10;
function sealOn(t, src, dur = SEAL_T) {   // 패시브 봉인: 맞은 적의 패시브가 dur초 동안 꺼진다 (hurt/updCommon/updMystic 등이 f.pseal 을 본다)
  if (!t || t.hp <= 0 || t === src || t.minion) return;
  const was = t.pseal > 0; t.pseal = Math.max(t.pseal || 0, dur);
  if (!was) { ui.pop(P3(t, 3.8), '🔒 패시브 봉인!', '#d8c4ff', true); vfx.burst('spark', P3(t, 1.4), 14, { speed: 4, life: .5, size: .4, c0: 0xffffff, c1: DKA }); }
}
function dkaDragon(white) {   // +z 방향으로 뻗은 용 (머리 + 몸통 마디). 투사체/연출 공용
  const g = new THREE.Group(), mat = white ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false }) : new THREE.MeshStandardMaterial({ color: 0x15082a, emissive: 0x5a20c0, emissiveIntensity: .9, roughness: .5 });
  const head = new THREE.Mesh(new THREE.ConeGeometry(.85, 2.4, 8), mat); head.rotation.x = Math.PI / 2; head.position.z = 1.3; g.add(head);
  for (const sd of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(.2, 1.1, 6), mat); h.position.set(sd * .5, -1, -.7); h.rotation.set(-2.2, 0, sd * .3); head.add(h); }
  const segs = []; for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.8 - i * .045, 10, 8), mat); m.position.z = -i * .9; segs.push(m); g.add(m); }
  g.userData.segs = segs; g.userData.mat = mat; g.userData.head = head; return g;
}
function boltFx(a, b, color = 0xffe84a, life = .2) {   // 지그재그 번개 (월드 좌표 a→b)
  const g = new THREE.Group(), n = 9, mats = [];
  for (let k = 0; k < 3; k++) {
    const pts = []; for (let i = 0; i <= n; i++) { const v = a.clone().lerp(b, i / n); if (i && i < n) v.add(new THREE.Vector3(rnd(-2, 2), rnd(-1.4, 1.4), rnd(-2, 2))); if (k) v.add(new THREE.Vector3(k * .06, 0, k * -.06)); pts.push(v); }
    const m = new THREE.LineBasicMaterial({ color: k ? color : 0xffffff, transparent: true }); mats.push(m); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
  }
  addFxm(g, life, u => mats.forEach(m => m.opacity = 1 - u * u));
}
function buildShip() {   // 다크카카오 왕국의 함선 (+z 가 뱃머리)
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x2a1840, roughness: .7, flatShading: true }), trim = new THREE.MeshStandardMaterial({ color: 0xd8c4ff, emissive: 0x6a3ad0, emissiveIntensity: .9, roughness: .4 }), sail = new THREE.MeshStandardMaterial({ color: 0x4a2a90, emissive: 0x2a1060, emissiveIntensity: .7, side: THREE.DoubleSide, flatShading: true });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.4, 12), wood); hull.position.y = 1.4; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(2.7, 5.5, 4), wood); bow.rotation.set(Math.PI / 2, 0, Math.PI / 4); bow.position.set(0, 1.4, 8.7); g.add(bow);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 13), wood); keel.position.y = -.1; g.add(keel);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(5.8, .5, 12.4), trim); rail.position.y = 2.7; g.add(rail);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, 12, 8), wood); mast.position.set(0, 8, -1); g.add(mast);
  for (const [y, w, h] of [[10.5, 7, 4.5], [5.6, 8.6, 4]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, .15), sail); s.position.set(0, y, -.4); g.add(s); const yd = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, w + .6, 6), trim); yd.rotation.z = Math.PI / 2; yd.position.set(0, y + h / 2, -.4); g.add(yd); }
  const flag = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.4, 2.4), new THREE.MeshBasicMaterial({ color: 0xffffff })); flag.position.set(0, 14.4, -1.8); g.add(flag);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc8a8ff })); eye.position.set(0, 2.4, 11.6); g.add(eye);
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0x8a5cff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); gl.scale.setScalar(26); gl.position.y = 4; g.add(gl);
  return g;
}
CHARS.mob_dkk = mobDef('mob_dkk', '다크카카오 왕국 병사', 0x6a4aa8, 1800, '다크카카오 왕국 · 근접', {
  a: { name: '왕국의 창', cd: 1.2, desc: '근접 90', use(f) { setAnim(f, 'slash', .25); swing(f, 140, 1, 90, 0xc8a8ff); } },
  z: { name: '왕국의 돌격', cd: 8, desc: '근접 광역 250', use(f) { setAnim(f, 'slash', .3); swing(f, 180, 1.6, 250, 0xffffff); } },
}, { range: 150, pref: 90 });
function startShips(f) {   // C 국왕: 함선 2척이 적에게 부딪히고(각 2000), 병사들이 내려 공격한다
  const tg = foe(f); if (!tg || tg === B.ghost || tg.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  B.fighters.forEach(m => { if (m.dkking && m.legionOf === f && m.hp > 0) m.hp = 0; });
  setAnim(f, 'cast', .8); f.pose = 'raise'; runScript(f, [], .9, () => { f.pose = null; });
  ui.flash('#c8a8ff', .4, .4); shake(.8, .6); vfx.ring(P3(f), { r0: .5, r1: 14, dur: .9, color: DKA }); ui.pop(P3(f, 4.6), '🚢 국왕!', '#e8d8ff', true);
  B.dks = B.dks || [];
  for (let i = 0; i < 2; i++) {
    const a = ang(f, tg) + (i ? 1 : -1) * Math.PI / 2, m = buildShip(); m.scale.setScalar(.01); addExtra(m);
    B.dks.push({ owner: f, m, x: f.x + Math.cos(a) * 380, y: f.y + Math.sin(a) * 380, wait: .9 + i * .75, t: 0, state: 'wait', hit: false, left: 6, tick: 0, dockT: 0, yaw: 0 });
  }
  return true;
}
function updDka(dt) {
  if (B.dks && B.dks.length) {
    for (const s of B.dks) {
      const f = s.owner; s.t += dt;
      s.x = clamp(s.x, 40, W - 40); s.y = clamp(s.y, 40, H - 40);
      if (s.state === 'wait') {
        const k = Math.min(1, s.t / .7); s.m.scale.setScalar(Math.max(.01, ease.out(k) * 1.0)); s.m.position.copy(W3(s.x, s.y, 5 + Math.sin(s.t * 3) * .4));
        if (s.t >= s.wait) { s.state = 'fly'; s.t = 0; vfx.ring(W3(s.x, s.y, 1), { r0: .5, r1: 8, dur: .5, color: DKA }); }
      } else if (s.state === 'fly') {
        let tg = s.tg && s.tg.hp > 0 ? s.tg : foe(f); if (!tg || tg === B.ghost) { s.state = 'dock'; s.t = 0; continue; } s.tg = tg;
        const a = ang(s, tg), sp = 1500 * dt; s.x += Math.cos(a) * sp; s.y += Math.sin(a) * sp; s.yaw = Math.atan2(Math.cos(a), Math.sin(a));
        s.m.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); s.m.position.copy(W3(s.x, s.y, 3.2 + Math.sin(s.t * 6) * .3));
        if (Math.random() < .8) { const p = s.m.position; vfx.emit('glow', { x: p.x + rnd(-3, 3), y: p.y + rnd(0, 2), z: p.z + rnd(-3, 3), life: .6, s0: 2.2, s1: 0, c0: 0xc8a8ff, c1: 0x3a1a80, a: .5, drag: 0 }); }
        if (Math.hypot(s.x - tg.x, s.y - tg.y) < 150 + tg.r || s.t > 3) {   // 충돌: 2000 + 패시브 봉인
          if (Math.hypot(s.x - tg.x, s.y - tg.y) < 220 + tg.r) { hurt(f, tg, 2000, { dir: a }); sealOn(tg, f); const p = P3(tg, 1); vfx.burst('spark', p, 40, { speed: 8, speed2: 20, life: .6, size: .6, c0: 0xffffff, c1: DKA }); vfx.ring(p, { r0: .5, r1: 12, dur: .6, color: DKA }); ui.flash('#c8a8ff', .35, .3); shake(1.4, .5); B.hitstop = Math.max(B.hitstop, .08); }
          s.state = 'dock'; s.t = 0;
        }
      } else {   // 정박: 병사들이 내려 적을 공격한다
        const sink = s.t > 10 ? Math.max(0, 1 - (s.t - 10) / .7) : 1; s.m.scale.setScalar(Math.max(.01, sink)); s.m.position.copy(W3(s.x, s.y, 3 + Math.sin(s.t * 2) * .3 - (1 - sink) * 3));
        s.tick -= dt; if (s.left > 0 && s.tick <= 0 && f.hp > 0) {
          s.tick = .22; s.left--; const a = rnd(0, 6.283), x = clamp(s.x + Math.cos(a) * 130, PAD, W - PAD), y = clamp(s.y + Math.sin(a) * 130, PAD, H - PAD);
          const m = addMinion('mob_dkk', x, y, { hp: 1800, pm: f.pm || 1, realm: f.realm, notag: true }); m.team = f.team; m.dkking = true; m.legionOf = f; m.ttl = 16; m.face = f.face; m.cmb = B.time;
          vfx.burst('glow', P3(m, 1), 14, { speed: 3, speed2: 8, life: .6, size: .7, c0: 0xffffff, c1: DKA, up: 2 });
        }
        if (s.t > 10.8) { rmExtra(s.m); s.dead = true; }
      }
    }
    B.dks = B.dks.filter(s => !s.dead);
  }
  if (B.nem) updNemesis(dt);
}
/* ----- V 드래곤 네메시스 ----- */
function dkaSilhouette() {   // 하늘 위 검은 실루엣의 쿠키 (노란 번개의 힘을 내려준다)
  const g = new THREE.Group(), k = new THREE.MeshBasicMaterial({ color: 0x050308 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), k); head.position.y = 6; g.add(head);
  const hat = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.1, 2.2), k); hat.position.y = 8; g.add(hat);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.6, 5.5, 10), k); body.position.y = 2.2; g.add(body);
  for (const sd of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(.5, .7, 5, 8), k); arm.position.set(sd * 2.5, 5.2, 0); arm.rotation.z = sd * -.5; g.add(arm); }
  const sw = new THREE.Mesh(new THREE.BoxGeometry(.45, 11, .3), k); sw.position.set(-3.6, 9.5, 0); sw.rotation.z = .12; g.add(sw);
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xffe040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); gl.scale.setScalar(34); gl.position.y = 5; gl.renderOrder = -1; g.add(gl);
  return g;
}
function startNemesis(f) {
  if (B.nem || f.cutV) return false;
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  setAnim(f, 'cast', 3.3); f.pose = 'raise'; f.st.inv = Math.max(f.st.inv, 3.6); f.cutV = true;
  const mk = white => { const g = dkaDragon(white); addExtra(g); return { white, g, trail: [], pos: P3(f, 3), ang: rnd(0, 6.283), wx: f.x, wy: f.y, h: 3 }; };
  B.nem = { owner: f, t: 0, dr: [mk(true), mk(false)], sil: null, strikes: 0, next: 0, pend: [], cx: f.x, cy: f.y, bolt: 0, charged: false };
  ui.cinema(true); ui.title(f.def.name, '드래곤 네메시스'); ui.flash('#c8a8ff', .5, .5); vfx.ring(P3(f), { r0: .5, r1: 16, dur: 1, color: DKA });
  const bb = B;
  act(f, 3.4, () => { f.pose = 'raise'; }, () => { f.pose = null; f.cutV = false; if (B === bb) { ui.cinema(false); ui.title('', ''); } });
}
function updNemesis(dt) {
  const N = B.nem, f = N.owner; N.t += dt; const t = N.t, TOT = 3.5 + 7.2;
  if (!N.sil && t > 1.1) { N.sil = dkaSilhouette(); N.sil.position.copy(P3({ x: N.cx, y: N.cy }, 34)); N.sil.scale.setScalar(.01); addExtra(N.sil); }
  if (N.sil) { const k = t < 3.2 ? Math.min(1, (t - 1.1) / .6) : Math.max(0, 1 - (t - 3.2) / .5); N.sil.scale.setScalar(Math.max(.01, 2.1 * ease.out(k))); N.sil.lookAt(camera.position.x, N.sil.position.y, camera.position.z); if (t > 3.8) { rmExtra(N.sil); N.sil = null; } }
  for (const [i, d] of N.dr.entries()) {
    const head = d.pos;
    if (t < 1.4) {   // 검을 가리키자 용들이 하늘로 솟구친다 (나선)
      const k = t / 1.4, a = t * 6 + (i ? Math.PI : 0), c = P3({ x: N.cx, y: N.cy }, 0);
      head.set(c.x + Math.cos(a) * (4 + k * 5), 3 + k * 19, c.z + Math.sin(a) * (4 + k * 5));
    } else if (t < 3.5) {   // 하늘에서 번개를 받는다
      const a = t * 2.2 + (i ? Math.PI : 0), c = P3({ x: N.cx, y: N.cy }, 0); head.set(c.x + Math.cos(a) * 10, 22 + Math.sin(t * 5 + i) * 1.2, c.z + Math.sin(a) * 10);
    } else if (t < TOT - .6) {   // 맵 전체를 이리저리 돈다
      if (Math.hypot(d.wx - (head.x / S + W / 2), d.wy - (head.z / S + H / 2)) < 220 || !d.wp) { d.wx = rnd(PAD + 100, W - PAD - 100); d.wy = rnd(PAD + 100, H - PAD - 100); d.wp = true; }
      const hx = head.x / S + W / 2, hy = head.z / S + H / 2, want = Math.atan2(d.wy - hy, d.wx - hx), df = Math.atan2(Math.sin(want - d.ang), Math.cos(want - d.ang)); d.ang += clamp(df, -3 * dt, 3 * dt);
      const sp = 1700 * dt * S; head.x += Math.cos(d.ang) * sp; head.z += Math.sin(d.ang) * sp; head.y = lerp(head.y, 7 + Math.sin(t * 3 + i * 2) * 2, .1);
    } else { head.y += dt * 40; }
    d.trail.push(head.clone()); if (d.trail.length > 80) d.trail.shift();
    const segs = d.g.userData.segs, tl = d.trail, last = tl.length - 1;
    segs.forEach((s, j) => { const p = tl[Math.max(0, last - j * 4)]; s.position.copy(p); s.scale.setScalar(1.7); });
    const hd = d.g.userData.head, p0 = tl[last], p1 = tl[Math.max(0, last - 3)], dv = new THREE.Vector3(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z); if (dv.lengthSq() < 1e-8) dv.set(0, 0, 1); dv.normalize();
    hd.scale.setScalar(1.7); hd.position.copy(p0).addScaledVector(dv, 2.2); hd.lookAt(hd.position.clone().add(dv)); hd.rotateX(Math.PI / 2);
    if (N.charged) { d.g.userData.mat.color && d.g.userData.mat.color.lerp(new THREE.Color(0xffe84a), .08); if (d.g.userData.mat.emissive) d.g.userData.mat.emissive.lerp(new THREE.Color(0xffd000), .1); }
  }
  if (t > 1.7 && t < 3.3) {   // 실루엣이 노란 번개의 힘을 내려준다
    N.bolt -= dt; if (N.bolt <= 0) { N.bolt = .07; if (!N.charged) { N.charged = true; ui.flash('#ffe040', .8, .7); shake(1.6, 1.4); } for (const d of N.dr) boltFx(P3({ x: N.cx, y: N.cy }, 34).add(new THREE.Vector3(rnd(-4, 4), 0, rnd(-4, 4))), d.pos.clone(), 0xffe84a, .2); }
  }
  if (t >= 3.5 && t < TOT - .6) {   // 용들이 번개를 몰고 적에게 내리꽂는다 (총 8번 · 광역 합계 6700)
    N.next -= dt; if (N.next <= 0 && N.strikes < 8) {
      N.next = .85; N.strikes++; const es = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && !o.minion), e = es.length ? es[Math.floor(Math.random() * es.length)] : null;
      const sx = e ? e.x + rnd(-60, 60) : rnd(PAD, W - PAD), sy = e ? e.y + rnd(-60, 60) : rnd(PAD, H - PAD), d = N.dr[N.strikes % 2];
      d.wx = sx; d.wy = sy; d.wp = true; N.pend.push({ t: .5, x: sx, y: sy, ring: vfx.decal(P3({ x: sx, y: sy }), { tex: 'ring', r: 300 * S, color: 0xffe84a, alpha: .85, y: .07 }) });
    }
    for (const q of N.pend) {
      q.t -= dt; if (q.t > 0 || q.done) continue; q.done = true; vfx.remove(q.ring);
      const p = P3(q), top = p.clone(); top.y = 40; for (let k = 0; k < 3; k++) boltFx(top.clone().add(new THREE.Vector3(rnd(-3, 3), 0, rnd(-3, 3))), p.clone(), 0xffe84a, .3);
      vfx.column(p, { r: 5, h: 40, dur: .45, color: 0xffe84a, alpha: .85 }); vfx.ring(p, { r0: 1, r1: 300 * S * 1.1, dur: .5, color: 0xffe84a }); vfx.burst('spark', p.clone().setY(1), 36, { speed: 8, speed2: 22, life: .6, size: .6, c0: 0xffffff, c1: 0xffe040, grav: 4 }); ui.flash('#ffe040', .35, .25); shake(1.2, .35);
      for (const t2 of B.fighters) if (t2 !== f && !ally(f, t2) && t2.hp > 0 && realmOf(t2) === realmOf(f) && Math.hypot(t2.x - q.x, t2.y - q.y) < 300 + t2.r) {
        hurt(f, t2, 6700 / 8, { quiet: true, field: true }); t2.hAcc = (t2.hAcc || 0) + 6700 / 8 * dmgMul(f); ui.pop(P3(t2, 3 + rnd(0, 1)), Math.round(t2.hAcc), '#ffe84a', true); t2.hAcc = 0;
        if (!(t2.shock > 0)) t2.shockT = 3; t2.shock = 9; sealOn(t2, f);
      }
    }
    N.pend = N.pend.filter(q => !q.done);
  }
  if (t >= TOT) { N.dr.forEach(d => rmExtra(d.g)); if (N.sil) rmExtra(N.sil); N.pend.forEach(q => vfx.remove(q.ring)); B.nem = null; }
}
CHARS.dkkA = {
  id: 'dkkA', base: 'dkk', name: '각성 다크카카오 쿠키', color: DKA, fx: 0xc8a8ff, cost: 0, hp: 35000, pref: 3.6, atkRange: 640, aiPref: 380, tag: '각성 · 용군주 · 패시브 봉인 · 영역 가르기 · 함선 · 드래곤 네메시스',
  passive: '평타와 스킬에 맞은 적은 패시브가 10초 동안 봉인됩니다. (유도 공격, 따라다니는 영역, 불사, 면역 등)',
  skills: {
    base: {
      a: { name: '용군주의 참격', cd: 2.6, desc: '검기와 함께 검은 용 · 하얀 용을 발사한다 1000. 맞은 적은 패시브 봉인', use(f) {
        setAnim(f, 'slash', .4); f.swingDir = -(f.swingDir || 1); const a = f.face; vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 16, color: 0xffffff, from: f.swingDir, dur: .35 }); vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 16, color: DKA, from: -f.swingDir, dur: .4 });
        shoot(f, { a, sp: 1250, r: 60, dmg: 1000, color: DKA, kind: 'wave', life: 1.2, pierce: true, onHit: t => sealOn(t, f) });
        shoot(f, { a: a - .1, sp: 1250, r: 36, dmg: 0, color: 0xffffff, kind: 'dkdrag', white: true, life: 1.2, pierce: true }); shoot(f, { a: a + .1, sp: 1250, r: 36, dmg: 0, color: 0x6a30d0, kind: 'dkdrag', white: false, life: 1.2, pierce: true });
        B.hitstop = Math.max(B.hitstop, .03);
      } },
      z: { name: '용군주의 일격', cd: 13, desc: '적에게 돌진해 닿으면 높이 점프해서 반으로 가르듯 내리벤다. 돌진 400 + 가르기 2000 = 2400. 맞은 적은 패시브 봉인', use(f) {
        const tg = foe(f); if (!tg || tg === B.ghost || tg.hp <= 0 || dist(f, tg) > 950) { toast(f, '사거리 밖'); return false; }
        setAnim(f, 'slash', .3); let st = 0, t0 = 0, cx = 0, cy = 0; const T = 1.9;
        act(f, T, (u, dt) => {
          const t = u * T, a = ang(f, tg);
          if (st === 0) {   // 돌진
            f.face = a; const step = 2100 * dt; f.x = clamp(f.x + Math.cos(a) * step, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * step, PAD, H - PAD);
            if (Math.random() < .9) vfx.emit('glow', { x: P3(f).x, y: 1.2, z: P3(f).z, life: .4, s0: 1.4, s1: 0, c0: 0xffffff, c1: DKA, a: .7, drag: 0 });
            if (tg.hp > 0 && dist(f, tg) < f.r + tg.r + 70) { st = 1; t0 = t; cx = tg.x; cy = tg.y; hurt(f, tg, 400, { dir: a }); sealOn(tg, f); f.pose = 'leap'; vfx.ring(P3(f), { r0: .5, r1: 7, dur: .4, color: DKA }); shake(.6, .25); }
            else if (t > .7 || tg.hp <= 0) { st = 4; f.pose = null; }
          } else if (st === 1) {   // 점프 (적 위로)
            const k = Math.min(1, (t - t0) / .55); f.air = 13 * ease.out(k); if (tg.hp > 0) { cx = tg.x; cy = tg.y; } f.face = ang(f, { x: cx, y: cy }); f.x = lerp(f.x, cx - Math.cos(f.face) * 60, .12); f.y = lerp(f.y, cy - Math.sin(f.face) * 60, .12);
            if (k >= 1) { st = 2; t0 = t; vfx.burst('glow', P3(f, 13 * S * 8), 30, { speed: 4, life: .5, size: .9, c0: 0xffffff, c1: DKA }); }
          } else if (st === 2) {   // 내리꽂으며 반으로 가른다
            const k = Math.min(1, (t - t0) / .22); f.air = 13 * (1 - k * k);
            if (k >= 1) {
              st = 3; f.air = 0; f.pose = null; setAnim(f, 'slash', .4); const a2 = f.face, p = P3(f, .9);
              vfx.slashGround(p, Math.PI / 2 - a2, { len: 26, color: 0xffffff, from: 1, dur: .55 }); vfx.slashGround(p, Math.PI / 2 - a2, { len: 26, color: DKA, from: -1, dur: .6 }); vfx.column(p, { r: 2.4, h: 30, dur: .5, color: 0xffffff, alpha: .7 }); vfx.ring(p, { r0: 1, r1: 14, dur: .6, color: DKA });
              ui.flash('#ffffff', .5, .35); shake(1.8, .5); B.hitstop = Math.max(B.hitstop, .12); ui.pop(P3(f, 4.4), '⚔ 용군주의 일격!', '#e8d8ff', true);
              for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < 330 + o.r) { hurt(f, o, 2000, { dir: a2 }); sealOn(o, f); }
            }
          }
        }, () => { f.air = 0; f.pose = null; });
      } },
      x: { name: '영역 가르기', cd: 30, desc: '거대한 검풍으로 모든 영역(낙원·정신세계·아공간·장막·호수 등)을 가르고 주변 적에게 4000. 5초간 디버프 면역', use(f) {
        setAnim(f, 'slash', .6); f.pose = 'raise'; f.dimm = 5; for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl']) f.st[k] = 0;
        runScript(f, [{ at: .45, fn: () => {
          f.pose = null; setAnim(f, 'slash', .4); const p = P3(f, .9), R = 1100; let n = 0;
          vfx.slashGround(p, Math.PI / 2 - f.face, { len: 34, color: 0xffffff, from: 1, dur: .6 }); vfx.slashGround(p, Math.PI / 2 - f.face + Math.PI / 2, { len: 34, color: DKA, from: -1, dur: .6 });
          vfx.ring(p, { r0: 1, r1: R * S, dur: .8, color: 0xffffff }); vfx.ring(p, { r0: 1, r1: R * S * .7, dur: 1, color: DKA }); ui.flash('#e8d8ff', .6, .5); shake(1.6, .6); B.hitstop = Math.max(B.hitstop, .1); ui.pop(P3(f, 4.4), '🌀 영역 가르기!', '#e8d8ff', true);
          for (const o of B.fighters) if (o !== f && !ally(f, o) && !o.minion) {
            n += breakDomains(o); if (o.ldom) { endLdom(o, true); n++; } if (o.vdom) { endSteamer(o, true); n++; }
          }
          if (B.mind && !ally(f, B.mind.f)) { endMind(); n++; ui.pop(P3(f, 5), '정신세계 해제!', '#ff9ae6', true); }
          if (B.abyss && !B.abyss.done && !ally(f, B.abyss.owner)) { endAbyss(true); n++; }
          if (B.seal && !ally(f, B.seal.owner)) { endSeal(); n++; }
          if (n) ui.pop(P3(f, 3.6), `영역 ${n}개 해제`, '#d8c4ff');
          for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < R + o.r) { hurt(f, o, 4000, { dir: ang(f, o) }); sealOn(o, f); }
        } }], .9, () => { f.pose = null; });
      } },
      c: { name: '국왕', cd: 40, desc: '다크카카오 왕국의 함선 2척을 소환해 적에게 부딪힌다 (각 2000, 패시브 봉인). 함선에서 왕국 병사들이 내려 적을 공격한다', use(f) { return startShips(f); } },
      v: { name: '드래곤 네메시스', cd: 70, desc: '[컷신] 검으로 하늘을 가리키면 검은 용·하얀 용이 하늘로 올라가 노란 번개의 힘을 받는다. 용들이 맵 전체를 돌며 광역 번개 8번 (합계 6700) + 감전(3초마다 발동)', use(f) { return startNemesis(f); } },
    }
  }
};
CHARS.dkk.awakeId = 'dkkA';
/* ===== 각성 리치드래곤 쿠키 (id 'lichA', HP 30000) ===== */
const LCH = 0xc46bff;
CHARS.lich_dream = { ...CHARS.lich, hp: 2000, mob: true, aiPref: 240, atkRange: 420, dragon: undefined, awake: undefined, ult: undefined, tag: '몽롱한 꿈 분신', skills: { base: { a: { name: '꿈의 하트', cd: 1.1, desc: '분신의 하트 200', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 520, r: 11, dmg: 200, color: 0xff7ae0, kind: 'heart', life: 1.05 }); } } } } };
function lichAFace(scale) {
  const hd = buildDragonHead();
  if (hd) { hd.scale.setScalar(5.5 / Math.max(.5, hd.userData.size)); const w = new THREE.Group(); w.add(hd); w.scale.setScalar(scale); return w; }   // 실제 용 모델 머리 (scale 1 ≈ 폭 5.5)
  return lichAFaceOld(scale);
}
function lichAFaceOld(scale) {   // 거대한 얼굴 (임시: 절차 모델. 실제 용 모델에서 얼굴만 떼어내는 건 스킨드 메시라 어려워 보류)
  const g = buildLichFace(); g.scale.setScalar(scale); return g;
}
function startLichFace(f) {   // Z: 앞에 거대한 얼굴이 나타나 하트를 마구 쏜다 (하트당 600)
  const tg = foe(f), a = tg && tg !== B.ghost ? ang(f, tg) : f.face, fx = clamp(f.x + Math.cos(a) * 130, PAD, W - PAD), fy = clamp(f.y + Math.sin(a) * 130, PAD, H - PAD);
  setAnim(f, 'cast', 1); const face = lichAFace(.01); face.position.copy(W3(fx, fy, 6)); face.lookAt(W3(fx + Math.cos(a) * 100, fy + Math.sin(a) * 100, 6)); addExtra(face);
  B.lfaces = B.lfaces || []; B.lfaces.push({ owner: f, face, t: 0, n: 0, N: 45, fx, fy, a });
  vfx.ring(P3(f), { r0: .5, r1: 10, dur: .7, color: 0xff6ad8 }); ui.flash('#ff6ad8', .3, .4); shake(.8, .6); ui.pop(P3(f, 4.4), '💗 거대한 얼굴!', '#ff9ae6', true);
}
function startCtl2(f, e) {   // X: 정신의 심연 — 40초 동안 적을 조종한다 (Q 로 나 ↔ 적 번갈아 조종)
  if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 900) { toast(f, '사거리 밖'); return false; }
  if (f.ctl2) return false; if (immune(e)) { ui.pop(P3(e, 3.4), '저항!', '#9fb8ff'); toast(f, '정신계 면역 대상입니다'); return false; }
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  setAnim(f, 'cast', .7); e.ctl2Orig = { team: e.team }; e.team = f.team; e.ctl2by = f; f.ctl2 = { t: e, left: 40, cur: 'me', fx: 0 };
  ui.flash('#6a3ad0', .5, .5); vfx.ring(P3(e), { r0: .5, r1: 8, dur: .8, color: LCH }); ui.pop(P3(e, 3.8), '🧠 정신의 심연! 40초 조종', '#d8b0ff', true); toast(f, 'Q: 나 ↔ 조종당하는 적 전환');
}
function endCtl2(f) {
  const c = f.ctl2; if (!c) return; const e = c.t; f.ctl2 = null;
  if (e) { e.team = e.ctl2Orig ? e.ctl2Orig.team : undefined; e.ctl2by = null; e.ctl2Orig = null; ui.pop(P3(e, 3.6), '조종 해제', '#d8b0ff'); }
}
function startDreamClones(f) {   // C: 몽롱한 꿈 — 분신 5개 (HP 2000, 진짜로 공격)
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  B.fighters.forEach(m => { if (m.dreamOf === f && m.hp > 0) m.hp = 0; });
  setAnim(f, 'cast', .7); ui.flash('#c46bff', .4, .4); vfx.ring(P3(f), { r0: .5, r1: 12, dur: .8, color: LCH });
  for (let i = 0; i < 5; i++) {
    const a = f.face + (i - 2) * 1.0, x = clamp(f.x + Math.cos(a) * 200, PAD, W - PAD), y = clamp(f.y + Math.sin(a) * 200, PAD, H - PAD);
    const m = addMinion('lich_dream', x, y, { hp: 2000, pm: f.pm || 1, realm: f.realm, notag: true }); m.team = f.team; m.dreamOf = f; m.ttl = 20; m.face = f.face; m.cmb = B.time;
    m.root.traverse(o => { if (o.material && o.material.transparent !== undefined) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .75; } });
    vfx.burst('glow', P3(m, 1), 16, { speed: 3, speed2: 8, life: .7, size: .8, c0: 0xffffff, c1: LCH, up: 2 });
  }
  ui.pop(P3(f, 4.4), '💤 몽롱한 꿈!', '#e0b8ff', true);
}
function startIllusion(f) {   // V: 환각 — 진짜와 같은 스펙·현재 체력의 분신이 싸우고, 진짜는 적에게 안 보인다
  if (f.illuClone && f.illuClone.hp > 0) return false;
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  setAnim(f, 'cast', .8); const a = f.face + Math.PI / 2, x = clamp(f.x + Math.cos(a) * 160, PAD, W - PAD), y = clamp(f.y + Math.sin(a) * 160, PAD, H - PAD);
  const m = addMinion('lichA', x, y, { hp: f.hp, pm: f.pm || 1, realm: f.realm, notag: false }); m.max = f.max; m.hp = f.hp; m.shield = f.shield; m.shieldMax = f.shieldMax; m.team = f.team; m.illu = true; m.illuOf = f; m.ttl = 30; m.nick = f.nick; m.face = f.face; m.cmb = B.time; m.cd.v = 99; m.cd.c = 99;
  f.illuClone = m; f.nofoe = true; if (f.ctrl.kind === 'ai') f.hidden = true;
  ui.flash('#c46bff', .5, .5); vfx.ring(P3(f), { r0: .5, r1: 12, dur: .8, color: LCH }); vfx.burst('glow', P3(f, 1.4), 40, { speed: 3, speed2: 12, life: .9, size: 1, c0: 0xffffff, c1: LCH, up: 3 }); ui.pop(P3(f, 4.4), '👁 환각!', '#e0b8ff', true);
}
function startBreath(f) {   // 변신 Z: 보라 브레스 (최대 10초, 총 5500, Z 다시 누르면 중단) — 맞으면 시야 방해
  if (f.breath) { f.breath.t = f.breath.dur; return 'nocd'; }
  setAnim(f, 'breath', 10); const g = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xb050ff, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); addExtra(g);
  f.breath = { t: 0, dur: 10, tick: 0, cone: g, hit: new Set() }; f.rooted = true; ui.flash('#a040ff', .4, .4); shake(.8, .5); return 'nocd';
}
function endBreath(f) { const b = f.breath; if (!b) return; rmExtra(b.cone); f.breath = null; f.rooted = false; f.cd.z = 12; setAnim(f, 'cast', .2); }
function tailSlash(f) {   // 변신 X: 리치 참 — 꼬리로 넉백 후 상대 몸에서 참격이 마구 베어낸다 (총 6000 = 꼬리 1000 + 참격 10×500)
  setAnim(f, 'tail', .6); const hits = []; vfx.slashGround(P3(f), 0, { len: 10, color: LCH, dur: .5, from: 3 }); vfx.slashGround(P3(f), Math.PI, { len: 10, color: 0xffffff, dur: .5, from: 3 }); shake(1, .5);
  for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && dist(f, t) < 420 + t.r) { hurt(f, t, 1000, { dir: ang(f, t) }); hits.push(t); const a = ang(f, t); t.kb = { vx: Math.cos(a) * 1500, vy: Math.sin(a) * 1500, t: .3 }; }
  const steps = []; for (let i = 0; i < 10; i++) steps.push({ at: .45 + i * .16, fn: () => { for (const t of hits) if (t.hp > 0) { hurt(f, t, 500, { quiet: true, field: true }); const c = P3(t, 1.4 + rnd(-.4, .4)), r = rnd(0, 3.14); vfx.slashBB(c, { rot: r, len: 5, color: i % 2 ? 0xffffff : LCH }); vfx.burst('spark', c, 8, { speed: 5, life: .3, size: .4, c0: 0xffffff, c1: LCH }); t.hAcc = (t.hAcc || 0) + 500 * dmgMul(f); if (t.hAcc >= 1000) { ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(t.hAcc), '#e0b8ff', true); t.hAcc = 0; } } } });
  runScript(f, steps, .45 + 10 * .16 + .3);
}
function startPurpleFog(f) {   // 변신 C: 자줏빛 안개 (14초) — 안에서 가끔 투명, 가끔 적 앞에 머리가 나와 브레스
  setAnim(f, 'roar', .8); const R = 520, p = P3(f); B.lfogs = B.lfogs || [];
  const fog = vfx.decal(p, { tex: 'glow', r: R * S, color: 0x9a3cff, alpha: .5, y: .08 }), cloud = new THREE.Mesh(new THREE.CylinderGeometry(R * S, R * S, 5, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x8a30e0, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide })); cloud.position.copy(p).setY(2.5); addExtra(cloud);
  B.lfogs.push({ owner: f, x: f.x, y: f.y, r: R, t: 0, dur: 14, fog, cloud, inv: 0, nxt: 1.5, head: [] }); ui.flash('#9a3cff', .5, .5); ui.pop(P3(f, 4.4), '🌫 자줏빛 안개!', '#d8b0ff', true);
}
function startEndSky(f) {   // 변신 V: 종말의 하늘 — 달이 자줏빛, 별이 떨어지고(합계 12000), 마지막에 거대한 얼굴이 거대 하트(4000)를 쏜다
  if (B.esky) return false; setAnim(f, 'roar', 1.2); f.st.inv = Math.max(f.st.inv, 1);
  B.esky = { owner: f, t: 0, n: 0, N: 80, stars: [], big: null, face: null, heart: null, hitBig: false, tint: null };
  ui.tint('rgba(120,30,200,.28)'); ui.flash('#a040ff', .8, .8); shake(1.5, 1); ui.title(f.def.name, '종말의 하늘'); setTimeout(() => ui.title('', ''), 2200); ui.pop(P3(f, 4.4), '🌌 종말의 하늘!', '#e0b8ff', true);
}
function updLichA(dt) {
  // --- 거대한 얼굴 하트 ---
  if (B.lfaces && B.lfaces.length) {
    for (const q of B.lfaces) {
      const f = q.owner; q.t += dt; const u = Math.min(1, q.t / .8), out = q.t > .8 + q.N * .07 + .3 ? Math.max(0, 1 - (q.t - (.8 + q.N * .07 + .3)) / .5) : 1; q.face.scale.setScalar(Math.max(.01, 3.2 * ease.out(u) * out)); q.face.position.y = 6 + Math.sin(q.t * 2) * .3;
      while (q.n < q.N && q.t >= .8 + q.n * .07 && f.hp > 0) { q.n++; const tg = foe(f), a = (tg && tg !== B.ghost ? Math.atan2(tg.y - q.fy, tg.x - q.fx) : q.a) + rnd(-.3, .3); shoot(f, { x: q.fx, y: q.fy, a, sp: 700, r: 13, dmg: 600, color: 0xff7ae0, kind: 'heart', life: 1.5, h0: 6 }); }
      if (q.t > .8 + q.N * .07 + .9) { rmExtra(q.face); q.done = true; }
    }
    B.lfaces = B.lfaces.filter(q => !q.done);
  }
  for (const f of B.fighters) {
    // --- 정신의 심연 (조종) ---
    if (f.ctl2) {
      const c = f.ctl2, e = c.t; c.left -= dt; c.fx -= dt;
      if (c.fx <= 0) { c.fx = .15; if (e) vfx.line('glow', P3(f, 2.4), P3(e, 2.4), 5, { size: .5, size1: .1, c0: 0xd8b0ff, c1: 0x4a1a90, life: .6, rad: .3, v: 1 }); }
      if (c.left <= 0 || !e || e.hp <= 0 || f.hp <= 0) endCtl2(f);
    }
    // --- 보라 브레스 ---
    if (f.breath) {
      const b = f.breath; b.t += dt; b.tick -= dt; f.rooted = true; const L = 760, half = .42, a = f.face, p = P3(f, 1.6);
      b.cone.position.copy(p).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(L * S * .5)); b.cone.scale.set(Math.tan(half) * L * S, L * S, Math.tan(half) * L * S); b.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      for (let i = 0; i < 4; i++) { const d = rnd(1, L) * S, o = rnd(-half, half) * d; vfx.emit('glow', { x: p.x + Math.cos(a) * d - Math.sin(a) * o, y: 1.5 + rnd(-.8, .8), z: p.z + Math.sin(a) * d + Math.cos(a) * o, life: .4, s0: 1.4, s1: 0, c0: 0xffffff, c1: 0x8a30e0, a: .6, drag: 0 }); }
      if (b.tick <= 0) {
        b.tick = .1; shake(.25, .12);
        for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f)) { const d = dist(f, t); if (d < L + t.r && adiff(ang(f, t), a) < half + Math.atan2(t.r, Math.max(d, 1))) { hurt(f, t, 55, { quiet: true, field: true, dir: a }); t.fear = Math.max(t.fear || 0, 2.5); t.hAcc = (t.hAcc || 0) + 55 * dmgMul(f); if (t.hAcc >= 1100) { ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(t.hAcc), '#d8b0ff', true); t.hAcc = 0; } } }
      }
      if (b.t >= b.dur || f.hp <= 0 || f.st.stun > 0) endBreath(f);
    }
    // --- 환각 정리 ---
    if (f.illuClone && (f.illuClone.hp <= 0 || f.illuClone.ttl <= 0 || f.hp <= 0)) { f.illuClone.hp = Math.min(f.illuClone.hp, 0); f.illuClone = null; f.nofoe = false; f.hidden = false; vfx.burst('glow', P3(f, 1.4), 20, { speed: 3, life: .6, size: .8, c0: 0xffffff, c1: LCH }); ui.pop(P3(f, 3.8), '👁 환각 해제', '#e0b8ff'); }
    // --- 이동기(넉백) ---
    if (f.kb) { f.x = clamp(f.x + f.kb.vx * dt, PAD, W - PAD); f.y = clamp(f.y + f.kb.vy * dt, PAD, H - PAD); f.kb.t -= dt; if (f.kb.t <= 0) f.kb = null; }
    if (f.fear > 0) f.fear -= dt; if (f.pinkT > 0) f.pinkT -= dt;
  }
  ui.fear(B.fighters[0] && B.fighters[0].fear > 0); ui.pink(B.fighters[0] && B.fighters[0].pinkT > 0);
  // --- 자줏빛 안개 ---
  if (B.lfogs && B.lfogs.length) {
    for (const g of B.lfogs) {
      const f = g.owner; g.t += dt; g.nxt -= dt; const inside = f.hp > 0 && Math.hypot(f.x - g.x, f.y - g.y) < g.r;
      g.cloud.rotation.y += dt * .3; g.cloud.material.opacity = .28 * (g.t > g.dur - 1 ? Math.max(0, g.dur - g.t) : 1);
      if (inside) { if (g.inv > 0) { g.inv -= dt; f.hidden = true; if (g.inv <= 0) f.hidden = false; } }
      else if (g.inv > 0) { g.inv = 0; f.hidden = false; }
      if (g.nxt <= 0 && f.hp > 0) {
        g.nxt = 2.2;
        if (inside && Math.random() < .5) { g.inv = 1.6; ui.pop(P3(f, 3.8), '투명', '#d8b0ff'); }
        const es = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - g.x, o.y - g.y) < g.r + o.r), e = es.length ? es[Math.floor(Math.random() * es.length)] : null;
        if (e) {   // 적 앞에 머리가 나와 브레스
          const a = ang(e, f) + rnd(-.5, .5), hx = clamp(e.x + Math.cos(a) * 480, PAD, W - PAD), hy = clamp(e.y + Math.sin(a) * 480, PAD, H - PAD), hd = lichAFace(.01); hd.position.copy(W3(hx, hy, 3.5)); hd.lookAt(P3(e, 3)); addExtra(hd);
          g.head.push({ m: hd, t: 0, e, x: hx, y: hy, fired: false });
        }
      }
      for (const h of g.head) {
        h.t += dt; h.m.scale.setScalar(Math.max(.01, 2.6 * ease.out(Math.min(1, h.t / .35)) * (h.t > 1.1 ? Math.max(0, 1 - (h.t - 1.1) / .3) : 1)));
        if (h.t > .5 && !h.fired) { h.fired = true; const a = Math.atan2(h.e.y - h.y, h.e.x - h.x); shoot(f, { x: h.x, y: h.y, a, sp: 1100, r: 40, dmg: 700, color: 0xb050ff, kind: 'beam', life: .6, pierce: true, h0: 3, onHit: t => { t.fear = Math.max(t.fear || 0, 2); } }); shake(.4, .3); }
        if (h.t > 1.4) { rmExtra(h.m); h.done = true; }
      }
      g.head = g.head.filter(h => !h.done);
      if (g.t >= g.dur || f.hp <= 0) { vfx.remove(g.fog); rmExtra(g.cloud); g.head.forEach(h => rmExtra(h.m)); f.hidden = false; g.done = true; }
    }
    B.lfogs = B.lfogs.filter(g => !g.done);
  }
  if (B.esky) updEndSky(dt);
  if (B.dream) updDream(dt);
  if (B.gk) updGk(dt);
}
function updEndSky(dt) {
  const q = B.esky, f = q.owner; q.t += dt; const t = q.t;
  if (f.hp <= 0) { endEndSky(); return; }
  const es = () => B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && !o.minion);
  while (q.n < q.N && t >= 1 + q.n * .1) {   // 별이 마구 떨어진다 (80개 × 150 = 12000)
    q.n++; const e0 = es(), e = e0.length ? e0[Math.floor(Math.random() * e0.length)] : null, a = rnd(0, 6.283), d = q.n % 2 ? rnd(0, 70) : rnd(0, 150), bx = e ? e.x : rnd(PAD, W - PAD), by = e ? e.y : rnd(PAD, H - PAD), x = clamp(bx + Math.cos(a) * d, PAD, W - PAD), y = clamp(by + Math.sin(a) * d, PAD, H - PAD);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(.9, 0), new THREE.MeshBasicMaterial({ color: 0xffe9a0 })); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xd890ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); gl.scale.setScalar(5); m.add(gl); m.position.copy(W3(x, y, 45)); addExtra(m); q.stars.push({ m, x, y, t: 0, fall: .7 });
  }
  for (const s of q.stars) {
    s.t += dt; s.m.position.copy(W3(s.x, s.y, lerp(45, .5, Math.min(1, s.t / s.fall) ** 2))); s.m.rotation.y += dt * 6;
    if (s.t >= s.fall && !s.done) { s.done = true; rmExtra(s.m); const p = W3(s.x, s.y, .3); vfx.burst('spark', p, 6, { speed: 3, speed2: 8, life: .5, size: .5, c0: 0xffffff, c1: 0xc46bff, up: 3 }); vfx.ring(p, { r0: .3, r1: 3, dur: .35, color: 0xd890ff });
      for (const o of es()) if (Math.hypot(o.x - s.x, o.y - s.y) < 95 + o.r) { hurt(f, o, 150, { quiet: true, field: true }); o.hAcc = (o.hAcc || 0) + 150 * dmgMul(f); if (o.hAcc >= 1200) { ui.pop(P3(o, 3 + rnd(0, 1)), Math.round(o.hAcc), '#ffe9a0', true); o.hAcc = 0; } } }
  }
  q.stars = q.stars.filter(s => !s.done);
  if (t >= 9.5 && !q.face) {   // 하늘에서 거대한 리치드래곤의 머리
    const e0 = es(), e = e0.length ? e0[0] : null, fx = e ? e.x : W / 2, fy = e ? e.y : H / 2; q.face = lichAFace(.01); q.face.position.copy(W3(fx, fy, 14)); q.face.rotation.x = .9; addExtra(q.face); q.fx = fx; q.fy = fy; ui.pop(P3(f, 4.4), '💗 거대한 얼굴이 하늘에!', '#ff9ae6', true);
  }
  if (q.face) { const u = Math.min(1, (t - 9.5) / 1), out = t > 13.2 ? Math.max(0, 1 - (t - 13.2) / .6) : 1; q.face.scale.setScalar(Math.max(.01, 12 * ease.out(u) * out)); }
  if (t >= 11 && !q.heart) { const m = heartMesh(new THREE.MeshStandardMaterial({ color: 0xff6adf, emissive: 0xff2ac0, emissiveIntensity: 1.8, roughness: .3 }), 4); m.position.copy(W3(q.fx, q.fy, 34)); addExtra(m); q.heart = { m, t: 0 }; }
  if (q.heart) {
    const h = q.heart; h.t += dt; h.m.position.y = lerp(34, .8, Math.min(1, h.t / 1.2) ** 2); h.m.rotation.y += dt * 4;
    if (h.t >= 1.2 && !h.done) {
      h.done = true; rmExtra(h.m); const p = W3(q.fx, q.fy, .5); vfx.burst('heart', p, 60, { speed: 6, speed2: 20, life: 1, size: 1.2, c0: 0xff9ae6, c1: 0xff2ac0, up: 6 }); vfx.ring(p, { r0: 1, r1: 24, dur: .8, color: 0xff6ad8 }); ui.flash('#ff6ad8', .6, .6); shake(1.8, .7);
      for (const o of es()) if (Math.hypot(o.x - q.fx, o.y - q.fy) < 420 + o.r) { hurt(f, o, 4000, { dir: 0 }); o.pinkT = 8; o.pinkBy = f; ui.pop(P3(o, 4.2), '💗 핑크빛 시야 · 리치가 아군처럼 보인다', '#ff9ae6', true); }
    }
  }
  if (t >= 14) endEndSky();
}
function endEndSky() { const q = B.esky; if (!q) return; q.stars.forEach(s => rmExtra(s.m)); if (q.face) rmExtra(q.face); if (q.heart && !q.heart.done) rmExtra(q.heart.m); ui.tint(''); B.esky = null; }
CHARS.lichA = {
  id: 'lichA', base: 'lich', name: '각성 리치드래곤 쿠키', color: LCH, fx: 0xff7ae0, cost: 0, hp: 30000, pref: 6.5, atkRange: 480, aiPref: 360, ult: { need: 9000 }, dragon: { hp: 55000 },
  tag: '각성 · 거대한 얼굴 · 정신의 심연 · 분신 · 환각 · 변신',
  skills: {
    base: {
      a: CHARS.lich.skills.base.a,
      z: { name: '리치드래곤의 얼굴', cd: 22, desc: '앞에 거대한 리치드래곤의 얼굴이 나타나 하트를 마구 쏜다. 하트 1개당 600 (45발)', use(f) { startLichFace(f); } },
      x: { name: '정신의 심연', cd: 60, desc: '적을 40초 동안 조종한다. Q 로 나와 조종당하는 적을 번갈아 조종. 버닝스파이스 등을 조종하면 그 스킬로 상대 팀을 공격할 수 있고, 적팀은 조종당하는 적을 공격할 수 있다', use(f) { return startCtl2(f, foe(f)); } },
      q: { name: '조종 전환', cd: .4, desc: '정신의 심연 중: 나 ↔ 조종당하는 적 전환', use(f) { if (!f.ctl2) return false; f.ctl2.cur = f.ctl2.cur === 'me' ? 'tgt' : 'me'; ui.pop(P3(f, 4), f.ctl2.cur === 'me' ? '나를 조종' : '🧠 적을 조종', '#d8b0ff', true); vfx.ring(P3(f.ctl2.cur === 'me' ? f : f.ctl2.t), { r0: .5, r1: 5, dur: .5, color: LCH }); } },
      c: { name: '몽롱한 꿈', cd: 30, desc: '리치드래곤 쿠키의 분신 5개가 생겨나 공격한다 (각 HP 2000, 실제로 피해를 준다, 20초)', use(f) { startDreamClones(f); } },
      v: { name: '환각', cd: 50, desc: '진짜와 같은 스펙·같은 체력의 분신이 진짜처럼 싸운다. 분신이 살아있는 동안 진짜 리치드래곤은 적에게 보이지 않는다 (30초)', use(f) { return startIllusion(f); } },
      e: { name: '변신', cd: 3, desc: '리치드래곤으로 변신한다 (25초, HP 55000). 변신 후 Z/X/C/V 가 바뀐다', use(f) { transform(f); return 'nocd'; } },
      r: { name: '꿈', cd: 0, desc: '(게이지 100%) 상대에게 꿈을 꾸게 한다: 차오르는 바다 → 어머니의 유혹 → 와플 로봇 → 이터널슈가의 낙원 → 붉은 달(분신·미로·방탈출). 하나라도 실패하면 죽는다', use(f) { return startDream(f); } },
    },
    dragon: {
      a: CHARS.lich.skills.dragon.a,
      z: { name: '보라 브레스', cd: 12, desc: '거대한 범위의 보라 브레스를 최대 10초 발사 (총 5500). Z 를 다시 누르면 중단. 맞은 적은 시야 방해(공포 글자)', use(f) { return startBreath(f); } },
      x: { name: '리치 참', cd: 14, desc: '꼬리로 상대를 넉백시키면 몸에서 참격이 마구 베어낸다. 총 6000 (꼬리 1000 + 참격 500×10)', use(f) { tailSlash(f); } },
      q: { name: '조종 전환', cd: .4, desc: '-', use() { return false; } },
      c: { name: '자줏빛 안개', cd: 30, desc: '자줏빛 안개를 소환. 안에서 가끔 투명해지고, 가끔 적 앞에 리치드래곤의 머리가 나와 브레스를 쏜다 (14초)', use(f) { startPurpleFog(f); } },
      v: { name: '종말의 하늘', cd: 70, desc: '달이 자줏빛으로 물들고 별이 마구 떨어진다 (80개, 총 12000). 마지막엔 거대한 머리가 거대 하트(4000)를 쏘고, 맞은 적은 시야가 핑크빛이 되며 리치가 아군처럼 보인다', use(f) { return startEndSky(f); } },
      e: { name: '변신 해제', cd: 3, desc: '변신을 해제', use(f) { revertForm(f); } },
      r: { name: '꿈', cd: 0, desc: '변신 중에는 사용 불가', use(f) { toast(f, '변신 중에는 사용할 수 없습니다'); return false; } },
    }
  }
};
CHARS.lich.awakeId = 'lichA'; CHARS.lich.kin = true; CHARS.lichA.kin = true;   // 용족(드래곤 등급)은 정신계 공격 면역
/* ===== 각성 리치드래곤 궁극기: 꿈 (게이지 100%) =====
   상대(희생자)에게 꿈을 연달아 꾸게 한다. 1) 차오르는 바다에서 높은 곳으로 2) 어머니의 "영원히 함께 살자"를 거절 3) 거대 와플 로봇 처치 4) 이터널슈가의 낙원을 부수고 이터널슈가 처치
   → 모두 이겨내면 붉은 달에 갇힌다: 리치 분신 처치 + 미로(출구까지) + 방탈출(4자리 자물쇠). 하나라도 실패하면 죽는다. (희생자 AI 는 확률/자동 이동으로 처리) */
CHARS.mob_waffle = mobDef('mob_waffle', '거대한 와플 로봇', 0xe0a050, 14000, '꿈 · 거대 로봇', {
  a: { name: '와플 펀치', cd: 1.4, desc: '근접 250', use(f) { setAnim(f, 'slash', .3); swing(f, 210, 1.1, 250, 0xe0a050); } },
  z: { name: '시럽 폭발', cd: 6, desc: '광역 600', use(f) { setAnim(f, 'slash', .4); shock(f, 260, 0xffc060, 600); shake(.6, .3); } },
}, { range: 190, pref: 110 });
CHARS.mob_sugarD = mobDef('mob_sugarD', '꿈속의 이터널슈가 쿠키', 0xff8ad0, 11000, '꿈 · 설탕 낙원', {
  a: { name: '설탕탄', cd: 1.5, desc: '120', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 480, r: 12, dmg: 120, color: 0xff8ad0, kind: 'orb', life: 1.2, homing: 260, turn: 2 }); } },
  z: { name: '단 파도', cd: 8, desc: '광역 500', use(f) { setAnim(f, 'cast', .4); shock(f, 280, 0xff8ad0, 500); } },
}, { range: 380, pref: 300 });
function startDream(f) {
  if (!f.awake) { toast(f, '각성 필요'); return false; }
  if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
  const e = foe(f);
  if (f.form !== 'base' || B.gk || B.dream || B.mind || B.seal || B.abyss || B.lult || B.cut || B.forks.length || B.explore || B.raid || B.fx || !e || e === B.ghost || e.hp <= 0 || e.minion || ally(f, e)) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  if (immune(e)) { ui.pop(P3(e, 3.4), '저항!', '#9fb8ff'); toast(f, '정신계 면역 대상입니다'); return false; }
  f.gauge = 0; setAnim(f, 'cast', 2); f.pose = 'float'; runScript(f, [], 2.2, () => { f.pose = null; });
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  B.dream = { f, e, stage: 0, t: 0, ss: {}, mobs: [], objs: [], over: false, human: e === B.fighters[0] };
  e.st.inv = 0; f.nofoe = true; const D0 = B.dream; D0.rs = { owner: f, target: e }; D0.ret = { x: e.x, y: e.y };
  clearStates(e); dropOwned(x => x.owner === e); B.projs.forEach(p => { if (p.owner === e) killProj(p); }); e.realm = 1; B.viewSeal = false; camState.init = false;   // 적만 별도 세계(꿈)로 보낸다 — G 로 상대 시점 보기
  ui.flash('#c46bff', .7, .7); ui.title('꿈', 'THE DREAM'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2200);
  dreamStage(1);
}
function dreamTitle(t, sub) { ui.pop(P3(B.dream.e, 4.6), t, '#e0b8ff', true); ui.toast(t + (sub ? ' — ' + sub : '')); }
function dreamClear() {
  const D = B.dream; if (D.ss.isl) D.ss.isl.forEach(i => vfx.remove(i.d)); if (D.ss.dome) vfx.remove(D.ss.dome); D.mobs.forEach(m => { if (m.hp > 0) m.hp = 0; }); D.objs.forEach(o => { if (o.parentNode) o.remove(); else rmExtra(o); }); D.objs = []; D.ss = {}; D.overlay && D.overlay.remove(); D.overlay = null;
  if (D.pend) { vfx.remove(D.pend); D.pend = null; }
}
function dreamStage(n) {
  const D = B.dream, e = D.e, f = D.f; dreamClear(); D.stage = n; D.t = 0; D.ss = {};
  world.setDream(n); camState.init = false; e.realm = 1; e.x = W / 2; e.y = H / 2; e.st.inv = Math.max(e.st.inv, 1);   // 단계마다 전혀 다른 공간
  const mk = (id, hp, x, y) => { const m = addMinion(id, x, y, { hp, pm: f.pm || 1, realm: 1, notag: false }); m.team = f.team; m.dmob = true; m.cmb = B.time; D.mobs.push(m); return m; };
  if (n === 1) {   // 차오르는 바다 — 높은 곳(섬)에 서 있어야 산다
    dreamTitle('🌊 꿈 1', '차오르는 바다에서 높은 곳으로!');
    const isl = []; for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + .5, x = clamp(e.x + Math.cos(a) * 520, PAD + 80, W - PAD - 80), y = clamp(e.y + Math.sin(a) * 520, PAD + 80, H - PAD - 80); isl.push({ x, y, r: 150, d: vfx.decal(P3({ x, y, realm: 1 }), { tex: 'ring', r: 150 * S, color: 0xfff0a8, alpha: .9, y: .1 }) }); }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W * S * 1.2, H * S * 1.2), new THREE.MeshBasicMaterial({ color: 0x2a6fe0, transparent: true, opacity: .55, depthWrite: false })); water.rotation.x = -Math.PI / 2; water.position.set(RDX, -3, 0); addExtra(water); D.objs.push(water); D.ss.isl = isl; D.ss.water = water;
  } else if (n === 2) {   // 어머니의 유혹
    dreamTitle('💞 꿈 2', '어머니: "영원히 함께 살자…" 거절하세요');
    if (D.human) {
      const o = document.createElement('div'); o.style.cssText = 'position:absolute;inset:0;z-index:60;background:rgba(40,10,50,.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff;font:900 34px sans-serif;text-align:center;text-shadow:0 2px 10px #000';
      o.innerHTML = '<div style="font-size:90px">👩</div><div>"우리 아가… 이제 힘든 건 그만하고,<br>여기서 엄마랑 영원히 함께 살자."</div><div style="display:flex;gap:30px"><button id="dmY" style="font:inherit;font-size:28px;padding:12px 30px;border-radius:14px;border:4px solid #fff;background:#d95a8a;color:#fff;cursor:pointer">💗 그래, 함께 살자</button><button id="dmN" style="font:inherit;font-size:28px;padding:12px 30px;border-radius:14px;border:4px solid #fff;background:#3a3a60;color:#fff;cursor:pointer">✋ 거절한다</button></div><div id="dmT" style="font-size:22px"></div>';
      document.getElementById('game').appendChild(o); D.overlay = o; o.querySelector('#dmY').onclick = () => { D.ss.ans = 'yes'; }; o.querySelector('#dmN').onclick = () => { D.ss.ans = 'no'; };
    } else D.ss.aiAns = Math.random() < .85 ? 'no' : 'yes';
  } else if (n === 3) {   // 거대 와플 로봇
    dreamTitle('🧇 꿈 3', '거대한 와플 로봇을 쓰러뜨리세요 (30초)');
    const m = mk('mob_waffle', 14000, clamp(e.x + 420, PAD, W - PAD), e.y); m.big = 2.2; m.r = 22 * 2.2; D.ss.boss = m; D.ss.life = 30;
  } else if (n === 4) {   // 이터널슈가의 낙원
    dreamTitle('🍬 꿈 4', '이터널슈가의 낙원을 부수고 그를 쓰러뜨리세요 (30초)');
    const m = mk('mob_sugarD', 11000, clamp(e.x - 420, PAD, W - PAD), e.y); D.ss.boss = m; D.ss.life = 30; D.ss.dome = vfx.dome(P3(m), 260 * S, 0xff8ad0); D.ss.shield = 8000; m.shield = m.shieldMax = 8000;
  } else if (n === 5) {   // 붉은 달
    dreamTitle('🔴 붉은 달', '분신을 처치하고, 미로를 지나, 자물쇠를 풀어 탈출하세요 (60초)');
    ui.tint('rgba(220,20,40,.30)'); const cl = mk('lich_dream', 9000, clamp(e.x + 380, PAD, W - PAD), e.y); cl.max = cl.hp = 9000; D.ss.clone = cl; D.ss.life = 60; D.ss.code = String(Math.floor(1000 + Math.random() * 9000)); D.ss.phase = 0;
    const pil = []; for (let i = 0; i < 9; i++) { const x = clamp(e.x + rnd(-700, 700), PAD + 80, W - PAD - 80), y = clamp(e.y + rnd(-420, 420), PAD + 80, H - PAD - 80); B.objs.push({ x, y, r: 70, realm: 1, dream: true }); pil.push(x); const pm = new THREE.Mesh(new THREE.CylinderGeometry(70 * S, 70 * S, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a1030, emissive: 0x400010 })); pm.position.copy(W3r(x, y, 3)).x += RDX; addExtra(pm); D.objs.push(pm); }
    D.ss.exit = { x: clamp(e.x + (Math.random() < .5 ? -1 : 1) * 900, PAD + 100, W - PAD - 100), y: clamp(e.y + rnd(-300, 300), PAD + 100, H - PAD - 100) };
  }
}
function dreamReturn(D) { const e = D.e; e.realm = 0; e.x = D.ret.x; e.y = D.ret.y; B.viewSeal = false; camState.init = false; world.setDream(0); }
function dreamFail(why) { const D = B.dream; if (!D || D.over) return; D.over = true; const e = D.e; dreamReturn(D); ui.pop(P3(e, 4.4), '💀 ' + why, '#ff6a8a', true); ui.flash('#000', 1, .9); dreamClear(); B.objs = B.objs.filter(o => !o.dream); ui.tint(''); e.st.inv = 0; e.shield = 0; if (D.f) D.f.nofoe = false; hurt(D.f, e, 999999, { quiet: true, field: true }); B.dream = null; }
function dreamWin() { const D = B.dream; if (!D) return; dreamReturn(D); dreamClear(); B.objs = B.objs.filter(o => !o.dream); ui.tint(''); ui.flash('#fff', .8, .8); ui.pop(P3(D.e, 4.4), '꿈에서 깨어났다…', '#ffffff', true); D.e.st.stun = 2; D.f.nofoe = false; B.dream = null; }
function updDream(dt) {
  const D = B.dream; if (!D) return; const e = D.e, f = D.f; D.t += dt;
  if (e.hp <= 0 || f.hp <= 0) { dreamReturn(D); f.nofoe = false; if (f.hp <= 0 && e.hp > 0) { dreamClear(); B.objs = B.objs.filter(o => !o.dream); ui.tint(''); B.dream = null; return; } dreamClear(); B.objs = B.objs.filter(o => !o.dream); ui.tint(''); B.dream = null; return; }
  const ss = D.ss; D.mv = null;
  if (D.stage === 1) {
    const dur = 20, k = Math.min(1, D.t / dur); ss.water.position.y = -3 + k * 3.2; const safe = ss.isl.some(i => Math.hypot(e.x - i.x, e.y - i.y) < i.r);
    if (!D.human) { if (safe) D.mv = { mx: 0, my: 0 }; else { const i = ss.isl.reduce((b, c) => Math.hypot(e.x - c.x, e.y - c.y) < Math.hypot(e.x - b.x, e.y - b.y) ? c : b); const a = Math.atan2(i.y - e.y, i.x - e.x); D.mv = { mx: Math.cos(a), my: Math.sin(a) }; } }   // AI 희생자는 가까운 섬으로 간다
    if (D.t > 6 && !safe) { ss.drown = (ss.drown || 0) + dt; hurt(f, e, 900 * dt / dmgMul(f), { quiet: true, field: true }); if (ss.drown > 7) return dreamFail('물에 빠졌다'); } else ss.drown = Math.max(0, (ss.drown || 0) - dt * 2);
    if (D.t >= dur && safe) dreamStage(2);
    else if (D.t >= dur + 4) dreamFail('바다에 삼켜졌다');
  } else if (D.stage === 2) {
    if (!D.human) D.mv = { mx: 0, my: 0 };
    const left = 10 - D.t; if (D.overlay) D.overlay.querySelector('#dmT').textContent = '남은 시간 ' + Math.ceil(left) + '초 (시간이 지나면 받아들인 것으로 본다)';
    const ans = ss.ans || (D.t > 4 && ss.aiAns) || (left <= 0 ? 'yes' : null);
    if (ans === 'no') dreamStage(3); else if (ans === 'yes') dreamFail('영원히 꿈속에 남았다');
  } else if (D.stage === 3 || D.stage === 4) {
    const b = ss.boss; ss.life -= dt;
    if (D.stage === 4 && ss.dome && b.shield <= 0) { vfx.remove(ss.dome); ss.dome = null; ui.pop(P3(b, 4), '🍬 낙원 파괴!', '#ffc0e8', true); }
    if (b.hp <= 0) dreamStage(D.stage + 1); else if (ss.life <= 0) dreamFail(D.stage === 3 ? '와플 로봇에게 졌다' : '낙원에 갇혔다');
  } else if (D.stage === 5) {
    ss.life -= dt; const cl = ss.clone;
    if (ss.phase === 0) {   // 1) 분신 처치
      if (cl.hp <= 0) { ss.phase = 1; ui.toast('🧩 미로: 붉은 문(출구)까지 가세요'); ss.exitD = vfx.decal(P3({ x: ss.exit.x, y: ss.exit.y, realm: 1 }), { tex: 'ring', r: 120 * S, color: 0xff3050, alpha: .95, y: .1 }); D.pend = ss.exitD; }
    } else if (ss.phase === 1) {   // 2) 미로 — 기둥 사이로 출구까지
      if (!D.human) { const a = Math.atan2(ss.exit.y - e.y, ss.exit.x - e.x); D.mv = { mx: Math.cos(a), my: Math.sin(a) }; }
      if (Math.hypot(e.x - ss.exit.x, e.y - ss.exit.y) < 120) { ss.phase = 2; ss.t2 = 0; ui.toast('🔐 방탈출: 4자리 자물쇠를 푸세요'); if (D.human) {
        const o = document.createElement('div'); o.style.cssText = 'position:absolute;inset:0;z-index:60;background:rgba(40,0,10,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;font:900 30px sans-serif;text-align:center';
        const hint = ss.code.split('').map((c, i) => ['첫째 자리: ' + (c % 2 ? '홀수' : '짝수') + ' (' + c + ')', '둘째 자리: ' + c, '셋째 자리: ' + c, '넷째 자리: ' + c][i]); void hint;
        o.innerHTML = '<div>🔴 붉은 달의 방 — 자물쇠</div><div style="font-size:22px;color:#ffb0b8">벽의 낙서: "' + ss.code.split('').reverse().join('') + '" … 거꾸로 읽어라</div><input id="dmC" maxlength="4" style="font:inherit;font-size:40px;width:220px;text-align:center;letter-spacing:10px"><button id="dmG" style="font:inherit;padding:8px 24px;border-radius:12px;border:3px solid #fff;background:#a02040;color:#fff;cursor:pointer">열기</button><div id="dmE" style="font-size:20px;color:#ff8090"></div>';
        document.getElementById('game').appendChild(o); D.overlay = o; o.querySelector('#dmG').onclick = () => { if (o.querySelector('#dmC').value.trim() === ss.code) ss.solved = true; else o.querySelector('#dmE').textContent = '틀렸어요'; }; o.querySelector('#dmC').focus(); } } }
    else if (ss.phase === 2) {   // 3) 방탈출
      if (!D.human) D.mv = { mx: 0, my: 0 }; ss.t2 += dt; if (!D.human && ss.t2 > 5 + (ss.seed = ss.seed || Math.random() * 6) && ss.aiOk === undefined) ss.aiOk = Math.random() < .7;
      if (ss.solved || ss.aiOk === true) return dreamWin(); if (ss.aiOk === false) return dreamFail('방에서 나오지 못했다');
    }
    if (ss.life <= 0) dreamFail('붉은 달 안에 갇혔다');
  }
}
const SOUL_IDS = ['silent', 'shadow', 'sugar', 'burn', 'mystic'];   // 비스트 5종
function spawnSoulWave(s) {   // 강화된 봉인수: 웨이브마다 비스트 5종의 영혼 (궁극기 없음, HP 4000 고정, 피해 40%, 패시브 없음)
  s.wave++; ui.toast('🌳 웨이브 ' + s.wave + '/3 — 비스트 영혼 1체'); ui.flash('#bfffe8', .4, .4);
  [SOUL_IDS[Math.floor(Math.random() * SOUL_IDS.length)]].forEach((id, i) => { const a = i / 5 * 6.283 + s.wave, m = addMinion(id, clamp(W / 2 + 80 + Math.cos(a) * 300, W / 2 - 500, W / 2 + 500), clamp(H / 2 + Math.sin(a) * 260, H / 2 - 380, H / 2 + 380), { hp: 4000, pm: .4, realm: 1 }); m.soulOf = true; m.pseal = 1e9; m.gauge = -1e9; m.awake = false; m.nick = '영혼'; vfx.burst('glow', P3(m, 1), 16, { speed: 3, speed2: 8, life: .7, size: .8, c0: 0xffffff, c1: 0x7dffd0, up: 2 }); });
}
/* ----- 각성 세인트릴리 궁극기: 운명의 대천사 (탑승) ----- */
function buildArchangel() {
  const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xece6ff, emissive: 0x6a4ad0, emissiveIntensity: .5, roughness: .5, flatShading: true }), dark = new THREE.MeshStandardMaterial({ color: 0x2a1650, emissive: 0x5a28c0, emissiveIntensity: .7, flatShading: true });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(3, 5.4, 13, 10), white); torso.position.y = 7; g.add(torso);
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(8, 8, 12, 1, true), dark); skirt.position.y = 3; skirt.rotation.x = Math.PI; g.add(skirt);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff7aff })); core.position.set(0, 10, 3.4); g.add(core); g.userData.core = core;
  const cg = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xff60ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); cg.scale.setScalar(12); cg.position.copy(core.position); g.add(cg); g.userData.cg = cg;
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10), white); head.position.y = 15.5; g.add(head);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(4.2, .3, 8, 36), new THREE.MeshBasicMaterial({ color: 0xffe9a0 })); halo.position.y = 19; halo.rotation.x = Math.PI / 2.4; g.add(halo); g.userData.halo = halo;
  for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(.5, 11 - k * 2, 3.2), white); w.position.set(sd * (5 + k * 2.4), 12 + k * 1.2, -2); w.rotation.set(0, 0, sd * (-.7 - k * .25)); g.add(w); }
  g.userData.tent = []; for (let i = 0; i < 8; i++) {
    const segs = [], a = i / 8 * 6.283; for (let j = 0; j < 9; j++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.9 - j * .07, 8, 6), dark); g.add(m); segs.push(m); }
    g.userData.tent.push({ segs, a });
  }
  return g;
}
function tentacleFx(a, b, life = .35) {   // 월드 좌표 a→b 로 뻗는 촉수
  const len = a.distanceTo(b), m = new THREE.Mesh(new THREE.CylinderGeometry(.3, 1.1, 1, 8).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: 0x2a1650, emissive: 0x7a38e0, emissiveIntensity: .9, flatShading: true }));
  m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); addFxm(m, life, u => { const k = u < .35 ? u / .35 : 1; m.scale.set(1, Math.max(.01, len * k), 1); m.material.opacity = 1; if (u > .75) m.scale.x = m.scale.z = Math.max(.01, 1 - (u - .75) / .25); });
}
function startArchangel(f) {
  if (!f.awake) { toast(f, '각성 필요'); return false; }
  if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
  if (f.form !== 'base' || B.mind || B.seal || B.abyss || B.lult || B.dream || B.cut || B.forks.length || B.explore || B.raid || B.fx) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  f.gauge = 0; setAnim(f, 'cast', 2.6); f.pose = 'float'; f.st.inv = Math.max(f.st.inv, 3);
  const rift = new THREE.Group(), disc = new THREE.Mesh(new THREE.CircleGeometry(16, 40), new THREE.MeshBasicMaterial({ color: 0x120028, side: THREE.DoubleSide })), ring = new THREE.Mesh(new THREE.TorusGeometry(16, .8, 8, 48), new THREE.MeshBasicMaterial({ color: 0xc890ff }));
  rift.add(disc, ring); rift.position.copy(P3(f, 46)); rift.rotation.x = Math.PI / 2 - .35; rift.scale.setScalar(.01); addExtra(rift);
  ui.flash('#a070ff', .6, .6); shake(1.2, 1.2); ui.cinema(true); ui.title('운명의 대천사', 'ARCHANGEL OF FATE'); const bb = B;
  addFxm(rift, 2.6, (u, m) => { m.scale.setScalar(Math.max(.01, ease.out(Math.min(1, u * 2)) * (u > .85 ? (1 - u) / .15 : 1))); ring.rotation.z += .05; });
  runScript(f, [
    { at: 1.4, fn: () => { ui.flash('#ffffff', .6, .5); vfx.column(P3(f), { r: 5, h: 50, dur: 1, color: 0xc890ff, alpha: .8 }); vfx.ring(P3(f), { r0: 1, r1: 20, dur: .9, color: 0xc890ff }); shake(1.6, .8); } },
    { at: 1.8, fn: () => {
      f.lilyHp = f.hp; f.lilyMax = f.max; f.lilySh = f.shield; f.form = 'angel'; f.formT = 40; f.max = f.hp = 30000; f.shield = f.shieldMax = 0; f.r = 60; f.air = 14; f.pose = null; for (const k in f.cd) f.cd[k] = 0;
      ui.pop(P3(f, 22), '👼 운명의 대천사!', '#e8d8ff', true); vfx.burst('glow', P3(f, 12), 90, { speed: 5, speed2: 22, life: 1.2, size: 1.4, c0: 0xffffff, c1: 0xa070ff });
    } },
  ], 2.6, () => { f.st.inv = 0; if (B === bb) { ui.cinema(false); ui.title('', ''); } });
}
function endArchangel(f, voluntary) {
  if (f.form !== 'angel') return; f.form = 'base'; f.formT = 0; f.max = f.lilyMax || f.def.hp; f.hp = Math.max(1, f.lilyHp || f.max); f.shield = f.lilySh || 0; f.shieldMax = Math.max(f.shield, f.shieldMax || 0); f.r = 22; f.air = 0; f.absorb = null; f.souls = null; f.rooted = false;
  for (const k in f.cd) f.cd[k] = 0; f.cd.r = 3; f.st.inv = Math.max(f.st.inv, 1.2); ui.flash('#e8d8ff', .5, .5); shake(1, .5); vfx.burst('glow', P3(f, 10), 60, { speed: 4, speed2: 16, life: 1, size: 1.2, c0: 0xffffff, c1: 0xa070ff }); ui.pop(P3(f, 4), voluntary ? '탑승 해제' : '💥 대천사 격추!', '#e8d8ff', true);
}
function angelTentacles(f) {   // Z: 촉수 6번 × 1000 = 6000
  const e = foe(f); setAnim(f, 'cast', 1); const steps = [];
  for (let i = 0; i < 6; i++) steps.push({ at: .15 + i * .2, fn: () => {
    const t = foe(f), tx = (t && t !== B.ghost ? t.x : f.x + Math.cos(f.face) * 500) + rnd(-70, 70), ty = (t && t !== B.ghost ? t.y : f.y + Math.sin(f.face) * 500) + rnd(-70, 70);
    tentacleFx(P3(f, 11), P3({ x: tx, y: ty, realm: f.realm }, .6), .4); const p = P3({ x: tx, y: ty, realm: f.realm }, .3); vfx.burst('spark', p, 14, { speed: 5, speed2: 12, life: .4, size: .5, c0: 0xffffff, c1: 0xa070ff }); vfx.ring(p, { r0: .5, r1: 5, dur: .35, color: 0xa070ff }); shake(.5, .2);
    for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - tx, o.y - ty) < 260 + o.r) hurt(f, o, 1000, { dir: ang(f, o) });
  } });
  runScript(f, steps, 1.6);
}
function angelSouls(f) {   // X: 10초 동안 영혼 방출 (총 10000, 슬로우)
  if (f.souls) return false; f.souls = { t: 0, tick: 0 }; f.rooted = true; setAnim(f, 'roar', 1); ui.flash('#ff80ff', .4, .4); shake(.8, .6); ui.pop(P3(f, 22), '👻 운명의 영혼 방출!', '#ffb0ff', true);
}
function absorbRec(t, src, d, o) {
  const p = o.proj, rec = p ? { dmg: d, kind: p.kind, color: p.color, r: p.r, sp: Math.hypot(p.vx, p.vy), life: p.life0 || 1.4, pierce: p.pierce, homing: p.homing, turn: p.turn } : { dmg: d, kind: 'wave', color: 0xd8b0ff, r: 40, sp: 1100, life: 1.2, pierce: true };
  t.absorb.list.push(rec); if (t.absorb.list.length > 40) t.absorb.list.shift();
  const a = P3(src, 1.4), b = P3(t, 10); vfx.line('glow', a, b, 8, { size: .6, size1: .1, c0: 0xffffff, c1: 0xb060ff, life: .5, rad: .3, v: 1 }); ui.pop(P3(t, 14 + rnd(0, 3)), '🌀 흡수 ' + Math.round(d), '#d8b0ff');
}
function angelRelease(f) {   // V: 흡수한 공격을 상대가 쓴 형태 그대로 방출
  const L = f.absorb && f.absorb.list; if (!L || !L.length) { toast(f, '흡수한 공격이 없습니다 (C 로 흡수)'); return false; }
  const e = foe(f), a0 = e && e !== B.ghost ? ang(f, e) : f.face; setAnim(f, 'cast', .8); ui.flash('#ff80ff', .4, .4); ui.pop(P3(f, 22), '💥 공격 대방출! ×' + L.length, '#ffb0ff', true); shake(1, .6);
  const list = L.slice(); f.absorb = null; const steps = list.map((r, i) => ({ at: .1 + i * .07, fn: () => { const t = foe(f), a = (t && t !== B.ghost ? ang(f, t) : a0) + rnd(-.12, .12); shoot(f, { a, sp: r.sp || 900, r: r.r || 14, dmg: r.dmg / dmgMul(f), color: r.color || 0xd8b0ff, kind: r.kind, life: r.life || 1.4, pierce: r.pierce, homing: r.homing, turn: r.turn, h0: 10 }); } }));
  runScript(f, steps, .3 + list.length * .07);
}
function updArchangel(dt) {
  for (const f of B.fighters) {
    if (f.angelM) {
      const on = f.form === 'angel'; f.angelM.visible = on && !f.hidden; if (on) {
        f.air = 14; f.angelM.position.y = -14 / (f.root.scale.y || 1); const T = B.time, A = f.angelM.userData;
        A.core.scale.setScalar(1 + Math.sin(T * 6) * .12 + (f.souls ? .5 : 0)); A.cg.scale.setScalar(12 + Math.sin(T * 5) * 2 + (f.souls ? 10 : 0) + (f.absorb ? 5 : 0)); A.halo.rotation.z += dt;
        A.tent.forEach((t, i) => t.segs.forEach((m, j) => { const k = j / 9, a = t.a + Math.sin(T * 1.6 + i) * .3, r = 4 + j * 1.3; m.position.set(Math.cos(a) * r * (1 + k * .4), 2 - j * .55 + Math.sin(T * 2 + i + j * .5) * .7, Math.sin(a) * r * (1 + k * .4)); }));
        if (f.souls) {   // X 영혼 방출 (10초)
          const s = f.souls; s.t += dt; s.tick -= dt; if (Math.random() < .8) { const p = P3(f, 10), a = rnd(0, 6.283); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * 14, vy: rnd(-2, 6), vz: Math.sin(a) * 14, life: .8, s0: 1.4, s1: 0, c0: 0xffffff, c1: 0xff60ff, a: .8, drag: 0 }); }
          if (s.tick <= 0) { s.tick = .1; for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < 900 + o.r) { hurt(f, o, 100, { quiet: true, field: true }); slowOn(o, .4, .5); o.hAcc = (o.hAcc || 0) + 100 * dmgMul(f); if (o.hAcc >= 1000) { ui.pop(P3(o, 3 + rnd(0, 1)), Math.round(o.hAcc), '#ffb0ff', true); o.hAcc = 0; } } }
          if (s.t >= 10 || f.st.stun > 0) { f.souls = null; f.rooted = false; f.cd.x = 20; }
        }
        if (f.absorb) { f.absorb.t -= dt; if (f.absorb.t <= 0) { f.absorb.t = 0; } }
      }
    }
  }
  if (B.lbig && B.lbig.length) {   // X 거대한 백합 (꽃잎이 계속 떨어진다)
    for (const c of B.lbig) {
      const f = c.owner; c.t += dt; c.tick -= dt; c.m.position.copy(P3(f, 24)); c.m.rotation.y += dt * .4; c.m.scale.setScalar(Math.max(.01, ease.out(Math.min(1, c.t / .8)) * (c.t > c.dur - .6 ? Math.max(0, (c.dur - c.t) / .6) : 1)));
      for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * c.R * S; const p = P3(f, 24); vfx.emit('glow', { x: p.x + Math.cos(a) * d, y: 22, z: p.z + Math.sin(a) * d, vy: -16, vx: rnd(-1, 1), life: 1.4, s0: .8, s1: .5, c0: 0xffffff, c1: 0xff9ad8, a: .85, drag: 0 }); }
      if (c.tick <= 0) {
        c.tick = 1;
        for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && dist(f, t) < c.R + t.r) { hurt(f, t, 500, { quiet: true, field: true }); ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(500 * dmgMul(f)), '#ffd0f0', true); vfx.burst('glow', P3(t, 1.5), 8, { speed: 2, life: .5, size: .6, c0: 0xffffff, c1: 0xff9ad8 }); }
        if (f.hp > 0 && dist(f, f) < c.R) mHeal(f, 1000);   // 나는 초당 1000 회복
      }
      if (c.t >= c.dur || f.hp <= 0) { rmExtra(c.m); c.done = true; }
    }
    B.lbig = B.lbig.filter(c => !c.done);
  }
}
/* ===== 각성 세인트릴리 쿠키 (id 'lilyA', HP 26000) ===== */
const LA_FLAG = 0xfff0c8;
function lilyBloomFx(x, y, R, dur = .9) {   // 땅에서 백합이 피어오른다 (월드 좌표 x,y 로직 좌표)
  const g = buildLilyMesh(R * S * 1.6); g.position.copy(P3({ x, y, realm: 0 })); g.scale.setScalar(.01);
  addFxm(g, dur, (u, m) => { const k = ease.out(Math.min(1, u * 2.2)), fade = u > .7 ? 1 - (u - .7) / .3 : 1; m.scale.setScalar(Math.max(.01, k * fade)); });
  vfx.ring(P3({ x, y }), { r0: .3, r1: R * S, dur: .5, color: LILY }); vfx.burst('glow', P3({ x, y }, 1), 10, { speed: 2, speed2: 6, life: .6, size: .6, c0: 0xffffff, c1: LILY, up: 3 });
}
function laShield(f, n) { if (f.hp <= 0) return; f.shield = (f.shield || 0) + n; f.shieldMax = Math.max(f.shieldMax || 0, f.shield); }
function vineGrab(f) {   // Z: 덩쿨 손이 상대를 잡아들고 다닌다 → Z 다시 누르면 던지고 덩쿨 콤보 (총 5000)
  if (f.vgrab) { vineThrow(f); return 'nocd'; }
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 700) { toast(f, '사거리 밖'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  setAnim(f, 'cast', .5); hurt(f, e, 500, { dir: ang(f, e) });   // 붙잡기 500
  f.vgrab = { t: e, left: 8, phase: 'hold', hits: 0, hitT: 0, vines: [] };
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(.18, .32, 6, 6), new THREE.MeshStandardMaterial({ color: 0x3fae5e, emissive: 0x14602a, emissiveIntensity: .5, flatShading: true })); addExtra(m); f.vgrab.vines.push(m); }
  ui.flash('#6fe0a0', .3, .35); ui.pop(P3(e, 3.8), '🌿 덩쿨 손! (Z: 던지기)', '#b8ffd0', true); vfx.ring(P3(e), { r0: .5, r1: 7, dur: .6, color: LILYG });
}
function vineThrow(f) {
  const g = f.vgrab; if (!g || g.phase !== 'hold') return; const e = g.t; g.phase = 'throw'; g.tt = 0; setAnim(f, 'slash', .4); g.a = f.face;
  e.kb = { vx: Math.cos(g.a) * 1700, vy: Math.sin(g.a) * 1700, t: .45 }; ui.pop(P3(f, 4), '🌿 던져버려!', '#b8ffd0', true); shake(.8, .4);
}
function endVine(f) { const g = f.vgrab; if (!g) return; g.vines.forEach(m => rmExtra(m)); f.vgrab = null; f.cd.z = 11; }
function startFlags(f) {   // V: 자유의 깃발과 백합 — 깃발 6개 원형 → 백합이 서서히 핀다 (총 12000) → 안의 적은 강화된 봉인수로
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 800) { toast(f, '사거리 밖'); return false; }
  if (B.vflag) return false;
  const cx = clamp(e.x, PAD + 200, W - PAD - 200), cy = clamp(e.y, PAD + 200, H - PAD - 200), R = 330; setAnim(f, 'cast', 1.2); f.pose = 'raise'; runScript(f, [], 1.2, () => { f.pose = null; });
  const flags = []; for (let i = 0; i < 6; i++) {
    const a = i / 6 * 6.283, g = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, 9, 6).translate(0, 4.5, 0), new THREE.MeshStandardMaterial({ color: 0xf4e8b0, metalness: .5, roughness: .4 })); g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6, 6, 1).translate(2.1, 0, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0f0, emissiveIntensity: .5, side: THREE.DoubleSide })); cloth.position.y = 8; g.add(cloth); g.userData.cloth = cloth;
    g.position.copy(P3({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, realm: 0 })); g.scale.setScalar(.01); g.rotation.y = -a; addExtra(g); flags.push(g);
  }
  const lily = buildLilyMesh(R * S * 1.35); lily.position.copy(P3({ x: cx, y: cy, realm: 0 })); lily.scale.setScalar(.01); addExtra(lily);
  const ring = vfx.decal(P3({ x: cx, y: cy, realm: 0 }), { tex: 'rune', r: R * S, color: LILY, alpha: .8, spin: .5 });
  B.vflag = { owner: f, x: cx, y: cy, R, t: 0, dur: 7, tick: 0, flags, lily, ring, n: 0 }; ui.flash('#ffe0f0', .5, .5); ui.pop(P3(f, 4.4), '🏳 자유의 깃발과 백합!', '#ffd0f0', true);
}
function updLilyA(dt) {
  for (const f of B.fighters) {
    // --- 덩쿨 손 ---
    const g = f.vgrab; if (g) {
      const e = g.t; g.left -= dt;
      if (e.hp <= 0 || f.hp <= 0) { endVine(f); }
      else if (g.phase === 'hold') {
        e.st.stun = Math.max(e.st.stun, .15); f.face = f.face; const a = f.face; e.x = clamp(f.x + Math.cos(a) * 150, PAD, W - PAD); e.y = clamp(f.y + Math.sin(a) * 150, PAD, H - PAD); g.hitT -= dt;
        if (g.hitT <= 0) { g.hitT = .5; vfx.burst('glow', P3(e, 1.4), 4, { speed: 2, life: .4, size: .5, c0: 0xffffff, c1: LILYG }); }
        g.vines.forEach((m, i) => { const p = P3(e, 1 + i); m.position.set(p.x, 3, p.z); m.rotation.z = Math.sin(B.time * 5 + i) * .4; });
        if (g.left <= 0) vineThrow(f);
      } else if (g.phase === 'throw') {
        g.tt += dt; g.vines.forEach((m, i) => { const p = P3(e, 1 + i); m.position.set(p.x, 3, p.z); });
        if (g.tt >= .5 && !g.landed) { g.landed = true; hurt(f, e, 1000, { dir: g.a }); shake(1.2, .4); const p = P3(e); vfx.burst('spark', p, 30, { speed: 6, speed2: 16, life: .5, size: .5, c0: 0xffffff, c1: LILYG, grav: 4 }); vfx.ring(p, { r0: 1, r1: 10, dur: .5, color: LILYG }); g.comboT = 0; }
        if (g.landed) {   // 덩쿨 콤보: 6번 × 583 = 3500
          g.comboT -= dt; if (g.comboT <= 0 && g.hits < 6) { g.comboT = .26; g.hits++; const x = e.x + rnd(-60, 60), y = e.y + rnd(-60, 60); stemFx(x, y, 0); setTimeout(() => {}, 0); if (e.hp > 0) { hurt(f, e, 3500 / 6, { quiet: true, field: true }); e.hAcc = (e.hAcc || 0) + 3500 / 6 * dmgMul(f); ui.pop(P3(e, 3 + rnd(0, 1)), Math.round(e.hAcc), '#b8ffd0', true); e.hAcc = 0; } }
          if (g.hits >= 6 && g.comboT < -.3) endVine(f);
        }
      }
    }
  }
  const q = B.vflag; if (q) {   // 자유의 깃발과 백합
    const f = q.owner; q.t += dt; const u = Math.min(1, q.t / 1.5), bl = Math.min(1, q.t / q.dur);
    q.flags.forEach((g, i) => { g.scale.setScalar(Math.max(.01, ease.out(Math.min(1, q.t / (.5 + i * .12))))); g.userData.cloth.rotation.y = Math.sin(q.t * 4 + i) * .25; });
    q.lily.scale.setScalar(Math.max(.01, .1 + bl * .9)); q.lily.rotation.y += dt * .3;
    q.tick -= dt; if (q.tick <= 0 && q.t > 1) {
      q.tick = .25; q.n++; const N = Math.floor((q.dur - 1) / .25);
      for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - q.x, t.y - q.y) < q.R + t.r) { hurt(f, t, 12000 / N, { quiet: true, field: true }); t.hAcc = (t.hAcc || 0) + 12000 / N * dmgMul(f); if (t.hAcc >= 1500) { ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(t.hAcc), '#ffd0f0', true); t.hAcc = 0; } }
      if (Math.random() < .6) vfx.burst('glow', P3({ x: q.x + rnd(-q.R, q.R) * .6, y: q.y + rnd(-q.R, q.R) * .6, realm: 0 }, 1), 4, { speed: 2, life: .6, size: .6, c0: 0xffffff, c1: LILY, up: 3 });
    }
    if (q.t >= q.dur || f.hp <= 0) {
      const victims = B.fighters.filter(t => t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && !t.minion && Math.hypot(t.x - q.x, t.y - q.y) < q.R + t.r);
      q.flags.forEach(g => rmExtra(g)); rmExtra(q.lily); vfx.remove(q.ring); B.vflag = null; f.cd.v = f.cd.v || 0;
      const t = victims[0]; if (t && f.hp > 0) {
        if (B.seal || B.abyss || B.mind || B.lult || B.dream || immune(t) && false) ui.pop(P3(t, 4), '봉인 실패 (다른 영역이 진행 중)', '#ffd0f0');
        else if (inBarrier(f, t)) ui.pop(P3(t, 3.4), '장막이 막았다!', '#fff3b0');
        else { ui.pop(P3(t, 4.4), '🌳 강화된 봉인수에 봉인!', '#bfffe8', true); const tree = buildSealTree(); startSeal(f, t, tree, true); }
      }
    }
  }
}
CHARS.lilyA = {
  id: 'lilyA', base: 'lily', name: '각성 세인트릴리 쿠키', color: LILY, fx: 0xffe0f4, cost: 0, hp: 26000, pref: 5.5, atkRange: 560, aiPref: 380, ult: { need: 9000 },
  tag: '각성 · 백합 · 덩쿨 손 · 자유의 깃발 · 강화된 봉인수 · 운명의 대천사',
  skills: {
    base: {
      a: { name: '백합 개화', cd: .9, desc: '땅에서 백합이 피어오른다 250. 맞출 때마다 보호막 100', use(f) {
        const e = foe(f); setAnim(f, 'cast', .3); const t = e && e !== B.ghost ? clampRange(f, e, 620) : { x: f.x + Math.cos(f.face) * 300, y: f.y + Math.sin(f.face) * 300 };
        lilyBloomFx(t.x, t.y, 95); runScript(f, [{ at: .35, fn: () => { for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - t.x, o.y - t.y) < 95 + o.r) { hurt(f, o, 250, { dir: ang(f, o) }); laShield(f, 100); ui.pop(P3(f, 3.6), '🛡 +100', '#bfe8ff'); } } }], .5);
      } },
      z: { name: '덩쿨 손', cd: 12, desc: '덩쿨 손으로 상대를 붙잡아(500) 들고 다닌다. Z 를 다시 누르면 던지고(1000) 덩쿨 콤보(3500). 총 5000', use(f) { return vineGrab(f); } },
      x: { name: '거대한 백합', cd: 30, desc: '하늘에 거대한 백합을 소환. 꽃잎이 계속 떨어져 적에게 초당 500, 나는 초당 1000 회복 (10초)', use(f) {
        setAnim(f, 'cast', .8); const lil = buildLilyMesh(30 * S * 8), c = { owner: f, t: 0, dur: 10, x: f.x, y: f.y, R: 620, m: lil, tick: 0, petals: [] }; lil.position.copy(P3(f, 24)); lil.scale.setScalar(.01); addExtra(lil); B.lbig = B.lbig || []; B.lbig.push(c);
        ui.flash('#ffe0f4', .5, .5); ui.pop(P3(f, 4.4), '🌸 거대한 백합!', '#ffd0f0', true); vfx.ring(P3(f), { r0: .5, r1: c.R * S, dur: .9, color: LILY });
      } },
      c: { name: '자유를 향해', cd: 24, desc: '빠르게 다가가 지팡이로 밀친 뒤 백합 마법 콤보. 총 5000 (돌진·밀치기 1000 + 백합 5번)', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 1100) { toast(f, '사거리 밖'); return false; }
        setAnim(f, 'slash', .4); f.st.inv = Math.max(f.st.inv, .8); let st = 0, n = 0, t0 = 0; const T = 2.6;
        act(f, T, (u, dt) => {
          const t = u * T, a = ang(f, e);
          if (st === 0) { f.face = a; f.x = clamp(f.x + Math.cos(a) * 2600 * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * 2600 * dt, PAD, H - PAD); vfx.emit('glow', { x: P3(f).x, y: 1.2, z: P3(f).z, life: .4, s0: 1.4, s1: 0, c0: 0xffffff, c1: LILY, a: .7, drag: 0 });
            if (dist(f, e) < f.r + e.r + 80) { st = 1; t0 = t; setAnim(f, 'slash', .3); hurt(f, e, 500, { dir: a }); e.kb = { vx: Math.cos(a) * 1500, vy: Math.sin(a) * 1500, t: .35 }; hurt(f, e, 500, { quiet: true, field: true }); ui.pop(P3(f, 4), '🪄 밀치기!', '#ffd0f0', true); shake(.8, .3); } else if (t > .8) st = 3; }
          else if (st === 1 && t - t0 > .45) { st = 2; }
          else if (st === 2) { while (n < 5 && t >= t0 + .45 + n * .3) { n++; const x = e.x + rnd(-70, 70), y = e.y + rnd(-70, 70); lilyBloomFx(x, y, 110); if (e.hp > 0) { hurt(f, e, 800, { quiet: true, field: true }); e.hAcc = (e.hAcc || 0) + 800 * dmgMul(f); ui.pop(P3(e, 3 + rnd(0, 1)), Math.round(e.hAcc), '#ffd0f0', true); e.hAcc = 0; } shake(.4, .2); } }
        }, () => { f.st.inv = 0; });
      } },
      v: { name: '자유의 깃발과 백합', cd: 70, desc: '자유의 깃발 6개를 원형으로 꽂고 안에 백합이 서서히 핀다. 총 12000. 안의 적은 봉인되어 강화된 봉인수(비스트 영혼 웨이브)로 끌려간다', use(f) { return startFlags(f); } },
      r: { name: '운명의 대천사', cd: 0, desc: '(게이지 100%) 하늘에 시공간의 균열을 열어 운명의 대천사(HP 30000)를 소환하고 탑승해 조종한다', use(f) { return startArchangel(f); } },
    },
    angel: {
      a: { name: '대천사의 일격', cd: .9, desc: '촉수로 내리친다 500', use(f) { setAnim(f, 'slash', .3); swing(f, 420, 1.2, 500, 0xd8b0ff); } },
      z: { name: '촉수 공격', cd: 9, desc: '촉수를 뻗어 공격한다 (6000)', use(f) { angelTentacles(f); } },
      x: { name: '운명의 영혼 방출', cd: 20, desc: '가슴의 코어를 열어 영혼을 방출. 10초 동안 총 10000 + 슬로우', use(f) { return angelSouls(f); } },
      c: { name: '흡수', cd: 14, desc: '8초 동안 적의 공격을 코어로 흡수한다', use(f) { f.absorb = { t: 8, list: f.absorb ? f.absorb.list : [] }; ui.pop(P3(f, 12), '🌀 흡수!', '#d8b0ff', true); ui.flash('#a070ff', .3, .4); vfx.ring(P3(f), { r0: 1, r1: 16, dur: .8, color: 0xa070ff }); } },
      v: { name: '공격 대방출', cd: 16, desc: '흡수한 적의 공격을 상대가 쓴 형태 그대로 방출한다', use(f) { return angelRelease(f); } },
      r: { name: '탑승 해제', cd: 1, desc: '대천사에서 내린다', use(f) { endArchangel(f, true); } },
    }
  }
};
CHARS.lily.awakeId = 'lilyA';
/* ===== 홀리베리 쿠키 (id 'berry', HP 37000, 탱커) ===== */
const HBR = 0xd8486a;
function hbAllies(f) { return [f, ...B.fighters.filter(o => o !== f && ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f))]; }
function berryShield(f) {   // x: 베리 홀리 — 큰 방패 이펙트 (적 공격을 막거나 반사)
  const R = 220, p = P3(f), dome = vfx.dome(p, R * S, 0xff7a9a), ring = vfx.decal(p, { tex: 'ring', r: R * S, color: 0xffffff, alpha: .9, y: .08 });
  const sh = new THREE.Group(), face = new THREE.Mesh(new THREE.CylinderGeometry(R * S * .55, R * S * .45, .8, 6), new THREE.MeshStandardMaterial({ color: 0xffd0dc, emissive: 0xff5a80, emissiveIntensity: .8, metalness: .5, roughness: .3, transparent: true, opacity: .75 })); face.rotation.x = Math.PI / 2; sh.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * S * .52, .35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); sh.add(rim); addExtra(sh); f.hbShield = { dome, ring, sh };
}
function endBerryShield(f) { const b = f.hbShield; if (!b) return; vfx.remove(b.dome); vfx.remove(b.ring); rmExtra(b.sh); f.hbShield = null; }
function updBerry(dt) {
  for (const f of B.fighters) {
    if (f.dr30 > 0) f.dr30 -= dt;
    if (f.hbV > 0) f.hbV -= dt;
    if (f.holy > 0) {
      f.holy -= dt; const b = f.hbShield; if (b) { const p = P3(f); b.dome.obj && b.dome.obj.position.set(p.x, b.dome.obj.position.y, p.z); b.ring.obj.position.set(p.x, b.ring.obj.position.y, p.z); b.sh.position.set(p.x + Math.cos(f.face) * 5, 3.2, p.z + Math.sin(f.face) * 5); b.sh.rotation.y = -f.face + Math.PI / 2; }
      if (f.holy <= 0 || f.hp <= 0) { f.holy = 0; endBerryShield(f); f.hbBig = 0; }
    }
    if (f.def.id === 'berry') { const want = f.holy > 0 ? 1.18 : 1; f.root.scale.setScalar(lerp(f.root.scale.x, want, .15)); }
  }
}
function hbHurtAdjust(t, src, d, o) {   // 홀리베리의 피해 경감/대신 맞기. 반환: 실제로 t 에게 들어갈 피해 (아군 몫은 베리가 따로 맞는다)
  if (t.dr30 > 0) d *= .7;   // z: 10초간 받는 피해 30% 감소
  for (const b of B.fighters) {
    if (!(b.hbV > 0) || b.hp <= 0 || realmOf(b) !== realmOf(t)) continue;
    if (b === t) { d *= .15; }   // v: 자신이 받는 피해 85% 감소
    else if (ally(b, t)) {   // 아군이 받는 피해 40% 감소, 그 30% 는 베리가 대신 맞고(85% 감소)
      d *= .6; const take = d * .3; d -= take; const bd = take * .15; if (bd > 0) { b.hp = Math.max(1, b.hp - bd); b.flash = .1; b.cmb = B.time; if (!o.quiet || Math.random() < .15) ui.pop(P3(b, 3 + rnd(0, 1)), '🛡 대신 ' + Math.round(bd), '#ffb0c0'); }
    }
  }
  return d;
}
CHARS.berry = {
  id: 'berry', name: '홀리베리 쿠키', color: HBR, fx: 0xffa0b8, cost: 1800, hp: 37000, pref: 4.2, atkRange: 180, aiPref: 110, tag: '방패 · 수호 · 반사 · 불굴',
  skills: {
    base: {
      a: { name: '방패치기', cd: .6, desc: '방패로 친다 150', use(f) { setAnim(f, 'slash', .25); swing(f, 170 * (f.area || 1), 1.0, 150, HBR); } },
      z: { name: '방패 내려찍기', cd: 16, desc: '방패로 땅을 내려찍는다 1500. 10초 동안 아군과 자신이 받는 피해 30% 감소', use(f) {
        setAnim(f, 'cast', .5); f.pose = 'raise';
        runScript(f, [{ at: .45, fn: () => {
          f.pose = null; setAnim(f, 'slash', .3); const p = P3(f, .2).add(new THREE.Vector3(Math.cos(f.face), 0, Math.sin(f.face)).multiplyScalar(4));
          vfx.ring(p, { r0: 1, r1: 260 * S * 1.3, dur: .6, color: HBR }); vfx.burst('spark', p, 40, { speed: 6, speed2: 16, life: .6, size: .6, c0: 0xffffff, c1: HBR, grav: 5 }); shake(1.2, .4); B.hitstop = Math.max(B.hitstop, .08);
          shock(f, 260, HBR, 1500);
          for (const o of hbAllies(f)) { o.dr30 = 10; ui.pop(P3(o, 3.6), '🛡 받는 피해 -30%', '#ffb0c0'); }
        } }], .9, () => { f.pose = null; });
      } },
      x: { name: '베리 홀리', cd: 40, desc: '방패가 커지고 큰 방패 이펙트가 나와 15초 동안 적의 공격을 막거나 반사한다. 시전 시 나는 100 피해', use(f) {
        setAnim(f, 'cast', .6); hurt(f, f, 100, { quiet: true, field: true }); f.holy = 15; endBerryShield(f); berryShield(f); ui.flash('#ff7a9a', .5, .5); shake(.8, .5); ui.pop(P3(f, 4.4), '🛡 베리 홀리!', '#ffd0dc', true);
      } },
      c: { name: '방패 강타', cd: 18, desc: '점프해서 방패로 상대를 내려찍는다 2500', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 900) { toast(f, '사거리 밖'); return false; }
        setAnim(f, 'cast', .3); f.pose = 'leap'; f.st.inv = Math.max(f.st.inv, .6); const sx = f.x, sy = f.y; let done = false; const T = 1;
        act(f, T, (u, dt) => { const a = ang(f, e), d = Math.min(dist({ x: sx, y: sy }, e), 900); f.x = clamp(sx + Math.cos(a) * d * u, PAD, W - PAD); f.y = clamp(sy + Math.sin(a) * d * u, PAD, H - PAD); f.air = 11 * Math.sin(u * Math.PI); f.face = a;
          if (u >= .96 && !done) { done = true; f.air = 0; setAnim(f, 'slash', .3); shock(f, 240, HBR, 2500); shake(1.4, .45); const p = P3(f); vfx.ring(p, { r0: 1, r1: 12, dur: .55, color: HBR }); vfx.burst('spark', p, 36, { speed: 7, speed2: 18, life: .55, size: .6, c0: 0xffffff, c1: HBR, grav: 5 }); } }, () => { f.air = 0; f.pose = null; });
      } },
      v: { name: '불굴의 홀리베리', cd: 60, desc: '25초 동안 내가 받는 피해 85% 감소, 아군이 받는 피해 40% 감소. 아군 피해의 30% 는 내가 대신 맞되 그 피해도 85% 감소', use(f) {
        setAnim(f, 'roar', .8); f.hbV = 25; ui.flash('#ff7a9a', .5, .5); shake(.8, .5); ui.pop(P3(f, 4.4), '🛡 불굴의 홀리베리!', '#ffd0dc', true); vfx.ring(P3(f), { r0: 1, r1: 18, dur: .9, color: HBR }); vfx.burst('glow', P3(f, 1.4), 50, { speed: 3, speed2: 12, life: 1, size: 1.2, c0: 0xffffff, c1: HBR, up: 3 });
        for (const o of hbAllies(f)) { vfx.column(P3(o), { r: 1.6, h: 16, dur: .8, color: HBR, alpha: .5 }); }
      } },
    }
  }
};
/* ===== 시간지기 쿠키 (id 'timekeeper', 레전더리) ===== */
const TKC = 0xffd070;
const recentDmg = f => { const L = f.dmgLog; if (!L) return 0; let s = 0; for (const [t, d] of L) if (t > B.time - 60) s += d; return s; };   // 최근 1분간 받은 피해
function buildScissors(len) {   // 거대한 시간가위 (+z 방향으로 벌어진 날 두 개)
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffa020, emissiveIntensity: .9, metalness: .8, roughness: .25, flatShading: true });
  const a = new THREE.Group(), b = new THREE.Group();
  for (const [p, sd] of [[a, 1], [b, -1]]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(len * .06, len * .02, len * .5).translate(0, 0, len * .25), m); p.add(bl); const hd = new THREE.Mesh(new THREE.TorusGeometry(len * .1, len * .018, 8, 20), m); hd.position.set(0, 0, -len * .12); hd.rotation.x = Math.PI / 2; p.add(hd); g.add(p); p.userData.sd = sd; }
  g.userData.a = a; g.userData.b = b; return g;
}
function startRift(f) {   // Z: 시공간의 틈 — 틈에서 팔과 쿠키들이 나와 공격, Z 다시 누르면 거대 가위로 전부 자르고 틈이 닫힌다
  if (f.rift) { riftCut(f); return 'nocd'; }
  setAnim(f, 'cast', .7); f.pose = 'raise'; runScript(f, [], .7, () => { f.pose = null; });
  const R = 480, p = P3(f), ring = vfx.decal(p, { tex: 'ring', r: R * S, color: 0xb070ff, alpha: .9, y: .08 }), rune = vfx.decal(p, { tex: 'rune', r: R * S * .9, color: 0x7a30d0, alpha: .5, spin: .8, y: .07 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R * S, 40), new THREE.MeshBasicMaterial({ color: 0x0a0018, transparent: true, opacity: .75, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.copy(p).setY(.12); addExtra(disc);
  f.rift = { x: f.x, y: f.y, R, t: 0, tick: 0, ring, rune, disc, minions: [], nm: 0, scissors: null };
  ui.flash('#a060ff', .5, .5); shake(1, .6); ui.pop(P3(f, 4.4), '🌀 시공간의 틈! (Z: 자르기)', '#e0c8ff', true); return 'nocd';   // 다시 누를 수 있게 쿨타임은 틈이 닫힐 때(endRift) 시작
}
function riftCut(f) {
  const r = f.rift; if (!r || r.cut) return; r.cut = true; r.cutT = 0; setAnim(f, 'slash', .6);
  const sc = buildScissors(20); sc.position.copy(P3({ x: r.x, y: r.y, realm: f.realm }, 16)); sc.scale.setScalar(.01); addExtra(sc); r.scissors = sc;
  ui.pop(P3(f, 4.4), '✂ 모든 것을 잘라라!', '#fff0b0', true); ui.flash('#fff0b0', .4, .4);
}
function endRift(f) { const r = f.rift; if (!r) return; vfx.remove(r.ring); vfx.remove(r.rune); rmExtra(r.disc); if (r.scissors) rmExtra(r.scissors); r.minions.forEach(m => { if (m.hp > 0) m.hp = 0; }); f.rift = null; f.cd.z = 14; }
function startTimeZone(f) {   // X: 시간의 장판
  setAnim(f, 'cast', .7); const R = 560, p = P3(f), z = { owner: f, x: f.x, y: f.y, R, t: 0, dur: 12, tick: 0, snap: new Map() };
  for (const o of B.fighters) if (!o.minion) z.snap.set(o, recentDmg(o));
  z.ring = vfx.decal(p, { tex: 'ring', r: R * S, color: 0xffd070, alpha: .9, y: .08 }); z.rune = vfx.decal(p, { tex: 'rune', r: R * S * .95, color: 0xffe9a0, alpha: .5, spin: -.5, y: .07 });
  const hand = new THREE.Mesh(new THREE.BoxGeometry(R * S * .9, .15, .5).translate(R * S * .45, 0, 0), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: .8 })); hand.position.copy(p).setY(.2); addExtra(hand); z.hand = hand;
  B.tzones = B.tzones || []; B.tzones.push(z); ui.flash('#ffe9a0', .5, .5); ui.pop(P3(f, 4.4), '⏳ 시간의 장판!', '#fff0b0', true); vfx.ring(p, { r0: 1, r1: R * S, dur: .8, color: 0xffd070 });
}
function startVoidCut(f) {   // C: 공간자르기 — 적이 서 있는 공간을 잘라 공허로 보낸다
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 900) { toast(f, '사거리 밖'); return false; }
  if (B.gk || B.voidR || B.dream || B.seal || B.abyss || B.mind || B.lult || B.cut || B.explore || B.raid || B.fx) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  if (inBarrier(f, e)) { ui.pop(P3(e, 3.4), '장막이 막았다!', '#fff3b0'); return false; }
  setAnim(f, 'slash', .6); const a = ang(f, e); vfx.slashGround(P3(e, .5), Math.PI / 2 - a, { len: 22, color: 0xffd070, from: 1, dur: .6 }); vfx.slashGround(P3(e, .5), Math.PI / 2 - a + 1.2, { len: 22, color: 0xffffff, from: -1, dur: .6 }); shake(1.2, .5); ui.flash('#fff0b0', .5, .5);
  clearStates(e); dropOwned(x => x.owner === e); B.projs.forEach(p => { if (p.owner === e) killProj(p); });
  const V = B.voidR = { f, t: e, ret: { x: e.x, y: e.y }, rs: { owner: f, target: e }, tm: 0, mobs: [] }; e.realm = 1; e.x = W / 2; e.y = H / 2; e.st.stun = 0; e.st.inv = 1.2; B.viewSeal = false; camState.init = false; world.setDream(5);
  const ids = ORDER.filter(id => id !== 'brave' && id !== 'timekeeper'), pick = () => ids[Math.floor(Math.random() * ids.length)];
  for (let i = 0; i < 5; i++) { const id = pick(), aa = i / 5 * 6.283, m = addMinion(id, clamp(W / 2 + Math.cos(aa) * 420, PAD, W - PAD), clamp(H / 2 + Math.sin(aa) * 360, PAD, H - PAD), { hp: 3000, pm: .35, realm: 1 }); m.voidMob = true; m.pseal = 1e9; m.gauge = -1e9; m.awake = false; m.nick = '공허'; V.mobs.push(m); }
  ui.pop(P3(e, 4.4), '🕳 공허의 영역!', '#e0c8ff', true);
  if (B.fighters[0] === e) { ui.title('공허의 영역', 'THE VOID'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2200); toast(e, '공허의 쿠키 5명을 쓰러뜨리면 돌아갑니다. 여기서 죽으면 부활할 수 없어요!'); } else toast(f, '적을 공허에 가뒀습니다. G키로 공허 화면을 볼 수 있어요');
}
function endVoid(died) {
  const V = B.voidR; if (!V) return; const e = V.t; V.mobs.forEach(m => { if (m.hp > 0) m.hp = 0; }); B.fighters.forEach(m => { if (m.voidMob) removeFighter(m); }); B.fighters = B.fighters.filter(m => !m.voidMob);
  e.realm = 0; e.x = V.ret.x; e.y = V.ret.y; if (died) e.noResp = true; else e.st.stun = Math.max(e.st.stun, 1); B.voidR = null; B.viewSeal = false; camState.init = false; world.setDream(0); ui.flash('#fff0b0', .6, .5);
  if (died) ui.pop(P3(e, 4), '💀 공허에서 쓰러졌다 (부활 불가)', '#ff9a9a', true);
}
function startTimeEnd(f) {   // V: 시간의 끝 (컷신) — 12000 광역 + 시간 오류
  if (f.cutV) return false; f.cutV = true; setAnim(f, 'cast', 4.4); f.pose = 'raise'; f.st.inv = Math.max(f.st.inv, 4.6);
  ui.cinema(true); ui.title(f.def.name, '시간의 끝'); ui.tint('rgba(200,10,30,.14)'); ui.flash('#ff2040', .6, .5);
  const c0 = P3(f), objs = [];   // 시전자 머리 위에 붉은 시간장판(시계) + 시간선(진짜 줄)
  const clock = new THREE.Group(), disc = new THREE.Mesh(new THREE.CircleGeometry(20, 56), new THREE.MeshBasicMaterial({ color: 0x6a0010, transparent: true, opacity: .72, side: THREE.DoubleSide })); clock.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(20, .35, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffd070 })); clock.add(rim);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, tk = new THREE.Mesh(new THREE.BoxGeometry(.7, 3, .2), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); tk.position.set(Math.cos(a) * 17, Math.sin(a) * 17, .1); tk.rotation.z = a - Math.PI / 2; clock.add(tk); }
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(.7, 14, .2).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0xffffff })), h2 = new THREE.Mesh(new THREE.BoxGeometry(1, 10, .2).translate(0, 5, 0), new THREE.MeshBasicMaterial({ color: 0xffd070 })); clock.add(h1, h2);
  clock.position.set(c0.x, 1.6, c0.z); clock.rotation.x = -Math.PI / 2 + .25; clock.scale.setScalar(.01); addExtra(clock); objs.push(clock);
  const lines = [], N = 5; for (let i = 0; i < N; i++) {   // 시간선: 가늘고 긴 붉은 줄 5가닥 (시계 위를 가로지른다)
    const len = 70, ln = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, len, 6), new THREE.MeshBasicMaterial({ color: 0xff3a50, transparent: true, opacity: 0 }));
    ln.rotation.z = Math.PI / 2; ln.rotation.y = .5; ln.position.set(c0.x, 3 + i * .5, c0.z + (i - 2) * 3.5); addExtra(ln); lines.push(ln); objs.push(ln);
  }
  const sc = buildScissors(11); sc.position.set(c0.x, 4.2, c0.z); sc.rotation.y = .5 + Math.PI / 2; sc.scale.setScalar(.01); addExtra(sc); objs.push(sc); let cut = false; const bb = B;
  act(f, 4.4, (u, dt) => {
    const t = u * 4.4; f.pose = 'raise'; clock.scale.setScalar(Math.max(.01, ease.out(Math.min(1, t / 1.2)))); h1.rotation.z -= dt * 2.2; h2.rotation.z -= dt * .5; clock.position.set(P3(f).x, 1.6, P3(f).z);
    lines.forEach((ln, i) => { ln.material.opacity = Math.min(1, Math.max(0, (t - .7 - i * .12) / .5)); ln.position.x = P3(f).x; ln.position.z = P3(f).z + (i - 2) * 3.5; if (!cut) ln.material.color.setHex(i % 2 ? 0xff3a50 : 0xff8090); });
    if (t > 1.7) { sc.scale.setScalar(Math.max(.01, ease.out(Math.min(1, (t - 1.7) / .8)))); sc.position.set(P3(f).x + (t < 3 ? -22 + (t - 1.7) / 1.3 * 22 : 0), 4.2, P3(f).z); }
    const open = t < 3 ? .8 : Math.max(0, .8 - (t - 3) / .25 * .8); sc.userData.a.rotation.y = open; sc.userData.b.rotation.y = -open;
    if (t > 3.25 && !cut) {   // 가위가 시간선을 싹둑: 줄이 둘로 갈라진다
      cut = true; ui.flash('#ffffff', .9, .8); shake(2.4, .9); B.hitstop = Math.max(B.hitstop, .15);
      lines.forEach((ln, i) => { ln.visible = false; for (const sd of [-1, 1]) { const hf = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 35, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })); hf.rotation.z = Math.PI / 2; hf.rotation.y = .5; hf.position.set(ln.position.x + sd * 17.5 * Math.cos(.5), ln.position.y, ln.position.z - sd * 17.5 * Math.sin(.5)); addFxm(hf, 1.2, (uu, m) => { m.position.x += sd * dt * 14 * Math.cos(.5); m.position.z -= sd * dt * 14 * Math.sin(.5); m.position.y -= dt * 6 * uu; m.material.opacity = 1 - uu; }); } });
      vfx.ring(P3(f), { r0: 1, r1: 90, dur: 1, color: 0xff2040 }); ui.pop(P3(f, 4.6), '⏳ 시간의 끝!', '#ffe0e0', true);
      for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f)) { hurt(f, o, 12000, { dir: 0 }); if (!o.minion) { o.terr = { left: 12, hist: [], nxt: 3, smp: 0 }; ui.pop(P3(o, 4), '⏳ 시간 오류!', '#ffb0b8', true); } }
    }
  }, () => { f.pose = null; f.cutV = false; f.st.inv = 0; objs.forEach(m => rmExtra(m)); if (B === bb) { ui.cinema(false); ui.title('', ''); ui.tint(''); } });
}
function updTimekeeper(dt) {
  for (const f of B.fighters) {
    if (f.tdeb > 0) f.tdeb -= dt;
    const r = f.rift; if (r) {
      r.t += dt; r.tick -= dt; r.disc.material.opacity = .75; r.rune.obj.rotation.z += dt;
      if (!r.cut) {
        if (r.tick <= 0 && f.hp > 0) {
          r.tick = .55; const es = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(o, r) < r.R + 700), e = es.length ? es[Math.floor(Math.random() * es.length)] : null;
          if (e) {
            const a = rnd(0, 6.283), sx = r.x + Math.cos(a) * r.R * .8, sy = r.y + Math.sin(a) * r.R * .8, kind = Math.random() < .5 ? 0 : 1;
            const m = new THREE.Mesh(new THREE.CylinderGeometry(.3, 1.2, 1, 8).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: kind ? 0x2a6a30 : 0x1a0a30, emissive: kind ? 0x40c050 : 0x7a30d0, emissiveIntensity: .8, flatShading: true }));
            const A = P3({ x: sx, y: sy, realm: f.realm }, .5), Bp = P3({ x: e.x, y: e.y, realm: f.realm }, 1), len = A.distanceTo(Bp); m.position.copy(A); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bp.clone().sub(A).normalize()); addFxm(m, .5, u => { const k = u < .4 ? u / .4 : 1; m.scale.set(1.4, Math.max(.01, len * k), 1.4); if (u > .8) m.scale.x = m.scale.z = Math.max(.01, 1.4 * (1 - (u - .8) / .2)); });
            setTimeout(() => {}, 0); if (e.hp > 0) { hurt(f, e, 300, { quiet: true, field: true }); e.hAcc = (e.hAcc || 0) + 300 * dmgMul(f); if (e.hAcc >= 900) { ui.pop(P3(e, 3 + rnd(0, 1)), Math.round(e.hAcc), kind ? '#b8ffb0' : '#d8b0ff', true); e.hAcc = 0; } vfx.burst('spark', P3(e, 1), 6, { speed: 4, life: .3, size: .4, c0: 0xffffff, c1: kind ? 0x40c050 : 0x7a30d0 }); }
            if (++r.nm % 8 === 0) { const ids = ['mob_dough', 'mob_jelly', 'mob_soldier', 'mob_mage'], id = ids[Math.floor(Math.random() * ids.length)], mm = addMinion(id, clamp(sx, PAD, W - PAD), clamp(sy, PAD, H - PAD), { hp: 2500, pm: f.pm || 1, realm: f.realm, notag: true }); if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f); mm.team = f.team; mm.ttl = 10; mm.dkking = true; mm.legionOf = f; r.minions.push(mm); vfx.burst('glow', P3(mm, 1), 14, { speed: 3, life: .6, size: .8, c0: 0xffffff, c1: 0xb070ff }); }
          }
        }
        if (r.t >= 12 || f.hp <= 0) riftCut(f);
      } else {   // 거대 가위로 자르기
        r.cutT += dt; const u = Math.min(1, r.cutT / .9), op = r.cutT < .6 ? .8 : Math.max(0, .8 - (r.cutT - .6) / .15 * .8);
        r.scissors.scale.setScalar(Math.max(.01, ease.out(Math.min(1, r.cutT / .5)))); r.scissors.userData.a.rotation.y = op; r.scissors.userData.b.rotation.y = -op; r.scissors.rotation.y += dt * 2;
        if (r.cutT >= .7 && !r.hit) { r.hit = true; ui.flash('#ffffff', .8, .7); shake(2, .7); B.hitstop = Math.max(B.hitstop, .12); const p = P3({ x: r.x, y: r.y, realm: f.realm }); vfx.ring(p, { r0: 1, r1: 1100 * S, dur: .8, color: 0xffd070 }); vfx.burst('spark', p, 80, { speed: 8, speed2: 24, life: .8, size: .8, c0: 0xffffff, c1: 0xffd070 });
          for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(o, r) < 1100 + o.r) hurt(f, o, 10000, { dir: ang(f, o) });
          B.projs.forEach(p2 => { if (p2.owner !== f && Math.hypot(p2.x - r.x, p2.y - r.y) < 1100) killProj(p2); }); }
        if (r.cutT >= 1.3) endRift(f);
      }
    }
    // --- 시간 오류: 계속 움직이다가 3초 전 자리/쿨타임으로 되돌아간다 ---
    const te = f.terr; if (te) {
      te.left -= dt; te.smp -= dt; te.nxt -= dt; if (te.smp <= 0) { te.smp = .2; te.hist.push({ t: B.time, x: f.x, y: f.y, cd: Object.assign({}, f.cd) }); if (te.hist.length > 40) te.hist.shift(); }
      if (te.nxt <= 0) { te.nxt = 3; const tg = te.hist.find(h => h.t >= B.time - 3.1) || te.hist[0]; if (tg && f.hp > 0) { vfx.burst('glow', P3(f, 1.2), 30, { speed: 3, speed2: 12, life: .6, size: .9, c0: 0xffffff, c1: 0xff4060 }); f.x = tg.x; f.y = tg.y; Object.assign(f.cd, tg.cd); f.st.stun = Math.max(f.st.stun, .15); vfx.burst('glow', P3(f, 1.2), 30, { speed: 3, speed2: 12, life: .6, size: .9, c0: 0xffffff, c1: 0xff4060 }); ui.pop(P3(f, 3.8), '⏳ 시간 오류! 되감김', '#ffb0b8', true); } }
      if (te.left <= 0 || f.hp <= 0) f.terr = null;
    }
  }
  if (B.tzones && B.tzones.length) {   // 시간의 장판
    for (const z of B.tzones) {
      const f = z.owner; z.t += dt; z.tick -= dt; z.hand.rotation.y -= dt * 2; z.rune.obj.rotation.z -= dt * .5;
      const tick = z.tick <= 0; if (tick) z.tick = 1;
      for (const o of B.fighters) {
        if (o.hp <= 0 || o.minion || realmOf(o) !== realmOf(f) || Math.hypot(o.x - z.x, o.y - z.y) > z.R + o.r) continue;
        if (o === f || ally(f, o)) { o.spdBoost = Math.max(o.spdBoost || 1, 1.4); o.spdBoostT = Math.max(o.spdBoostT || 0, .3); if (tick) { const h = (z.snap.get(o) || 0) * .2 / z.dur; if (h > 0) mHeal(o, h); } }
        else { slowOn(o, .4, .5); if (tick) { const dm = (z.snap.get(o) || 0) * .05 / z.dur; if (dm > 0) { o.hp = Math.max(1, o.hp - dm); ui.pop(P3(o, 3), Math.round(dm), '#ffd070'); } } }
      }
      if (z.t >= z.dur || f.hp <= 0) { vfx.remove(z.ring); vfx.remove(z.rune); rmExtra(z.hand); z.done = true; }
    }
    B.tzones = B.tzones.filter(z => !z.done);
  }
  const V = B.voidR; if (V) {   // 공허의 영역
    V.tm += dt; const e = V.t;
    if (e.hp <= 0) endVoid(true);
    else if (V.f.hp <= 0 || V.tm > 45 || V.mobs.every(m => m.hp <= 0)) endVoid(false);
  }
}
CHARS.timekeeper = {
  id: 'timekeeper', name: '시간지기 쿠키', color: TKC, fx: 0xfff0b0, cost: 1500, hp: 26000, pref: 4, atkRange: 200, aiPref: 150, tag: '시간가위 · 시공간의 틈 · 시간의 장판 · 공허 · 시간의 끝',
  skills: {
    base: {
      a: { name: '싹둑', cd: .8, desc: '시간가위로 싹둑 자른다 400. 맞은 적은 10초 동안 받는 피해 10% 증가', use(f) { setAnim(f, 'slash', .25); swing(f, 200 * (f.area || 1), 1.0, 400, TKC).forEach(t => { t.tdeb = 10; ui.pop(P3(t, 3.4), '⏳ 받는 피해 +10%', '#ffe0a0'); }); } },
      z: { name: '시공간의 틈', cd: 14, desc: '주위에 시공간의 틈을 연다. 틈에서 암흑의 팔·괴물의 팔·다른 쿠키들이 나와 적을 공격한다. Z 를 다시 누르면 시간가위가 거대해져 모든 것을 잘라버리고(10000) 틈이 닫힌다', use(f) { return startRift(f); } },
      x: { name: '시간의 장판', cd: 35, desc: '거대한 장판(12초). 안의 아군은 최근 1분간 받은 피해의 20% 를 회복하고 이동속도 증가, 적은 이동속도 감소와 최근 1분간 받은 피해의 5% 피해', use(f) { startTimeZone(f); } },
      c: { name: '공간자르기', cd: 40, desc: '적이 서 있는 공간을 시간가위로 잘라 공허의 영역으로 보낸다. 공허에는 약한 쿠키 5종이 나온다. 공허에서 죽으면 3v3 모드에서도 부활하지 못한다', use(f) { return startVoidCut(f); } },
      v: { name: '시간의 끝', cd: 75, desc: '[컷신] 하늘에 붉은 시간장판과 시간선이 나타나고 시간선을 시간가위로 잘라 12000 광역 피해 + 시간 오류(순간이동·쿨타임 되돌림)', use(f) { return startTimeEnd(f); } },
    }
  }
};
/* ===== 용과드래곤 쿠키 (id 'pitaya', 드래곤 등급, HP 34000) — 변신은 각성 후(미구현) ===== */
const PTY = 0xff2d4d, PTG = 0x9cff3a;   // 용과(드래곤프루트) 색: 선홍(붉은색) + 연두
function pitFace() { return pHead(.5, 1); }   // 반투명한 용과드래곤 머리 형체
function startPitBreath(f) {   // Z: 반투명한 용 얼굴이 나타나 10초 동안 긴 브레스 (총 5000)
  if (f.pbr) { endPitBreath(f); ui.pop(P3(f, 4), '브레스 취소', '#ffd0d0'); return 'nocd'; } setAnim(f, 'breath', 10); const face = pitFace(); face.scale.setScalar(.01); addExtra(face);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2d4d, transparent: true, opacity: .4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); addExtra(cone);
  f.pbr = { t: 0, dur: 10, tick: 0, face, cone }; f.rooted = true; ui.flash('#ff2d4d', .4, .4); shake(.8, .5); ui.pop(P3(f, 4.4), '🐉 용의 브레스! (Z: 취소)', '#c8ff80', true); return 'nocd';
}
function endPitBreath(f) { const b = f.pbr; if (!b) return; rmExtra(b.face); rmExtra(b.cone); f.pbr = null; f.rooted = false; f.cd.z = 20; }
function pitaDash(f) {   // C: 드라코닉 대쉬 — 돌진 1500 + 베어 날리기 2000 + 브레스 3000 = 6500 (미니 컷신)
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 1000) { toast(f, '사거리 밖'); return false; }
  setAnim(f, 'slash', .4); f.st.inv = Math.max(f.st.inv, 3); let st = 0, t0 = 0, sl = false, br = false; const bb = B, T = 3;
  act(f, T, (u, dt) => {
    const t = u * T, a = ang(f, e);
    if (st === 0) {
      f.face = a; f.x = clamp(f.x + Math.cos(a) * 2800 * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * 2800 * dt, PAD, H - PAD); vfx.emit('glow', { x: P3(f).x, y: 1.3, z: P3(f).z, life: .4, s0: 1.6, s1: 0, c0: 0xffffff, c1: PTY, a: .7, drag: 0 });
      if (e.hp > 0 && dist(f, e) < f.r + e.r + 80) { st = 1; t0 = t; hurt(f, e, 1500, { dir: a }); e.kb = { vx: Math.cos(a) * 1700, vy: Math.sin(a) * 1700, t: .5 }; f.cutV = true; ui.cinema(true); ui.title(f.def.name, '드라코닉 대쉬'); ui.flash('#ffffff', .5, .4); shake(1.4, .5); B.hitstop = Math.max(B.hitstop, .1); }
      else if (t > .9) st = 3;
    } else if (st === 1) {
      if (t - t0 > .55 && !sl) { sl = true; f.x = clamp(e.x - Math.cos(f.face) * 120, PAD, W - PAD); f.y = clamp(e.y - Math.sin(f.face) * 120, PAD, H - PAD); f.face = ang(f, e); setAnim(f, 'slash', .4); const p = P3(e, 1); vfx.slashGround(p, Math.PI / 2 - f.face, { len: 20, color: 0xffffff, from: 1, dur: .5 }); vfx.slashGround(p, Math.PI / 2 - f.face, { len: 20, color: PTG, from: -1, dur: .5 }); if (e.hp > 0) hurt(f, e, 2000, { dir: f.face }); shake(1.6, .5); ui.flash('#d8ff9a', .5, .4); }
      if (t - t0 > 1.15 && !br) { br = true; setAnim(f, 'breath', .8); const a2 = ang(f, e), p = P3(f, 1.4); vfx.burst('glow', p, 90, { speed: 10, speed2: 30, life: .9, size: 1.4, c0: 0xffc0c8, c1: PTY }); vfx.column(P3(e), { r: 5, h: 40, dur: .6, color: PTY, alpha: .8 }); vfx.ring(P3(e), { r0: 1, r1: 14, dur: .7, color: PTY }); ui.flash('#ff2d4d', .7, .6); shake(2.2, .7);
        for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(o, e) < 320 + o.r) hurt(f, o, 3000, { dir: a2 }); }
      if (t - t0 > 2) st = 3;
    }
  }, () => { f.cutV = false; f.st.inv = 0; if (B === bb) { ui.cinema(false); ui.title('', ''); } });
}
function pitDragonDash(f) {   // Q (용언의 보호막 안에서만): 용의 형상으로 돌진 2000
  if (!f.inPF) { toast(f, '용언의 보호막 안에서만 쓸 수 있습니다'); return false; }
  const a = f.face, hit = new Set(); let mv = 0; const L = 700, sp = 2000, d = dkaDragon(true); d.scale.setScalar(1.8); addExtra(d); setAnim(f, 'slash', .3);
  act(f, L / sp + .3, (u, dt) => {
    const st = Math.min(L - mv, sp * dt); mv += st; f.x = clamp(f.x + Math.cos(a) * st, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * st, PAD, H - PAD); const p = P3(f, 1.4); d.position.copy(p); d.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); d.userData.segs.forEach((s, i) => { s.position.z = -i * .9; });
    vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .4, s0: 1.8, s1: 0, c0: 0xc8ff80, c1: PTY, a: .7, drag: 0 });
    for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && !hit.has(t) && dist(f, t) < f.r + t.r + 110) { hit.add(t); hurt(f, t, 2000, { dir: a }); shake(.8, .3); vfx.burst('spark', P3(t, 1), 20, { speed: 6, speed2: 14, life: .5, size: .6, c0: 0xffffff, c1: PTY }); }
  }, () => rmExtra(d));
}
function startDragonField(f) {   // V: 용언의 보호막 — 거대한 용의 장판 (20초)
  if (f.pfield) return false; setAnim(f, 'cast', .8); const R = 520, p = P3(f);
  const ring = vfx.decal(p, { tex: 'ring', r: R * S, color: PTY, alpha: .9, y: .08 }), rune = vfx.decal(p, { tex: 'rune', r: R * S * .95, color: PTY, alpha: .55, spin: .6, y: .07 });
  const dr = []; for (let i = 0; i < 2; i++) { const d = dkaDragon(i === 0); d.scale.setScalar(3); addExtra(d); dr.push(d); }
  const fld = { owner: f, x: f.x, y: f.y, R, t: 0, dur: 20, ring, rune, dr, trail: [[], []] }; B.pfields = B.pfields || []; B.pfields.push(fld); f.pfield = fld;
  ui.flash('#ff2d4d', .5, .5); shake(1, .6); ui.pop(P3(f, 4.4), '🐉 용언의 보호막!', '#c8ff80', true); vfx.ring(p, { r0: 1, r1: R * S, dur: .9, color: PTY });
}
function updPitaya(dt) {
  for (const f of B.fighters) {
    if (f.dscale > 0) f.dscale -= dt;
    if (f.pbr) {   // Z 브레스
      const b = f.pbr; b.t += dt; b.tick -= dt; f.rooted = true; const L = 800, half = .38, a = f.face, p = P3(f, 1.8), fp = P3(f, 4.5).add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3));
      b.face.position.copy(fp); b.face.scale.setScalar(Math.max(.01, 2.2 * ease.out(Math.min(1, b.t / .6)))); b.face.lookAt(fp.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))));
      b.cone.position.copy(p).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(L * S * .5)); b.cone.scale.set(Math.tan(half) * L * S, L * S, Math.tan(half) * L * S); b.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      for (let i = 0; i < 4; i++) { const d = rnd(1, L) * S, o = rnd(-half, half) * d; vfx.emit('glow', { x: p.x + Math.cos(a) * d - Math.sin(a) * o, y: 1.6 + rnd(-.8, .8), z: p.z + Math.sin(a) * d + Math.cos(a) * o, life: .4, s0: 1.4, s1: 0, c0: 0xffffff, c1: PTY, a: .6, drag: 0 }); }
      if (b.tick <= 0) { b.tick = .1; shake(.2, .12); for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f)) { const d = dist(f, t); if (d < L + t.r && adiff(ang(f, t), a) < half + Math.atan2(t.r, Math.max(d, 1))) { hurt(f, t, 50, { quiet: true, field: true, dir: a }); t.hAcc = (t.hAcc || 0) + 50 * dmgMul(f); if (t.hAcc >= 1000) { ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(t.hAcc), '#c8ff80', true); t.hAcc = 0; } } } }
      if (b.t >= b.dur || f.hp <= 0 || f.st.stun > 0) endPitBreath(f);
    }
    f.inPF = false;
  }
  if (B.pfields && B.pfields.length) {   // V 용의 장판
    for (const p of B.pfields) {
      const o = p.owner; p.t += dt; const c = P3({ x: p.x, y: p.y, realm: o.realm }); p.rune.obj.rotation.z += dt * .4;
      p.dr.forEach((d, i) => { const a = p.t * (i ? -.9 : .9) + i * Math.PI, R = p.R * S * .85, pos = new THREE.Vector3(c.x + Math.cos(a) * R, 3.5 + Math.sin(p.t * 2 + i) * 1, c.z + Math.sin(a) * R), tr = p.trail[i]; tr.push(pos); if (tr.length > 60) tr.shift(); const sg = d.userData.segs, hd = d.userData.head; d.position.set(0, 0, 0); sg.forEach((s, j) => { const q = tr[Math.max(0, tr.length - 1 - j * 5)]; s.position.copy(q); s.scale.setScalar(3); }); const p0 = tr[tr.length - 1], p1 = tr[Math.max(0, tr.length - 4)], dv = p0.clone().sub(p1); if (dv.lengthSq() < 1e-8) dv.set(1, 0, 0); dv.normalize(); hd.scale.setScalar(3); hd.position.copy(p0).addScaledVector(dv, 3); hd.lookAt(hd.position.clone().add(dv)); hd.rotateX(Math.PI / 2); });
      for (const t of B.fighters) if (t.hp > 0 && (t === o || ally(o, t)) && Math.hypot(t.x - p.x, t.y - p.y) < p.R) { if (t === o) o.inPF = true; }
      if (p.t >= p.dur || o.hp <= 0) { vfx.remove(p.ring); vfx.remove(p.rune); p.dr.forEach(d => rmExtra(d)); p.done = true; o.pfield = null; o.cd.v = o.cd.v || 0; }
    }
    B.pfields = B.pfields.filter(p => !p.done);
  }
}
CHARS.pitaya = {
  id: 'pitaya', name: '용과드래곤 쿠키', kin: true, color: PTY, fx: 0xc8ff80, cost: 2200, hp: 34000, pref: 4, atkRange: 460, aiPref: 300, tag: '검기 · 용의 브레스 · 용의 비늘 · 용언의 보호막',
  skills: {
    base: {
      a: { name: '용검 검기', cd: .9, desc: '검에서 검기를 날린다 500. 4번째 공격은 브레스와 함께 검기를 날린다', use(f) {
        setAnim(f, 'slash', .3); f.pitN = (f.pitN || 0) + 1; const a = f.face, fourth = f.pitN % 4 === 0;
        vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 12, color: PTY, from: f.swingDir = -(f.swingDir || 1), dur: .3 });
        shoot(f, { a, sp: 1100, r: fourth ? 60 : 36, dmg: 500, color: PTY, kind: 'wave', life: fourth ? 1.2 : .9, pierce: fourth });
        if (fourth) { ui.pop(P3(f, 4), '🐉 브레스 검기!', '#c8ff80', true); vfx.burst('glow', P3(f, 1.5).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(2)), 40, { speed: 8, speed2: 22, life: .7, size: 1.1, c0: 0xffffff, c1: PTY }); shake(.6, .3);
          for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f)) { const d = dist(f, o); if (d < 620 && adiff(ang(f, o), a) < .35) hurt(f, o, 500, { dir: a }); } }
      } },
      z: { name: '용의 얼굴', cd: 20, desc: '반투명한 용 얼굴의 형체가 나타나 10초 동안 긴 브레스를 쏜다 (총 5000)', use(f) { return startPitBreath(f); } },
      x: { name: '용의 비늘', cd: 45, desc: '30초 동안 받는 피해 70% 감소. 적이 나를 공격하면 같은 공격이 원래 피해의 40%로 되돌아간다', use(f) { setAnim(f, 'cast', .6); f.dscale = 30; ui.flash('#ff2d4d', .4, .4); ui.pop(P3(f, 4.4), '🐲 용의 비늘!', '#c8ff80', true); vfx.ring(P3(f), { r0: 1, r1: 10, dur: .7, color: PTY }); vfx.burst('spark', P3(f, 1.4), 40, { speed: 4, speed2: 12, life: .8, size: .6, c0: PTG, c1: PTY }); } },
      c: { name: '드라코닉 대쉬', cd: 26, desc: '상대에게 빠르게 돌진해 맞추면 검으로 베어 날려 보내고 브레스를 쏜다 (컷신). 총 6500', use(f) { return pitaDash(f); } },
      v: { name: '용언의 보호막', cd: 70, desc: '거대한 용의 장판(20초). 안에서 적이 나나 아군을 때리면 그 피해만큼 보호막이 생기고 내 방어력이 오른다. 장판 안에서는 Q 로 용의 형상으로 돌진(2000)할 수 있다', use(f) { return startDragonField(f); } },
      q: { name: '용의 돌진', cd: 5, desc: '(용언의 보호막 안) 용의 형상으로 돌진 2000', use(f) { return pitDragonDash(f); } },
    }
  }
};
/* ===== 파인드래곤 쿠키 (id 'ananas', 드래곤 등급, HP 32000 임시) ===== */
const ANA = 0xe8b020, ROCK = 0x8a5a2a, YZC = 0xffd83a;
function spikeFx(x, y, R, n = 7, dur = .9) {   // 땅에서 갈색 가시가 솟아오른다 (로직 좌표 x,y)
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: .9, flatShading: true });
  for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd(0, .5), d = Math.sqrt(Math.random()) * R * S, h = rnd(2.2, 4.2), c = new THREE.Mesh(new THREE.ConeGeometry(.55, h, 6).translate(0, h / 2, 0), mat); c.position.set(Math.cos(a) * d, -h, Math.sin(a) * d); c.userData.h = h; g.add(c); }
  g.position.copy(P3({ x, y, realm: 0 })); addFxm(g, dur, u => { const k = u < .25 ? ease.out(u / .25) : u > .75 ? 1 - (u - .75) / .25 : 1; g.children.forEach(c => c.position.y = -c.userData.h * (1 - k)); });
  vfx.burst('spark', P3({ x, y, realm: 0 }, .3), 14, { speed: 4, speed2: 10, life: .5, size: .5, c0: 0xffe0a0, c1: 0x8a5a2a, grav: 5 });
}
function anaHead() {   // 금빛 용의 머리 형상 (반투명)
  const hd = buildDragonHead(), w = new THREE.Group(); if (!hd) { w.add(buildLichFace()); return w; }
  hd.scale.setScalar(5.5 / Math.max(.5, hd.userData.size)); hd.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .62; o.material.depthWrite = false; o.material.map = null; o.material.vertexColors = false; o.material.color = new THREE.Color(0xd8a010); o.material.emissive = new THREE.Color(0xffb800); o.material.emissiveIntensity = .55; o.material.needsUpdate = true; } });
  w.add(hd); return w;
}
function startRockRain(f) {   // Z: 하늘에서 바위를 마구 떨군다 (72개 × 약 167 = 12000)
  const e = foe(f); setAnim(f, 'cast', 1); f.pose = 'raise'; runScript(f, [], 1, () => { f.pose = null; });
  f.rrain = { t: 0, n: 0, N: 72, px: e && e !== B.ghost ? e.x : f.x + Math.cos(f.face) * 400, py: e && e !== B.ghost ? e.y : f.y + Math.sin(f.face) * 400 };
  ui.flash('#c89040', .4, .4); shake(.8, .6); ui.pop(P3(f, 4.4), '☄ 바위 소나기!', '#ffe0a0', true);
}
function startYz(f, absorb) {   // X: 용언의 영역 (맵 전체를 노란 용언이 감싼다). 군림 후엔 흡수의 용언
  if (f.yz) return false; setAnim(f, 'roar', .9); const R = Math.max(W, H) * S * .62, p = P3({ x: W / 2, y: H / 2, realm: 0 });
  const ring = vfx.decal(p, { tex: 'rune', r: R, color: YZC, alpha: .35, spin: .15, y: .06 }), ring2 = vfx.decal(p, { tex: 'ring', r: R * .98, color: YZC, alpha: .8, y: .07 });
  f.yz = { t: 0, dur: absorb ? 16 : 20, tick: 0, ring, ring2, absorb: !!absorb, cdT: 0 }; ui.flash('#ffe060', .6, .5); shake(1, .6); ui.pop(P3(f, 4.4), absorb ? '📜 흡수의 용언!' : '📜 용언의 영역!', '#fff0a0', true);
}
function endYz(f) { const y = f.yz; if (!y) return; vfx.remove(y.ring); vfx.remove(y.ring2); f.yz = null; f.cd.x = absorbCd(f); for (const o of B.fighters) { if (o.ydeb) { o.ydeb = false; o.cdMul = 1; } } }
const absorbCd = f => f.form === 'reign' ? 25 : 45;
function anaChomp(f) {   // C: 용의 포식 (컷신) — 돌진 1000 → 거대 바위 소환·투척 1500 → 포효·균열 1500 → 금빛 용의 머리가 상대를 먹는다 6000 = 10000
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 1100) { toast(f, '사거리 밖'); return false; }
  setAnim(f, 'slash', .4); f.st.inv = Math.max(f.st.inv, 6); let st = 0, t0 = 0; const ph = {}; let boulder = null, head = null, lights = []; const bb = B, T = 6.4;
  act(f, T, (u, dt) => {
    const t = u * T, a = ang(f, e);
    if (st === 0) {   // ① 돌진: 금빛 잔상과 바닥 긁힘
      f.face = a; f.x = clamp(f.x + Math.cos(a) * 3000 * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * 3000 * dt, PAD, H - PAD); const p = P3(f, 1.2);
      vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .5, s0: 2, s1: 0, c0: 0xffffff, c1: ANA, a: .8, drag: 0 }); vfx.slashGround(P3(f, .1), Math.PI / 2 - a, { len: 8, color: 0xffd060, from: 1, dur: .3 });
      if (e.hp > 0 && dist(f, e) < f.r + e.r + 160) { st = 1; t0 = t; hurt(f, e, 1000, { dir: a }); f.cutV = true; ui.cinema(true); ui.title(f.def.name, '용의 포식'); ui.flash('#ffffff', .6, .4); shake(1.6, .5); B.hitstop = Math.max(B.hitstop, .1); e.st.stun = Math.max(e.st.stun, 4.5); vfx.ring(P3(e), { r0: 1, r1: 12, dur: .5, color: ANA }); vfx.burst('smoke', P3(e, .4), 24, { speed: 5, speed2: 12, life: .9, size: 2.4, c0: 0x8a6a30, flat: true }); }
      else if (t > .9) st = 9;
    } else if (st === 1) {
      const k = t - t0; f.face = ang(f, e);
      // ② 지팡이를 들자 거대한 바위가 소환되어 던져진다
      if (k > .3 && !ph.rock) { ph.rock = true; setAnim(f, 'cast', 1); f.pose = 'raise'; boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: ROCK, roughness: 1, flatShading: true, emissive: 0x402008, emissiveIntensity: .6 })); boulder.scale.setScalar(.01); addExtra(boulder); vfx.ring(P3(f), { r0: .5, r1: 9, dur: .8, color: ANA }); }
      if (boulder && !ph.thrown) { const g = Math.min(1, (k - .3) / .9), p = P3(f, 9 + g * 1.5); boulder.position.copy(p); boulder.scale.setScalar(Math.max(.01, 3.6 * ease.out(g))); boulder.rotation.x += dt * 3; if (Math.random() < .8) vfx.emit('glow', { x: p.x + rnd(-3, 3), y: p.y + rnd(-3, 3), z: p.z + rnd(-3, 3), life: .5, s0: 1, s1: 0, c0: 0xffe0a0, c1: ANA, a: .7, drag: 0 }); }
      if (k > 1.25 && !ph.thrown) { ph.thrown = true; f.pose = null; setAnim(f, 'slash', .4); const p0 = boulder.position.clone(), q = P3(e, 1.2); const bo = boulder; addFxm(new THREE.Group(), .38, uu => { bo.position.lerpVectors(p0, q, uu); bo.rotation.x += .3; if (uu > .97 && !ph.hit) { ph.hit = true; hurt(f, e, 1500, { dir: f.face }); shake(2, .6); B.hitstop = Math.max(B.hitstop, .12); vfx.burst('spark', q, 50, { speed: 8, speed2: 22, life: .8, size: .8, c0: 0xffe0a0, c1: ROCK, grav: 7, up: 4 }); vfx.ring(P3(e), { r0: 1, r1: 14, dur: .5, color: 0xc89040 }); vfx.decal(P3(e), { tex: 'slash', r: 3, color: 0x3a2410, alpha: .8, dur: 4, y: .06 }); rmExtra(bo); boulder = null; } }); }
      // ③ 포효: 충격파 3겹 + 땅이 갈라지고 하늘에서 금빛 빛줄기
      if (k > 1.9 && !ph.roar) { ph.roar = true; setAnim(f, 'roar', 1); for (let i = 0; i < 3; i++) vfx.ring(P3(f), { r0: 1, r1: 22 + i * 12, dur: .7 + i * .25, color: i === 1 ? 0xffffff : ANA }); ui.flash('#ffe060', .8, .6); shake(2.6, 1.1);
        for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < 800 + o.r) hurt(f, o, 1500, { dir: ang(f, o) });
        for (let i = 0; i < 4; i++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(.5, 1.6, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); const aa = i / 4 * 6.283; col.position.copy(P3(e, 20)).add(new THREE.Vector3(Math.cos(aa) * 7, 0, Math.sin(aa) * 7)); col.rotation.z = Math.cos(aa) * .25; col.rotation.x = Math.sin(aa) * .25; addExtra(col); lights.push(col); } }
      lights.forEach(c => { c.material.opacity = Math.min(.7, Math.max(0, (k - 1.9) / .5)) * (k > 4.1 ? Math.max(0, 1 - (k - 4.1) / .5) : 1); c.position.x += (P3(e).x - c.position.x) * dt * 1.2; c.position.z += (P3(e).z - c.position.z) * dt * 1.2; });
      // ④ 금빛 반투명 용의 머리가 입을 벌린 채 내려와 상대를 삼킨다
      if (k > 2.6 && !head) { head = anaHead(); head.scale.setScalar(.01); head.position.copy(P3(e, 26)); addExtra(head); ui.pop(P3(e, 6), '🐲', '#ffe9a0', true); }
      if (head) { const kk = k - 2.6, dn = ease.io(Math.min(1, Math.max(0, kk / 1.3))), open = kk < 1.3 ? 1.1 - dn * .25 : (kk < 1.55 ? .85 + (kk - 1.3) / .25 * .7 : 1.55 - Math.min(1, (kk - 1.55) / .8) * .8);   // 위를 향해 입을 벌리며 내려오다 쾅 하고 문다
        head.scale.setScalar(Math.max(.01, 5 * ease.out(Math.min(1, kk / .6)) * (kk > 2.9 ? Math.max(.01, 1 - (kk - 2.9) / .5) : 1))); head.position.set(P3(e).x - Math.cos(f.face) * 3 * (1 - dn), lerp(26, 3, dn), P3(e).z - Math.sin(f.face) * 3 * (1 - dn)); head.rotation.set(open, -f.face + Math.PI / 2, 0);
        if (kk > .2 && kk < 1.3 && Math.random() < .9) { const p = head.position; vfx.emit('glow', { x: p.x + rnd(-3, 3), y: p.y + rnd(-2, 2), z: p.z + rnd(-3, 3), vy: -6, life: .5, s0: 1.4, s1: 0, c0: 0xffffff, c1: 0xffc020, a: .8, drag: 0 }); }
        if (kk > 1.5 && !ph.bite) { ph.bite = true; e.hidden = true; e.st.inv = 0; hurt(f, e, 6000, { dir: 0 }); vfx.burst('glow', P3(e, 1.2), 110, { speed: 9, speed2: 30, life: 1, size: 1.6, c0: 0xffffff, c1: ANA }); vfx.column(P3(e), { r: 7, h: 44, dur: .8, color: 0xffc020, alpha: .85 }); vfx.ring(P3(e), { r0: 1, r1: 20, dur: .7, color: 0xffffff }); ui.flash('#ffd040', .9, .8); shake(3, .9); B.hitstop = Math.max(B.hitstop, .2); ui.pop(P3(e, 5), '🐲 먹어버렸다!', '#ffe9a0', true); }
        if (ph.bite && kk > 2.3) e.hidden = false; }
      if (t - t0 > 5.3) st = 9;
    }
  }, () => { f.cutV = false; f.pose = null; f.st.inv = 0; e.hidden = false; if (boulder) rmExtra(boulder); if (head) rmExtra(head); lights.forEach(c => rmExtra(c)); if (B === bb) { ui.cinema(false); ui.title('', ''); } });
}
function startReign(f) {   // V: 맵이 갈라지며 이쪽 땅이 솟아오르고, 아래 땅에서 가시들이 솟는다. 군림 상태(HP 999999 일시적, 용언 버프·흡수의 용언은 계속 유지)
  if (f.cutV || f.reignT > 0) return false; setAnim(f, 'roar', 4.4); f.cutV = true; f.st.inv = Math.max(f.st.inv, 4.6); f.pose = 'raise';
  ui.cinema(true); ui.title(f.def.name, '군림'); ui.flash('#c89040', .6, .5); const side = f.x < W / 2 ? -1 : 1, bb = B;
  const cracks = []; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + rnd(-.1, .1), len = rnd(25, 60), m = new THREE.Mesh(new THREE.BoxGeometry(len, .1, .5 + Math.random()), new THREE.MeshBasicMaterial({ color: 0xff7a20 })); const c = P3({ x: W / 2, y: H / 2, realm: 0 }); m.position.set(c.x + Math.cos(a) * len / 2, .15, c.z + Math.sin(a) * len / 2); m.rotation.y = -a; m.scale.x = .01; addExtra(m); cracks.push(m); }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W * S / 2, 16, H * S), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1, flatShading: true })); slab.position.set(side * W * S / 4, -16, 0); addExtra(slab);
  f.reignPrev = { hp: f.hp, max: f.max }; let rose = false, spawned = false;
  act(f, 4.4, (u, dt) => {
    const t = u * 4.4; cracks.forEach(m => { m.scale.x = Math.min(1, t / 1.2); }); if (t < 1.4) shake(.5 + t * .4, .2);
    if (t > 1.4) { const k = ease.out(Math.min(1, (t - 1.4) / 1.6)); slab.position.y = lerp(-16, 0, k); if (B.reign) B.reign.rise = k; shake(1.4 + k, .3); if (Math.random() < .5) vfx.burst('smoke', P3({ x: W / 2 + side * 80, y: H / 2 + rnd(-800, 800), realm: 0 }, 1), 3, { speed: 3, life: 1, size: 3, c0: 0x6a4a2a, flat: true }); }
    if (t > 3 && !rose) { rose = true; ui.flash('#ffffff', .8, .7); shake(2.4, .8); f.max = f.hp = 999999; f.reignT = 20; f.form = 'reign'; f.formT = 1e9; f.yBuff = true; ui.pop(P3(f, 12), '👑 군림!', '#fff0a0', true); }
  }, () => { f.cutV = false; f.pose = null; f.st.inv = 0; if (B === bb) { ui.cinema(false); ui.title('', ''); } });
  B.reign = { owner: f, slab, cracks, side, t: 0, spikeN: 0, dur: 20 };
}
function updAnanas(dt) {
  for (const f of B.fighters) {
    if (f.def.id !== 'ananas') continue;
    const r = f.rrain; if (r) {   // Z 바위 소나기
      r.t += dt; const tg = foe(f);
      while (r.n < r.N && r.t >= .8 + r.n * .07) {
        r.n++; const base = tg && tg !== B.ghost && tg.hp > 0 ? tg : { x: r.px, y: r.py }, cl = r.n % 2 === 0, a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * (cl ? 60 : 150), x = clamp(base.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(base.y + Math.sin(a) * d, PAD, H - PAD);
        const sz = rnd(.9, 1.7), m = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), new THREE.MeshStandardMaterial({ color: ROCK, roughness: 1, flatShading: true })); m.position.copy(W3(x, y, 34)); addExtra(m);
        (B.rocks = B.rocks || []).push({ m, x, y, t: 0, fall: .65, r: 95, dmg: 12000 / r.N, owner: f, realm: realmOf(f), sz });
      }
      if (r.n >= r.N) f.rrain = null;
    }
    const y = f.yz; if (y) {   // X 용언의 영역
      y.t += dt; y.tick -= dt; y.cdT += dt; const c = P3(f);
      for (let i = 0; i < 4; i++) vfx.emit('glow', { x: c.x + rnd(-45, 45), y: rnd(1, 18), z: c.z + rnd(-30, 30), vy: rnd(.5, 3), life: 1.2, s0: .8, s1: 0, c0: 0xffffff, c1: YZC, a: .6, drag: 0 });
      const drain = (y.absorb ? 900 : 600), enemies = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f));
      for (const o of enemies) { o.dim = 1; o.dimN = Math.max(o.dimN || 0, 2); o.ydeb = true; o.hp = Math.max(1, o.hp - drain * dt * .5 / Math.max(1, enemies.length) * enemies.length); if (y.absorb) mHeal(f, drain * dt * .5, true); if (y.cdT >= 3.5) o.cdMul = Math.max(.3, (o.cdMul || 1) - .18); }
      if (y.cdT >= 3.5) { y.cdT = 0; for (const o of enemies) ui.pop(P3(o, 3.8), '⏳ 쿨타임 증가', '#ffe9a0'); }
      if (y.tick <= 0) { y.tick = 1; if (f.hp > 0) mHeal(f, 1000); for (const o of enemies) ui.pop(P3(o, 3 + rnd(0, 1)), '-' + Math.round(drain * .5), '#ffd84a'); }
      if (y.t >= y.dur || f.hp <= 0) endYz(f);
    }
    if (f.yBuff && f.hp > 0 && !f.yz) { f.ybT = (f.ybT || 0) - dt; if (f.ybT <= 0) { f.ybT = 1; mHeal(f, 400, true); } }   // 군림 후: 용언의 영역 버프(피해 증가·초당 회복)가 계속 유지된다
    if (f.reignT > 0) { f.reignT -= dt; if (f.reignT <= 0) { f.reignT = 0; const pv = f.reignPrev || { hp: 1, max: f.def.hp }; f.max = f.def.hp; f.hp = Math.max(1, Math.min(f.max, pv.hp)); f.air = 0; ui.pop(P3(f, 4), '군림 종료 (버프는 유지)', '#ffe9a0', true); } }
  }
  if (B.rocks && B.rocks.length) {
    for (const s of B.rocks) {
      s.t += dt; const u = Math.min(1, s.t / s.fall); s.m.position.copy(W3(s.x, s.y, lerp(34, .6, u * u))); s.m.rotation.x += dt * 5;
      if (s.t >= s.fall && !s.done) { s.done = true; rmExtra(s.m); const p = W3(s.x, s.y, .3); vfx.burst('spark', p, 6, { speed: 3, speed2: 8, life: .45, size: .6, c0: 0xffe0a0, c1: ROCK, up: 2, grav: 6 }); vfx.ring(p, { r0: .3, r1: 3.4, dur: .35, color: 0xc89040 });
        const f = s.owner; for (const t of B.fighters) if (t !== f && t.hp > 0 && !ally(f, t) && realmOf(t) === s.realm && Math.hypot(t.x - s.x, t.y - s.y) < s.r + t.r) { hurt(f, t, s.dmg, { quiet: true, field: true }); t.rAcc = (t.rAcc || 0) + s.dmg * dmgMul(f); if (t.rAcc >= 1000) { ui.pop(P3(t, 2.8 + rnd(0, 1)), Math.round(t.rAcc), '#ffe0a0', true); t.rAcc = 0; hitFX(t, ANA, false); } } }
    }
    B.rocks = B.rocks.filter(s => !s.done);
  }
  const R = B.reign; if (R) {   // 군림: 올라온 땅 아래(반대편)에서 가시가 마구 솟는다 (40개 × 250)
    const f = R.owner; R.t += dt; R.sp = (R.sp || 0) - dt; for (const o of B.fighters) o.platY = (R.side < 0 ? o.x < W / 2 : o.x >= W / 2) ? 8 * (R.rise || 0) : 0;   // 올라온 쪽 땅 위의 캐릭터는 같이 올라간다
    if (R.t > 3 && R.sp <= 0 && R.spikeN < 40 && f.hp > 0) { R.sp = .28; R.spikeN++; const tg = foe(f), lowSide = -R.side, near = tg && tg !== B.ghost && tg.hp > 0 && Math.random() < .6; const x = near ? clamp(tg.x + rnd(-110, 110), PAD, W - PAD) : clamp(W / 2 + lowSide * rnd(100, W / 2 - 100), PAD, W - PAD), y = near ? clamp(tg.y + rnd(-110, 110), PAD, H - PAD) : rnd(PAD, H - PAD); spikeFx(x, y, 70, 5, .8);
      setTimeout(() => {}, 0); for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - x, t.y - y) < 100 + t.r) { hurt(f, t, 250, { quiet: true, field: true }); ui.pop(P3(t, 3.2 + rnd(0, 1)), '250', '#ffe0a0'); } }
    if (R.t >= 3 + R.dur || f.hp <= 0) { rmExtra(R.slab); R.cracks.forEach(m => rmExtra(m)); B.reign = null; for (const o of B.fighters) o.platY = 0; vfx.burst('smoke', P3({ x: W / 2, y: H / 2, realm: 0 }, 1), 40, { speed: 10, speed2: 24, life: 1.4, size: 4, c0: 0x6a4a2a, flat: true }); shake(1.6, .6); }
  }
}
CHARS.ananas = {
  id: 'ananas', name: '파인드래곤 쿠키', color: ANA, fx: 0xffe0a0, cost: 2200, hp: 32000, kin: true, pref: 4.2, atkRange: 520, aiPref: 340, tag: '바위 · 가시 · 용언의 영역 · 용의 포식 · 군림',
  skills: {
    base: {
      a: { name: '바위 던지기', cd: .9, desc: '마법 지팡이로 바위를 소환해 던진다 450 + 슬로우(2초, 중첩 불가). 4번째 공격은 땅에서 가시가 솟아오른다', use(f) {
        setAnim(f, 'cast', .3); f.anaN = (f.anaN || 0) + 1; const a = f.face, e = foe(f);
        shoot(f, { a, sp: 780, r: 30, dmg: 450, color: ROCK, kind: 'rock', life: 1, onHit: t => { if (!(t.st.slow > 0)) { slowOn(t, 2, .6); ui.pop(P3(t, 3.2), '🐌 슬로우', '#ffe0a0'); } } });
        if (f.anaN % 4 === 0 && e && e !== B.ghost) { const x = e.x, y = e.y; setTimeout(() => {}, 0); runScript(f, [{ at: .3, fn: () => { spikeFx(x, y, 150, 9, 1); shake(.5, .3); for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && Math.hypot(t.x - x, t.y - y) < 150 + t.r) hurt(f, t, 450, { dir: ang(f, t) }); } }], .5); }
      } },
      z: { name: '바위 소나기', cd: 24, desc: '하늘에서 바위를 마구 떨군다 (총 12000)', use(f) { startRockRain(f); } },
      x: { name: '용언의 영역', cd: 45, desc: '노란 용언이 맵 전체를 감싼다 (20초). 안에서 나는 피해 증가·초당 회복, 적은 시야가 좁아지고 생명력이 빨려들어가며 쿨타임이 점점 늘어난다', use(f) { return startYz(f, false); } },
      c: { name: '용의 포식', cd: 40, desc: '[컷신] 돌진해 돌을 던지고 포효하면 금빛 용의 머리가 나타나 상대를 먹어버린다. 총 10000', use(f) { return anaChomp(f); } },
      v: { name: '군림', cd: 90, desc: '[컷신] 맵이 갈라지며 이쪽 땅이 솟아오르고 아래 땅에서 가시가 솟는다. 일시적으로 HP 999999. 이후 용언의 영역 버프가 계속 유지되고 X 는 흡수의 용언으로 바뀐다', use(f) { return startReign(f); } },
    }
  }
};
CHARS.ananas.skills.reign = Object.assign({}, CHARS.ananas.skills.base, { x: { name: '흡수의 용언', cd: 25, desc: '용언으로 상대의 생명력을 흡수한다 (기존의 1.5배). 군림 상태에서 쓸 수 있다', use(f) { return startYz(f, true); } } });
/* ===== 각성 용과드래곤 쿠키 (id 'pitayaA') + 용과드래곤 변신('pdragon') ===== */
function pHead(op = .5, scale = 1) {   // 용과드래곤 머리 형체 (반투명, 붉은 빛)
  const h = buildPitayaHead(), w = new THREE.Group(); if (!h) { w.add(buildLichFace()); return w; }
  h.scale.setScalar(5.5 / Math.max(.05, h.userData.size) * scale);
  h.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = op; o.material.depthWrite = false; o.material.emissive = new THREE.Color(0xff1030); o.material.emissiveIntensity = .35; } });
  w.add(h); return w;
}
function pBuff(o, dur = 20) { o.yBuffT = Math.max(o.yBuffT || 0, dur); }   // 용언의 버프: 피해 ×1.3 + 초당 회복
function startChains(f) {   // Z: 속박의 용언 — 붉은 쇠사슬이 적 수만큼 생겨 적을 감아 속박 (총 5700), 아군/나는 용의 비늘(10초)
  setAnim(f, 'roar', 1.2); f.pose = 'raise'; runScript(f, [], 1.2, () => { f.pose = null; }); ui.flash('#ff2040', .5, .5); shake(1.4, .8); vfx.ring(P3(f), { r0: 1, r1: 24, dur: 1, color: PTY }); vfx.ring(P3(f), { r0: 1, r1: 14, dur: .8, color: 0xffffff }); ui.pop(P3(f, 4.4), '⛓ 속박의 용언!', '#ffc0c8', true);
  for (const o of hbAllies(f)) { o.dscale = Math.max(o.dscale || 0, 10); ui.pop(P3(o, 3.6), '🐲 용의 비늘', '#ffc0c8'); vfx.column(P3(o), { r: 1.5, h: 12, dur: .8, color: PTY, alpha: .5 }); }
  const es = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f)); B.pchains = B.pchains || [];
  for (const e of es) { const ms = []; for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1.5, .2, 8, 20), new THREE.MeshStandardMaterial({ color: 0xc01020, emissive: 0xff1030, emissiveIntensity: .8, metalness: .7, roughness: .3 })); m.scale.setScalar(5); m.rotation.set(rnd(0, 1), rnd(0, 6), rnd(0, 1)); addExtra(m); ms.push(m); } B.pchains.push({ owner: f, t: e, ms, age: 0, dur: 4, n: 0 }); }
}
function pitaAdash(f) {   // 평타: 드래곤 대쉬 (용의 형상으로 돌진 700, 쓰고 나면 방어력 일시 증가)
  const a = f.face, hit = new Set(); let mv = 0; const L = 640, sp = 2100, d = dkaDragon(true); d.scale.setScalar(1.8); addExtra(d); setAnim(f, 'slash', .3);
  act(f, L / sp + .35, (u, dt) => {
    const st = Math.min(L - mv, sp * dt); mv += st; f.x = clamp(f.x + Math.cos(a) * st, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * st, PAD, H - PAD); const p = P3(f, 1.4); d.position.copy(p); d.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .4, s0: 1.8, s1: 0, c0: 0xffc0c8, c1: PTY, a: .7, drag: 0 });
    for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f) && !hit.has(t) && dist(f, t) < f.r + t.r + 110) { hit.add(t); hurt(f, t, 700, { dir: a }); shake(.7, .25); vfx.burst('spark', P3(t, 1), 18, { speed: 6, speed2: 14, life: .5, size: .6, c0: 0xffffff, c1: PTY }); }
  }, () => { rmExtra(d); f.defUp = 4; ui.pop(P3(f, 3.6), '🛡 방어력 증가', '#ffc0c8'); });
}
function startRedShield(f) {   // X: 붉은 용의 보호막 — 하늘에 용과드래곤 머리 형체, 아군에게 용언 버프 + 보호막 5000
  setAnim(f, 'cast', .9); const hd = pHead(.5, 2.6); addExtra(hd); const bb = B;
  let t = 0; addFxm(hd, 3.2, (u, m) => { m.position.copy(P3(f, 17)); m.position.y = 17 + Math.sin(u * 8) * .6; m.scale.setScalar(Math.max(.01, 1 * ease.out(Math.min(1, u * 4)) * (u > .85 ? (1 - u) / .15 : 1))); m.lookAt(P3(f, 4).setY(1)); });
  vfx.column(P3(f), { r: 3, h: 40, dur: 1.2, color: PTY, alpha: .55 }); ui.flash('#ff2040', .5, .5); shake(1, .6); ui.pop(P3(f, 5), '🐲 붉은 용의 보호막!', '#ffc0c8', true);
  for (const o of hbAllies(f)) { pBuff(o, 20); o.shield = (o.shield || 0) + 5000; o.shieldMax = Math.max(o.shieldMax || 0, o.shield); vfx.ring(P3(o), { r0: .5, r1: 8, dur: .8, color: PTY }); vfx.burst('glow', P3(o, 1.4), 24, { speed: 3, speed2: 10, life: .9, size: .9, c0: 0xffffff, c1: PTY, up: 3 }); ui.pop(P3(o, 4), '🛡 +5000 · 용언', '#ffc0c8', true); }
}
function startMeteors(f) {   // C: 멸망의 메테오 브레스 (총 7800 = 60 × 130)
  const e = foe(f); setAnim(f, 'cast', 1); const hd = pHead(.5, 3); addExtra(hd);
  addFxm(hd, 5.4, (u, m) => { m.position.copy(P3(f, 22)); m.scale.setScalar(Math.max(.01, 1 * ease.out(Math.min(1, u * 6)) * (u > .9 ? (1 - u) / .1 : 1))); const ee = foe(f); m.lookAt(ee && ee !== B.ghost ? P3(ee, 0) : P3(f, 0)); if (Math.random() < .6) { const p = m.position; vfx.emit('glow', { x: p.x, y: p.y - 2, z: p.z, vx: rnd(-6, 6), vy: -rnd(10, 22), vz: rnd(-6, 6), life: .7, s0: 1.8, s1: 0, c0: 0xffd0a0, c1: PTY, a: .8, drag: 0 }); } });
  f.mrain = { t: 0, n: 0, N: 60, px: e && e !== B.ghost ? e.x : f.x + Math.cos(f.face) * 500, py: e && e !== B.ghost ? e.y : f.y + Math.sin(f.face) * 500 };
  ui.flash('#ff4020', .6, .6); shake(1.2, .8); ui.title(f.def.name, '멸망의 메테오 브레스'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 1800); ui.pop(P3(f, 5), '☄ 멸망의 메테오 브레스!', '#ffd0b0', true);
}
function startPDragon(f) {   // V: 변신 — 용과드래곤 (HP 80000, 받는 피해 50% 감소)
  if (f.cutV) return false; setAnim(f, 'roar', 2.8); f.cutV = true; f.st.inv = Math.max(f.st.inv, 3); f.pose = 'float'; ui.cinema(true); ui.title(f.def.name, '용과드래곤 변신'); ui.flash('#ff2040', .6, .5); const bb = B;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); col.position.copy(P3(f, 30)); addExtra(col);
  act(f, 2.8, (u, dt) => { const t = u * 2.8; col.material.opacity = Math.min(.8, t / .8) * (t > 2.2 ? Math.max(0, 1 - (t - 2.2) / .6) : 1); col.position.copy(P3(f, 30)); col.rotation.y += dt * 3; f.air = 3 * Math.sin(Math.min(1, t / 1.6) * Math.PI / 2); if (Math.random() < .6) vfx.emit('glow', { x: P3(f).x + rnd(-6, 6), y: rnd(0, 18), z: P3(f).z + rnd(-6, 6), vy: 8, life: .8, s0: 1, s1: 0, c0: 0xffffff, c1: PTY, a: .7, drag: 0 });
    if (t > 1.5 && !f.pdPending) { f.pdPending = true; f.pBase = { hp: f.hp, max: f.max, shield: f.shield, shieldMax: f.shieldMax }; f.form = 'pdragon'; f.formT = 1e9; f.max = f.hp = 80000; f.shield = f.shieldMax = 0; f.r = 64; for (const k in f.cd) f.cd[k] = 0; ui.flash('#ffffff', .8, .6); shake(2.4, .9); vfx.ring(P3(f), { r0: 1, r1: 28, dur: 1, color: PTY }); vfx.burst('glow', P3(f, 2), 120, { speed: 8, speed2: 28, life: 1.2, size: 1.6, c0: 0xffffff, c1: PTY, up: 4 }); ui.pop(P3(f, 8), '🐲 용과드래곤!', '#ffc0c8', true); } },
    () => { f.cutV = false; f.pose = null; f.air = 0; f.st.inv = 0; f.pdPending = false; rmExtra(col); if (B === bb) { ui.cinema(false); ui.title('', ''); } });
}
function endPDragon(f, voluntary) {
  if (f.form !== 'pdragon') return; const b = f.pBase || { hp: f.def.hp, max: f.def.hp }; f.form = 'base'; f.formT = 0; f.max = b.max; f.hp = Math.max(1, b.hp); f.shield = b.shield || 0; f.shieldMax = b.shieldMax || 0; f.r = 22; f.air = 0; f.outside = false; f.rooted = false; f.pdb = null; f.fly = null; f.fz && endFZ(f);
  for (const k in f.cd) f.cd[k] = 0; f.cd.v = 5; f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD); ui.flash('#ffc0c8', .5, .5); vfx.burst('glow', P3(f, 3), 60, { speed: 5, speed2: 18, life: 1, size: 1.4, c0: 0xffffff, c1: PTY }); ui.pop(P3(f, 4), voluntary ? '변신 해제' : '💥 용과드래곤 쓰러짐!', '#ffc0c8', true);
}
function startPdBreath(f) {   // 변신 평타: 브레스 (꾹 누르면 오래, 그만큼 쿨타임 증가)
  if (f.pdb) return false; setAnim(f, 'breath', 6); const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); addExtra(cone);
  f.pdb = { t: 0, tick: 0, cone }; f.rooted = true; return 'nocd';
}
function endPdBreath(f) { const b = f.pdb; if (!b) return; rmExtra(b.cone); f.cd.a = .8 + b.t * .7; f.pdb = null; f.rooted = false; }
function pdStomp(f) {   // 변신 Z: 날아가 상대를 찍고 → 꼬리로 밀치고 → 브레스 (총 10000 = 3500 + 2500 + 4000)
  const e = foe(f); if (!e || e === B.ghost || e.hp <= 0 || dist(f, e) > 1100) { toast(f, '사거리 밖'); return false; }
  setAnim(f, 'cast', .4); f.st.inv = Math.max(f.st.inv, 3.6); let st = 0, t0 = 0, tail = false, br = false; const sx = f.x, sy = f.y, T = 3.8;
  act(f, T, (u, dt) => {
    const t = u * T, a = ang(f, e);
    if (st === 0) { const k = Math.min(1, t / .9); f.air = 16 * Math.sin(k * Math.PI * .5); f.x = lerp(sx, e.x - Math.cos(a) * 140, ease.io(k)); f.y = lerp(sy, e.y - Math.sin(a) * 140, ease.io(k)); f.face = a; if (k >= 1) { st = 1; t0 = t; } }
    else if (st === 1) { const k = Math.min(1, (t - t0) / .28); f.air = 16 * (1 - k * k); if (k >= 1) { st = 2; t0 = t; f.air = 0; const p = P3(f); vfx.ring(p, { r0: 1, r1: 22, dur: .7, color: PTY }); vfx.burst('smoke', p, 30, { speed: 6, speed2: 16, life: 1, size: 3, c0: 0x6a2020, flat: true }); shake(2.4, .6); B.hitstop = Math.max(B.hitstop, .12); for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < 380 + o.r) hurt(f, o, 3500, { dir: ang(f, o) }); } }
    else if (st === 2) {
      if (t - t0 > .6 && !tail) { tail = true; setAnim(f, 'tail', .6); const p = P3(f); vfx.slashGround(p, 0, { len: 14, color: PTY, dur: .6, from: 3 }); vfx.slashGround(p, Math.PI, { len: 14, color: 0xffffff, dur: .6, from: 3 }); shake(1.6, .5); for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < 520 + o.r) { const aa = ang(f, o); hurt(f, o, 2500, { dir: aa }); o.kb = { vx: Math.cos(aa) * 1800, vy: Math.sin(aa) * 1800, t: .5 }; } }
      if (t - t0 > 1.4 && !br) { br = true; setAnim(f, 'breath', .8); const tg = foe(f), a2 = tg && tg !== B.ghost ? ang(f, tg) : f.face; f.face = a2; const p = P3(f, 3); vfx.burst('glow', p.clone().add(new THREE.Vector3(Math.cos(a2), 0, Math.sin(a2)).multiplyScalar(6)), 120, { speed: 12, speed2: 34, life: 1, size: 1.8, c0: 0xffffff, c1: PTY }); ui.flash('#ff4020', .7, .6); shake(2.4, .8);
        for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f)) { const d = dist(f, o); if (d < 1100 && adiff(ang(f, o), a2) < .5) hurt(f, o, 4000, { dir: a2 }); } }
      if (t - t0 > 2.2) st = 3;
    }
  }, () => { f.air = 0; f.st.inv = 0; });
}
function startFZ(f) {   // 변신 X: 하늘로 올라가 브레스를 쏴 맵 전체를 불의 용언 영역으로 (아군 모든 버프, 나는 방어력 증가)
  if (f.fz) return false; setAnim(f, 'breath', 2.4); f.st.inv = Math.max(f.st.inv, 2.6); const bb = B;
  act(f, 2.6, (u, dt) => { const t = u * 2.6; f.air = 14 * Math.sin(Math.min(1, t / .9) * Math.PI / 2) * (t > 2.1 ? Math.max(0, 1 - (t - 2.1) / .5) : 1);
    if (t > .9 && t < 1.9 && Math.random() < .8) { const p = P3(f, f.air + 1), a = rnd(0, 6.283); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * 18, vy: -rnd(8, 16), vz: Math.sin(a) * 18, life: .8, s0: 2, s1: 0, c0: 0xffd0a0, c1: 0xff3010, a: .85, drag: 0 }); }
    if (t > 1.9 && !f.fzMade) { f.fzMade = true; const R = Math.max(W, H) * S * .62, p = P3({ x: W / 2, y: H / 2, realm: 0 }); f.fz = { t: 0, dur: 26, ring: vfx.decal(p, { tex: 'rune', r: R, color: 0xff3a20, alpha: .4, spin: .2, y: .06 }), ring2: vfx.decal(p, { tex: 'ring', r: R * .98, color: 0xffa040, alpha: .85, y: .07 }) }; ui.flash('#ff5020', .8, .7); shake(2, .8); vfx.ring(P3(f), { r0: 1, r1: R, dur: 1.2, color: 0xff5020 }); ui.pop(P3(f, 9), '🔥 불의 용언!', '#ffd0a0', true); } },
    () => { f.air = 0; f.fzMade = false; f.st.inv = 0; });
}
function endFZ(f) { const z = f.fz; if (!z) return; vfx.remove(z.ring); vfx.remove(z.ring2); f.fz = null; f.inFZ = false; f.cd.x = 40; }
function startPdFly(f) {   // 변신 C: 맵 밖을 날아다니며 계속 브레스
  if (f.fly) { f.fly.t = f.fly.dur; return 'nocd'; } setAnim(f, 'cast', .8); const side = f.x < W / 2 ? -1 : 1;
  f.fly = { t: 0, dur: 14, tick: 0, tx: side < 0 ? -260 : W + 260 }; f.outside = true; ui.flash('#ff5020', .4, .4); ui.pop(P3(f, 9), '🐲 맵 밖으로 날아오른다!', '#ffd0a0', true); return 'nocd';
}
function updPitayaA(dt) {
  for (const f of B.fighters) {
    if (f.defUp > 0) f.defUp -= dt;
    if (f.yBuffT > 0) { f.yBuffT -= dt; f.yhT = (f.yhT || 0) - dt; if (f.yhT <= 0 && f.hp > 0) { f.yhT = 1; mHeal(f, 1000, true); } }
    if (f.def.id !== 'pitayaA') continue;
    const b = f.pdb; if (b) {   // 변신 평타 브레스 (누르고 있는 동안 계속)
      b.t += dt; b.tick -= dt; const L = 950, half = .3, a = f.face, p = P3(f, 3 + (f.air || 0));
      b.cone.position.copy(p).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(L * S * .5)); b.cone.scale.set(Math.tan(half) * L * S, L * S, Math.tan(half) * L * S); b.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      for (let i = 0; i < 4; i++) { const d = rnd(1, L) * S, o = rnd(-half, half) * d; vfx.emit('glow', { x: p.x + Math.cos(a) * d - Math.sin(a) * o, y: 2 + rnd(-1, 1), z: p.z + Math.sin(a) * d + Math.cos(a) * o, life: .4, s0: 1.6, s1: 0, c0: 0xffd0a0, c1: 0xff2010, a: .7, drag: 0 }); }
      if (b.tick <= 0) { b.tick = .1; shake(.25, .12); for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && realmOf(t) === realmOf(f)) { const d = dist(f, t); if (d < L + t.r && adiff(ang(f, t), a) < half + Math.atan2(t.r, Math.max(d, 1))) { hurt(f, t, 100, { quiet: true, field: true, dir: a }); t.hAcc = (t.hAcc || 0) + 100 * dmgMul(f); if (t.hAcc >= 1000) { ui.pop(P3(t, 3 + rnd(0, 1)), Math.round(t.hAcc), '#ffd0a0', true); t.hAcc = 0; } } } }
      if ((!f.holdA && b.t > .5) || b.t >= 6 || f.hp <= 0 || f.st.stun > 0 || f.form !== 'pdragon') endPdBreath(f);
    }
    const z = f.fz; if (z) {   // 불의 용언 영역
      z.t += dt; f.inFZ = true; for (const o of hbAllies(f)) { pBuff(o, .5); }
      if (z.t >= z.dur || f.hp <= 0) endFZ(f);
    }
    const fl = f.fly; if (fl) {   // 맵 밖 비행: 계속 브레스
      fl.t += dt; fl.tick -= dt; f.air = 11 + Math.sin(fl.t * 2) * 1.2; f.outside = true;
      f.x = clamp(f.x + (fl.tx - f.x) * Math.min(1, dt * 1.5), -400, W + 400); f.y = clamp(f.y + Math.sin(fl.t * .9) * 260 * dt, PAD, H - PAD);
      if (fl.tick <= 0 && f.hp > 0) { fl.tick = .4; const e = foe(f); if (e && e !== B.ghost) { const a = ang(f, e); f.face = a; shoot(f, { a, sp: 1700, r: 70, dmg: 650, color: 0xff3a20, kind: 'beam', life: 1.3, pierce: true, h0: 11 }); vfx.burst('glow', P3(f, f.air).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(6)), 14, { speed: 8, speed2: 20, life: .5, size: 1.2, c0: 0xffffff, c1: 0xff3010 }); } }
      if (fl.t >= fl.dur || f.hp <= 0) { f.fly = null; f.outside = false; f.air = 0; f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD); f.cd.c = 30; ui.pop(P3(f, 4), '착지', '#ffd0a0'); }
    }
    const mr = f.mrain; if (mr) {   // 멸망의 메테오
      mr.t += dt; const tg = foe(f);
      while (mr.n < mr.N && mr.t >= .9 + mr.n * .065) {
        mr.n++; const base = tg && tg !== B.ghost && tg.hp > 0 ? tg : { x: mr.px, y: mr.py }, cl = mr.n % 2 === 0, a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * (cl ? 60 : 160), x = clamp(base.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(base.y + Math.sin(a) * d, PAD, H - PAD), aa = f.face + rnd(-.3, .3);
        const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a2a }))); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xff3010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); gl.scale.setScalar(9); g.add(gl); addExtra(g);
        (B.pmet = B.pmet || []).push({ m: g, x, y, ox: Math.cos(aa) * 420, oy: Math.sin(aa) * 420, t: 0, fall: .7, r: 105, dmg: 7800 / mr.N, owner: f, realm: realmOf(f) });
      }
      if (mr.n >= mr.N) f.mrain = null;
    }
  }
  if (B.pmet && B.pmet.length) {
    for (const s of B.pmet) {
      s.t += dt; const u = Math.min(1, s.t / s.fall); s.m.position.copy(W3(s.x - s.ox * (1 - u), s.y - s.oy * (1 - u), lerp(38, .6, u)));
      if (Math.random() < .7) { const p = s.m.position; vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .4, s0: 1.8, s1: 0, c0: 0xffd0a0, c1: 0xff2010, a: .7, drag: 0 }); }
      if (s.t >= s.fall && !s.done) { s.done = true; rmExtra(s.m); const p = W3(s.x, s.y, .3); vfx.burst('spark', p, 12, { speed: 5, speed2: 14, life: .6, size: .8, c0: 0xffffff, c1: 0xff3010, up: 3, grav: 5 }); vfx.ring(p, { r0: .3, r1: 4.2, dur: .45, color: 0xff4020 }); vfx.flash(p.clone().setY(1.5), { size: 7, color: 0xff6030, dur: .3, grow: true });
        const f = s.owner; for (const t of B.fighters) if (t !== f && t.hp > 0 && !ally(f, t) && realmOf(t) === s.realm && Math.hypot(t.x - s.x, t.y - s.y) < s.r + t.r) { hurt(f, t, s.dmg, { quiet: true, field: true }); t.mAcc = (t.mAcc || 0) + s.dmg * dmgMul(f); if (t.mAcc >= 1000) { ui.pop(P3(t, 2.8 + rnd(0, 1)), Math.round(t.mAcc), '#ffd0b0', true); t.mAcc = 0; } } }
    }
    B.pmet = B.pmet.filter(s => !s.done);
  }
  if (B.pchains && B.pchains.length) {   // 속박의 용언: 쇠사슬이 적을 감는다 (3번 × 1900 = 5700)
    for (const c of B.pchains) {
      const f = c.owner, e = c.t; c.age += dt;
      if (e.hp <= 0 || f.hp <= 0 || c.age >= c.dur) { c.ms.forEach(m => rmExtra(m)); c.done = true; continue; }
      e.st.lock = Math.max(e.st.lock, .25); const p = P3(e, 0), k = Math.min(1, c.age / .6);
      c.ms.forEach((m, i) => { m.position.set(p.x, .8 + i * .5, p.z); m.scale.setScalar(lerp(6, 1.1 + (i % 2) * .15, ease.out(k))); m.rotation.y += dt * (i % 2 ? 3 : -3); m.rotation.x = Math.PI / 2 + (i - 3) * .14; });
      const due = [.8, 1.8, 2.8][c.n]; if (due !== undefined && c.age >= due) { c.n++; hurt(f, e, 1900, { dir: ang(f, e) }); shake(.7, .3); vfx.burst('spark', P3(e, 1.2), 22, { speed: 5, speed2: 14, life: .5, size: .6, c0: 0xffffff, c1: 0xff1030 }); }
    }
    B.pchains = B.pchains.filter(c => !c.done);
  }
}
CHARS.pitayaA = {
  id: 'pitayaA', base: 'pitaya', name: '각성 용과드래곤 쿠키', kin: true, color: PTY, fx: 0xffc0c8, cost: 0, hp: 38000, pref: 4, atkRange: 360, aiPref: 260, tag: '각성 · 속박의 용언 · 붉은 용의 보호막 · 멸망의 메테오 · 용과드래곤 변신',
  skills: {
    base: {
      a: { name: '드래곤 대쉬', cd: 2.4, desc: '용의 형상으로 돌진 700. 쓰고 나면 잠시 방어력 증가', use(f) { pitaAdash(f); } },
      z: { name: '속박의 용언', cd: 30, desc: '울부짖으면 붉은 쇠사슬이 적 수만큼 생겨 적을 속박한다 (총 5700). 아군과 나는 잠시 용의 비늘', use(f) { startChains(f); } },
      x: { name: '붉은 용의 보호막', cd: 45, desc: '하늘에 용과드래곤의 머리 형체가 나타나 아군에게 용언의 버프(피해 증가·초당 회복)를 주고 보호막 5000을 준다', use(f) { startRedShield(f); } },
      c: { name: '멸망의 메테오 브레스', cd: 40, desc: '하늘의 머리 형체에서 멸망의 메테오 브레스가 쏟아진다 (총 7800)', use(f) { startMeteors(f); } },
      v: { name: '용과드래곤 변신', cd: 60, desc: '용과드래곤으로 변신한다 (HP 80000, 받는 피해 50% 감소)', use(f) { return startPDragon(f); } },
    },
    pdragon: {
      a: { name: '브레스', cd: .8, desc: '브레스를 쏜다. 꾹 누르면 오래 쏘고, 그만큼 쿨타임이 늘어난다', use(f) { return startPdBreath(f); } },
      z: { name: '날아 찍기', cd: 14, desc: '날아가 상대를 찍고, 꼬리로 밀치고, 브레스를 쏜다 (총 10000)', use(f) { return pdStomp(f); } },
      x: { name: '불의 용언', cd: 40, desc: '하늘로 올라가 브레스를 쏴 맵 전체를 불의 용언 영역으로 만든다. 아군에게 모든 버프, 영역 안에서 내 방어력 증가', use(f) { return startFZ(f); } },
      c: { name: '맵 밖 비행', cd: 30, desc: '맵 밖을 날아다니며 계속 브레스를 쏜다 (다시 누르면 착지)', use(f) { return startPdFly(f); } },
      v: { name: '변신 해제', cd: 5, desc: '변신을 해제한다', use(f) { endPDragon(f, true); } },
    }
  }
};
CHARS.pitaya.awakeId = 'pitayaA';
/* ===== 용감한 쿠키 (커먼, HP 5000, 캔디케인) ===== */
const BRV = 0xff8a5c;
CHARS.brave = {
  id: 'brave', name: '용감한 쿠키', color: BRV, fx: 0xff6a6a, cost: 0, hp: 5000, pref: 3.6, atkRange: 120, aiPref: 85, tag: '캔디케인 · 돌진 · 용기',
  skills: {
    base: {
      a: { name: '캔디케인 휘두르기', cd: .45, desc: '캔디케인으로 때린다 10', use(f) { setAnim(f, 'slash', .25); swing(f, 120 * (f.area || 1), 1.0, 10, 0xff5a6a); } },
      z: { name: '용감한 돌진', cd: 9, desc: '앞으로 돌진해 100의 피해를 주고, 잠시 빨라진다', use(f) {
        setAnim(f, 'slash', .3); const a = f.face, hit = new Set(); let mv = 0; const L = 380, sp = 1800;
        act(f, L / sp + .05, (u, dt) => {
          const st = Math.min(L - mv, sp * dt); mv += st; f.x = clamp(f.x + Math.cos(a) * st, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * st, PAD, H - PAD);
          const p = P3(f, 1); vfx.emit('glow', { x: p.x, y: p.y, z: p.z, life: .4, s0: 1.2, s1: 0, c0: 0xffffff, c1: 0xff5a6a, a: .8, drag: 0 });
          for (const t of B.fighters) if (t !== f && !ally(f, t) && t.hp > 0 && !hit.has(t) && realmOf(t) === realmOf(f) && dist(f, t) < f.r + t.r + 40) { hit.add(t); hurt(f, t, 100, { dir: a }); }
        }, () => { f.spdBoost = 1.6; f.spdBoostT = 3; ui.pop(P3(f, 3.6), '💨 빨라졌다!', '#ffd0b0'); });
      } },
      x: { name: '캔디케인 던지기', cd: 6, desc: '캔디케인을 던진다 200', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 900, r: 16, dmg: 200, color: 0xff5a6a, kind: 'axe', life: 1.2 }); } },
      c: { name: '캔디케인 내려치기', cd: 14, desc: '점프해서 캔디케인으로 내리친다 400', use(f) {
        const e = foe(f); if (!e || e === B.ghost || e.hp <= 0) { toast(f, '대상이 없습니다'); return false; }
        setAnim(f, 'cast', .3); f.pose = 'leap'; const sx = f.x, sy = f.y, d = Math.min(dist(f, e), 700), a = ang(f, e), T = .8; let done = false;
        act(f, T, (u, dt) => { f.x = clamp(sx + Math.cos(a) * d * u, PAD, W - PAD); f.y = clamp(sy + Math.sin(a) * d * u, PAD, H - PAD); f.air = 8 * Math.sin(u * Math.PI);
          if (u >= .97 && !done) { done = true; f.air = 0; setAnim(f, 'slash', .3); shock(f, 170 * (f.area || 1), 0xff5a6a, 400); shake(.5, .25); vfx.burst('spark', P3(f, .6), 24, { speed: 7, speed2: 16, life: .5, size: .5, c0: 0xffffff, c1: 0xff5a6a, grav: 5 }); } }, () => { f.air = 0; f.pose = null; });
      } },
      v: { name: '용감해지다', cd: 40, desc: '용감해져서 최대 체력의 10%를 회복한다', use(f) {
        setAnim(f, 'cast', .5); const h = Math.min(f.max - f.hp, f.max * .1); if (f.noHeal > 0) { toast(f, '회복 불가 상태'); return false; } f.hp += h;
        vfx.burst('glow', P3(f, 1.2), 40, { speed: 3, speed2: 10, life: .9, size: .9, c0: 0xffffff, c1: 0x7dff9b, up: 3 }); vfx.ring(P3(f), { r0: .5, r1: 8, dur: .6, color: 0x7dff9b }); ui.pop(P3(f, 3.6), '💪 용감해졌다! +' + Math.round(f.max * .1), '#7dff9b', true);
      } },
    }
  }
};
/* ===== 미스틱플라워 쿠키 (비스트, HP 19500) ===== */
const MYS = 0xf0e6c8, LOTUS = 0xffd84a, MYS_DEB = ['slow', 'silence', 'stun', 'lock', 'cdfreeze', 'knock', 'rev'];
function mHeal(o, n, quiet) {   // 미스틱플라워의 치유: 회복 불가면 무시, 필멸의 불꽃 해제 훅(mysticHeal)
  if (o.hp <= 0 || o.noHeal > 0) return; const h = Math.min(o.max - o.hp, n); o.hp += h; o.mysticHeal = Math.max(o.mysticHeal || 0, .3);
  if (!quiet && h >= 1) ui.pop(P3(o, 3.4), '+' + Math.round(h), '#7dff9b', h >= 800);
}
function mAllies(f) { return [f, ...B.fighters.filter(o => o !== f && ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f))]; }
function voidOn(t, src, n = 1) {   // 허무 스택. 영역(찜기) 안에서 3번 쌓일 때마다 허무의 빛이 터진다
  if (t.hp <= 0 || t === src) return; t.void = (t.void || 0) + n; ui.pop(P3(t, 4.2), '허무 ×' + t.void, '#f4eed8');
  const d = src.vdom; if (d && d.t < d.dur && Math.hypot(t.x - d.x, t.y - d.y) < d.r + t.r) { d.stk += n; while (d.stk >= 3) { d.stk -= 3; voidPulse(src, d); } }
}
function voidPulse(f, d) {
  const p = P3(d); vfx.column(p, { r: d.r * S * .5, h: 40, dur: 1, color: LOTUS, alpha: .75 }); vfx.column(p, { r: d.r * S * .25, h: 46, dur: .8, color: 0xffffff, alpha: .9 });
  vfx.ring(p, { r0: 1, r1: d.r * S * 1.2, dur: .8, color: LOTUS }); vfx.flash(p.clone().setY(2), { size: d.r * S * 3, color: LOTUS, dur: .6, grow: true }); ui.flash('#ffe066', .6, .45); shake(.7, .4);
  for (const o of mAllies(f)) { mHeal(o, 1000); cleanse(o); o.burn = null; }
  for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - d.x, o.y - d.y) < d.r + o.r) {
    o.voidP = (o.voidP || 0) + 1; o.max = Math.max(1, o.max - 500); o.hp = Math.min(o.hp, o.max);
    ui.pop(P3(o, 4.6), `🕳 허무! 최대 체력 -500 · 스킬 지연 · 피해 감소 (${o.voidP})`, '#f4eed8', true);
  }
  ui.pop(P3(f, 4.4), '✨ 허무의 빛! +1000 · 디버프 해제', '#fff0a8', true);
}
function lotusFx(x, y, r, delay) {   // 노란 연꽃이 피어나며 터진다
  const R = r * S, g = new THREE.Group(), mats = [];
  for (let l = 0; l < 3; l++) for (let i = 0; i < 10; i++) {
    const m = new THREE.MeshBasicMaterial({ color: l === 2 ? 0xffffff : LOTUS, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending }); mats.push(m);
    const pv = new THREE.Group(), pt = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m); pt.scale.set(R * (.16 - l * .03), R * .05, R * (.44 - l * .1)); pt.position.set(0, R * (.1 + l * .08), R * (.42 - l * .09)); pt.rotation.x = -(.35 + l * .45); pv.add(pt); pv.rotation.y = i / 10 * 6.283 + l * .31; g.add(pv);
  }
  g.position.copy(P3({ x, y })); g.scale.setScalar(.001);
  addFxm(g, delay + 1.1, (u, m, t) => { const k = t < delay ? .001 : ease.out(Math.min(1, (t - delay) / .35)); m.scale.setScalar(k); m.rotation.y += .01; const fade = t < delay + .45 ? 1 : Math.max(0, 1 - (t - delay - .45) / .65); mats.forEach(q => q.opacity = .8 * fade); });
}
function stormMesh(R) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) { const h = R * .55, w = new THREE.Mesh(new THREE.CylinderGeometry(R * (.35 + i * .13), R * (.3 + i * .12), h, 20, 1, true), m); w.position.y = h * (i + .5); g.add(w); }
  return g;
}
function buildSteamer(R) {   // 만두 찜기 모양 연꽃
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0xc99a5b, roughness: .8, side: THREE.DoubleSide, transparent: true, opacity: .5 }), dark = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: .7 });
  const h = R * .15; for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(R, R * .97, h, 40, 1, true), wood); w.position.y = h * (i + .5); g.add(w); const b = new THREE.Mesh(new THREE.TorusGeometry(R, R * .012, 6, 56), dark); b.rotation.x = Math.PI / 2; b.position.y = h * (i + 1); g.add(b); }
  const pm = new THREE.MeshStandardMaterial({ color: LOTUS, emissive: 0xffb800, emissiveIntensity: .8, roughness: .5 }), pets = [];
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, pv = new THREE.Group(), pt = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pm); pt.scale.set(R * .09, R * .22, R * .03); pt.position.set(0, R * .2, 0); pt.rotation.x = -.35; pv.add(pt); pv.position.set(Math.cos(a) * R, h * 3, Math.sin(a) * R); pv.rotation.y = -a + Math.PI / 2; g.add(pv); pets.push(pv); }
  g.userData.pets = pets; return g;
}
function mysAura(f) {   // 따라다니는 면역 영역
  const A = 380, p = P3(f); if (!f.aura) f.aura = { ring: vfx.decal(p, { tex: 'ring', r: A * S, color: LOTUS, alpha: .55, y: .06 }), rune: vfx.decal(p, { tex: 'rune', r: A * S * .9, color: 0xfff2a0, alpha: .26, spin: .4, y: .05 }) };
  for (const it of [f.aura.ring, f.aura.rune]) it.obj.position.set(p.x, it.obj.position.y, p.z);
  for (const o of mAllies(f)) if (o !== f && Math.hypot(o.x - f.x, o.y - f.y) < A + o.r) { for (const k of MYS_DEB) o.st[k] = 0; o.burn = null; o.dim = 0; o.dimN = 0; o.mysticHeal = Math.max(o.mysticHeal || 0, .15); }
}
function mysAuraOff(f) { if (f.aura) { vfx.remove(f.aura.ring); vfx.remove(f.aura.rune); f.aura = null; } }
function cocoonBreak(f) {
  const c = f.cocoon; if (!c) return; f.cocoon = null; f.root.remove(c.mesh);
  const p = P3(f, 1); vfx.burst('spark', p, 60, { speed: 6, speed2: 16, life: .8, size: .6, c0: 0xffffff, c1: 0xffe066, grav: 4 }); vfx.ring(P3(f), { r0: .5, r1: 9, dur: .7, color: LOTUS }); shake(.6, .4);
  const by = c.by; if (!by) for (const o of mAllies(f)) mHeal(o, 2000);
  B.fighters.forEach(m => { if (m.legion && m.legionOf === (by || f) && m.def.id === 'mob_spider' && m.hp > 0) m.hp = 0; });
  const a = f.face, m = addMinion('mob_spider', clamp(f.x + Math.cos(a) * 200, PAD, W - PAD), clamp(f.y + Math.sin(a) * 200, PAD, H - PAD), { hp: 7000, pm: f.pm || 1, realm: f.realm, big: 1.7 });
  m.team = (by || f).team; m.legion = true; m.legionOf = by || f; m.face = a; ui.pop(P3(f, 4.4), '🕷 고치 파괴! 거대 거미 출현', '#f4eed8', true);
}
function buildCocoon() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xf1f0f6, roughness: .9, emissive: 0x6a6a80, emissiveIntensity: .25 }), web = new THREE.MeshBasicMaterial({ color: 0xb8b8c8 });
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m); b.scale.set(.95, 1.5, .95); b.position.y = 1.5; g.add(b);
  for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(.95 * Math.sqrt(1 - ((i - 2) * .32) ** 2), .03, 5, 24), web); t.rotation.x = Math.PI / 2; t.position.y = 1.5 + (i - 2) * .5; g.add(t); }
  g.position.set(0, 0, 1.9); return g;
}
function buildSpider() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x3b2a4d, roughness: .6, emissive: 0x1a0f26, emissiveIntensity: .5, flatShading: true }), red = new THREE.MeshBasicMaterial({ color: 0xff4060 });
  const ab = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m); ab.scale.set(1.1, .95, 1.5); ab.position.set(0, 1.5, -.9); g.add(ab);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 10), m); hd.position.set(0, 1.3, .9); g.add(hd);
  for (let i = 0; i < 4; i++) { const e = new THREE.Mesh(new THREE.SphereGeometry(.1, 6, 6), red); e.position.set((i % 2 ? .22 : -.22) * (i > 1 ? 1.6 : 1), 1.5 + (i > 1 ? .12 : 0), 1.5); g.add(e); }
  const legs = [];
  for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
    const pv = new THREE.Group(); pv.position.set(0, 1.3, .6 - i * .5); pv.rotation.y = s > 0 ? -(i - 1.5) * .35 : Math.PI + (i - 1.5) * .35;
    const u = new THREE.Mesh(new THREE.CylinderGeometry(.09, .07, 1.7, 6), m); u.rotation.z = Math.PI / 2 - .8; u.position.set(.7, .55, 0);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(.07, .03, 1.9, 6), m); l.rotation.z = .25; l.position.set(1.65, -.25, 0);
    pv.add(u, l); g.add(pv); legs.push(pv);
  }
  g.userData.legs = legs; return g;
}
CHARS.mob_spider = mobDef('mob_spider', '거대 거미', 0x3b2a4d, 7000, '미스틱플라워의 소환수 · 근접', {
  a: { name: '독니 물기', cd: 1, desc: '근접 300', use(f) { setAnim(f, 'slash', .25); swing(f, 170, 1.1, 300, 0xd08cff); } },
}, { range: 170, pref: 100 });
CHARS.mob_spider.spider = true;
function startSteamer(f) {   // V: 연꽃 영역(만두찜기)
  if (f.vdom) { toast(f, '이미 연꽃 영역이 전개되어 있습니다'); return false; }
  if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  setAnim(f, 'cast', .7);
  const d = f.vdom = { x: f.x, y: f.y, r: 430, t: 0, dur: 30, stk: 0, tick: .5, trap: new Set() }, p = P3(d), R = d.r * S;
  for (const o of B.fighters) if (o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - d.x, o.y - d.y) < d.r + o.r) d.trap.add(o);
  d.g = buildSteamer(R); d.g.position.copy(p); addExtra(d.g);
  d.rune = vfx.decal(p, { tex: 'rune', r: R, color: LOTUS, alpha: .3, spin: .2 }); d.ring = vfx.decal(p, { tex: 'ring', r: R, color: 0xffffff, alpha: .9, y: .07 });
  vfx.ring(p, { r0: 1, r1: R * 1.2, dur: .9, color: LOTUS }); vfx.column(p, { r: R * .5, h: 30, dur: .9, color: LOTUS, alpha: .6 }); ui.flash('#ffe066', .6, .45); shake(.7, .4);
  ui.pop(P3(f, 4.4), d.trap.size ? '🥟 연꽃 영역! 적이 갇혔다' : '🥟 연꽃 영역!', '#fff0a8', true);
  toast(f, '연꽃 영역 30초: 적 초당 200 피해 / 아군 초당 200×적 수 회복 / 허무 3스택마다 허무의 빛');
}
function endSteamer(f, quiet) {
  const d = f.vdom; if (!d) return; f.vdom = null; world.scene.remove(d.g); B.extra = B.extra.filter(m => m !== d.g); vfx.remove(d.rune); vfx.remove(d.ring);
  if (!quiet && B) { vfx.ring(P3(d), { r0: 1, r1: d.r * S * .7, dur: .7, color: LOTUS }); ui.pop(P3(f, 4.2), '연꽃 영역 종료', '#fff0a8'); }
}
function buildPet() {   // 패시브: 따라다니는 작은 연꽃 만두찜기 (스테인리스 찜기 모양)
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: .85, roughness: .22, emissive: 0x8a7a30, emissiveIntensity: .25, side: THREE.DoubleSide }), hole = new THREE.MeshBasicMaterial({ color: 0x2a2a30, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, 6.283, 0, Math.PI / 2), steel); dome.scale.set(1, .55, 1); dome.position.y = .12; g.add(dome);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.08, .07, 8, 40), steel); rim.rotation.x = Math.PI / 2; rim.position.y = .1; g.add(rim);
  for (let i = 0; i < 46; i++) { const th = i * 2.399963, ph = Math.acos(1 - (i + .5) / 46 * .92), nx = Math.sin(ph) * Math.cos(th), nz = Math.sin(ph) * Math.sin(th), ny = Math.cos(ph); const h = new THREE.Mesh(new THREE.CircleGeometry(.055, 8), hole); h.position.set(nx * 1.005, ny * .55 * 1.005 + .12, nz * 1.005); h.lookAt(h.position.clone().multiplyScalar(2)); g.add(h); }
  const pm = new THREE.MeshStandardMaterial({ color: LOTUS, emissive: 0xffb800, emissiveIntensity: .9, roughness: .5 });
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283, pv = new THREE.Group(), pt = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), pm); pt.scale.set(.2, .5, .07); pt.position.set(0, .45, 0); pt.rotation.x = -.5; pv.add(pt); pv.position.set(Math.cos(a) * 1.15, .12, Math.sin(a) * 1.15); pv.rotation.y = -a + Math.PI / 2; g.add(pv); }
  g.add(new THREE.PointLight(0xffe08a, 1.2, 8)); g.scale.setScalar(.9); return g;
}
function mysN(f) { let n = 0; for (const o of B.fighters) if (o !== f && !ally(f, o) && realmOf(o) === realmOf(f)) n += o.void || 0; return Math.max(1, Math.floor(n / 10)); }
function updPet(f, dt) {   // 아군+미스틱을 초당 50×n 회복 (n = 허무 스택 10개당 1). 미스틱이 쓰러지면 계속 따라다니며 초당 100×n, 10초마다 디버프·정신계 해제
  if (!f.pet) { const m = buildPet(); m.position.copy(P3(f, 3)); addExtra(m); f.pet = { m, x: f.x - 40, y: f.y - 40, t: 0, tick: 1, cl: 10 }; }
  const pt = f.pet, dead = f.hp <= 0, all = B.fighters.filter(o => o !== f && ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f)); if (!dead) all.unshift(f);
  let hostT = dead ? all.slice().sort((a, b) => Math.hypot(a.x - pt.x, a.y - pt.y) - Math.hypot(b.x - pt.x, b.y - pt.y))[0] : f;
  pt.t += dt; if (hostT) { const k = Math.min(1, dt * 4), ox = Math.cos(pt.t * 1.3) * 70, oy = Math.sin(pt.t * 1.3) * 70; pt.x += (hostT.x + ox - pt.x) * k; pt.y += (hostT.y + oy - pt.y) * k; }
  pt.m.position.copy(P3(pt, 3.4 + Math.sin(pt.t * 2.5) * .35)); pt.m.rotation.y += dt * 1.5; pt.m.children.forEach(c => { if (c.type === 'Group') c.children[0].rotation.x = -.5 + Math.sin(pt.t * 3) * .12; });
  if (dead && Math.random() < .5) { const p = pt.m.position; vfx.emit('glow', { x: p.x, y: p.y, z: p.z, vy: 2, life: .8, s0: .6, s1: 0, c0: 0xffffff, c1: LOTUS, a: .5, drag: 0 }); }
  pt.tick -= dt;
  if (pt.tick <= 0) { pt.tick = 1; const hv = (dead ? 100 : 50) * mysN(f); for (const o of all) { const had = o.hp; mHeal(o, hv, true); if (o.hp > had) vfx.burst('spark', P3(o, 1.5), 3, { speed: 2, life: .5, size: .35, c0: 0x7dff9b }); } }
  if (dead) { pt.cl -= dt; if (pt.cl <= 0) { pt.cl = 10; for (const o of all) { cleanse(o); o.burn = null; o.dim = 0; o.dimN = 0; if (B.mind && !ally(o, B.mind.f)) endMind(); } vfx.ring(P3(pt, .2), { r0: .6, r1: 5, dur: .7, color: LOTUS }); ui.pop(P3(pt, 4), '🪷 디버프·정신계 해제', '#fff0a8', true); } }
}
function updMystic(dt) {
  for (const f of B.fighters) {
    if (f.def.id !== 'mystic') continue;
    const sl = f.pseal > 0; if (f.pet) f.pet.m.visible = !sl; if (!sl) updPet(f, dt);   // 패시브 봉인: 찜기 펫 정지/숨김
    if (f.hp <= 0) { mysAuraOff(f); if (f.vdom) endSteamer(f); continue; }
    if (sl) mysAuraOff(f); else mysAura(f);
    const d = f.vdom; if (!d) continue;
    d.t += dt; const p = P3(d), R = d.r * S;
    if (d.t >= d.dur) { endSteamer(f); continue; }
    d.g.userData.pets.forEach((pv, i) => { pv.children[0].rotation.x = -.35 + Math.sin(d.t * 2 + i) * .12; });
    if (Math.random() < .7) { const a = rnd(0, 6.283), rr = Math.sqrt(Math.random()) * R; vfx.emit('glow', { x: p.x + Math.cos(a) * rr, y: rnd(.3, 2), z: p.z + Math.sin(a) * rr, vy: rnd(3, 8), life: 1.2, s0: .9, s1: 1.8, c0: 0xffffff, c1: LOTUS, a: .4, drag: 0 }); }
    let n = 0;
    for (const o of B.fighters) {
      if (o === f || ally(f, o) || o.hp <= 0 || realmOf(o) !== realmOf(f)) continue;
      const dd = Math.hypot(o.x - d.x, o.y - d.y), a = Math.atan2(o.y - d.y, o.x - d.x);
      if (d.trap.has(o)) { if (dd > d.r - o.r - 4) { const q = d.r - o.r - 4; o.x = d.x + Math.cos(a) * q; o.y = d.y + Math.sin(a) * q; } n++; }
      else if (dd < d.r + o.r) { const q = d.r + o.r + 4; o.x = d.x + Math.cos(a) * q; o.y = d.y + Math.sin(a) * q; }
    }
    d.tick -= dt;
    if (d.tick <= 0) {
      d.tick = .5;
      for (const o of d.trap) if (o.hp > 0) { hurt(f, o, 100, { quiet: true, field: true }); ui.pop(P3(o, 2.8), Math.round(100 * dmgMul(f) * (1 - defRed(o))), '#ffd84a'); }
      if (n > 0) { const hv = 100 * n; for (const o of mAllies(f)) mHeal(o, hv, o !== f); }
    }
  }
  const ss = B.mst || [];
  for (const s of ss) {
    s.t += dt; s.m.children.forEach((c, i) => c.rotation.y += dt * (5 + i * 1.5));
    {   // 토네이도처럼 돌아다닌다: 불규칙하게 방향을 틀면서 상대 쪽으로 어슬렁어슬렁 다가간다
      const tg = s.owner.hp > 0 ? foe(s.owner) : null; if (tg && tg !== B.ghost) { const want = Math.atan2(tg.y - s.y, tg.x - s.x), df = Math.atan2(Math.sin(want - s.ha), Math.cos(want - s.ha)); s.ha += clamp(df, -1, 1) * dt * 1.1; }
      s.ha += rnd(-1, 1) * dt * 5; let nx = s.x + Math.cos(s.ha) * s.sp * dt, ny = s.y + Math.sin(s.ha) * s.sp * dt;
      if (nx < PAD || nx > W - PAD) { s.ha = Math.PI - s.ha; nx = clamp(nx, PAD, W - PAD); } if (ny < PAD || ny > H - PAD) { s.ha = -s.ha; ny = clamp(ny, PAD, H - PAD); }
      s.x = nx; s.y = ny; s.m.position.copy(P3(s)); s.m.rotation.z = Math.sin(s.t * 3 + s.ha) * .08; s.m.rotation.x = Math.cos(s.t * 2.3 + s.ha) * .08;
    }
    const p = P3(s); if (Math.random() < .8) { const a = rnd(0, 6.283), rr = rnd(.2, 1) * s.r * S; vfx.emit('glow', { x: p.x + Math.cos(a) * rr, y: rnd(.3, 4), z: p.z + Math.sin(a) * rr, vx: -Math.sin(a) * 4, vz: Math.cos(a) * 4, vy: rnd(1, 4), life: .7, s0: .8, s1: 0, c0: 0xffffff, c1: 0xd8d0b8, a: .5, drag: 0 }); }
    s.tick -= dt;
    if (s.tick <= 0 && s.t < s.dur && s.owner.hp > 0) { s.tick = .5; for (const o of B.fighters) if (o !== s.owner && !ally(s.owner, o) && o.hp > 0 && realmOf(o) === (s.realm || 0) && Math.hypot(o.x - s.x, o.y - s.y) < s.r + o.r) { hurt(s.owner, o, 150, { quiet: true, field: true }); ui.pop(P3(o, 2.8), Math.round(150 * dmgMul(s.owner) * (1 - defRed(o))), '#f4eed8'); } }
    if (s.t >= s.dur || s.owner.hp <= 0) { world.scene.remove(s.m); B.extra = B.extra.filter(m => m !== s.m); s.dead = true; }
  }
  if (ss.length) B.mst = ss.filter(s => !s.dead);
  for (const o of B.fighters) if (o.mysticHeal > 0) o.mysticHeal = Math.max(0, o.mysticHeal - dt);
}
CHARS.mystic = {
  id: 'mystic', name: '미스틱플라워 쿠키', color: MYS, fx: LOTUS, cost: 1500, hp: 19500, pref: 4.2, atkRange: 600, aiPref: 380, tag: '허무 · 연꽃 · 밀가루 · 거미 · 만두찜기',
  passive: '정신계·디버프에 면역입니다. 주변의 원형 영역은 따라다니며, 안의 아군은 (정신계 제외) 디버프에 면역입니다.',
  skills: {
    base: {
      a: { name: '밀가루 뭉치', cd: .6, desc: '고운 밀가루 가루 뭉치를 발사한다 200. 맞으면 허무 스택 +1', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 780, r: 24, dmg: 200, color: 0xffffff, kind: 'flour', life: 1.3, onHit: t => voidOn(t, f, 1) }); } },
      z: { name: '연꽃 폭발', cd: 12, desc: '노란 연꽃이 피며 펑 터진다 2000. 범위 안의 아군과 나를 1000 회복', use(f, p) {
        setAnim(f, 'cast', .4); const q = clampRange(f, p, 650); lotusFx(q.x, q.y, 260, .7);
        zone(f, { x: q.x, y: q.y, r: 260, delay: .7, dmg: 2000, color: LOTUS, onHit: t => { if (ally(f, t)) mHeal(t, 1000); }, onSelf: t => mHeal(t, 1000) });
      } },
      x: { name: '밀가루 폭풍', cd: 20, desc: '밀가루 폭풍 5개를 일으킨다. 각각 초당 300, 10초 유지', use(f, p) {
        setAnim(f, 'cast', .5); const c = clampRange(f, p, 700); B.mst = B.mst || [];
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * 6.283 + rnd(-.3, .3), d = i === 0 ? 0 : rnd(130, 300), x = clamp(c.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(c.y + Math.sin(a) * d, PAD, H - PAD), m = stormMesh(150 * S);
          m.position.copy(P3({ x, y })); addExtra(m); B.mst.push({ owner: f, x, y, r: 150, t: 0, dur: 10, tick: 0, m, realm: f.realm, ha: rnd(0, 6.283), sp: rnd(110, 170) });
          vfx.ring(P3({ x, y }), { r0: .5, r1: 150 * S, dur: .5, color: 0xffffff });
        }
      } },
      c: { name: '거미 고치', cd: 35, desc: '앞에 체력 5000의 고치를 소환한다. 내가 맞으면 고치가 대신 피해를 입고, 부서지면 아군과 나를 2000 회복하고 체력 7000의 거대 거미가 나타난다', use(f) {
        if (f.cocoon) { toast(f, '이미 고치가 있습니다'); return false; }
        if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
        setAnim(f, 'cast', .5); const m = buildCocoon(); f.root.add(m); f.cocoon = { hp: 5000, max: 5000, mesh: m };
        vfx.burst('spark', P3(f, 1.2), 30, { speed: 4, speed2: 10, life: .7, size: .5, c0: 0xffffff, c1: 0xb8b8c8 }); ui.pop(P3(f, 4), '🕸 거미 고치!', '#f4eed8', true);
      } },
      v: { name: '연꽃 영역', cd: 60, desc: '만두찜기 모양 연꽃 영역을 30초 전개. 안의 적은 갇혀 초당 200, 아군은 초당 200×(적 수) 회복. 허무 3스택마다 허무의 빛(아군 1000 회복·디버프 해제 / 적 스킬 지연·피해 감소·최대 체력 -500)', use(f) { return startSteamer(f); } },
    }
  }
};
/* ===== 리치드래곤 V (일반): 거대한 리치드래곤의 얼굴 + 매혹의 하트비 ===== */
function buildLichFace() {   // 하늘에 뜨는 거대한 용의 얼굴 (원시 도형으로 조립)
  const g = new THREE.Group(), sk = new THREE.MeshStandardMaterial({ color: 0x6a2f9e, emissive: 0x3a0f66, emissiveIntensity: .8, roughness: .5, flatShading: true }), hn = new THREE.MeshStandardMaterial({ color: 0xe9dcff, emissive: 0x8a5acf, emissiveIntensity: .5, roughness: .4, flatShading: true });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff4fd8 }), mouth = new THREE.MeshBasicMaterial({ color: 0xff2ac0 });
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), sk); head.scale.set(1.1, 1, 1.05); g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2, 3.6), sk); snout.position.set(0, -1.1, 2.9); g.add(snout);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(3, .9, 3.2), sk); jaw.position.set(0, -2.7, 2.6); jaw.rotation.x = .12; g.add(jaw);
  const gl = new THREE.Mesh(new THREE.BoxGeometry(2.6, .6, 2.8), mouth); gl.position.set(0, -2.1, 2.7); g.add(gl);
  for (const sd of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(.55, 10, 8), eye); e.scale.set(1.2, .7, .5); e.position.set(sd * 1.5, .7, 2.6); e.rotation.z = sd * -.35; g.add(e);
    const h = new THREE.Mesh(new THREE.ConeGeometry(.7, 4.6, 8), hn); h.position.set(sd * 2.6, 3.4, -.4); h.rotation.set(-.3, 0, sd * -.5); g.add(h);
    const h2 = new THREE.Mesh(new THREE.ConeGeometry(.45, 3, 8), hn); h2.position.set(sd * 3.4, .6, -.6); h2.rotation.set(0, 0, sd * -1.2); g.add(h2);
    for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(.2, .8, 6), hn); t.position.set(sd * (.3 + i * .55), -1.8, 4.4); t.rotation.x = Math.PI; g.add(t); }
  }
  g.add(new THREE.PointLight(0xff4fd8, 2.2, 40)); return g;
}
function startLichRain(f, p) {
  const tg = foe(f), c = tg && tg !== B.ghost ? tg : { x: p.x, y: p.y }, a = ang(f, c), cx = clamp(c.x, PAD, W - PAD), cy = clamp(c.y, PAD, H - PAD);
  setAnim(f, 'cast', 1); const face = buildLichFace(), P = W3(cx, cy, 0); face.position.set(P.x + Math.cos(a) * 14, 46, P.z + Math.sin(a) * 14); face.scale.setScalar(.01); face.lookAt(P.x, 0, P.z); addExtra(face);
  B.lrain = B.lrain || []; B.lrain.push({ owner: f, realm: realmOf(f), face, t: 0, n: 0, N: 40, cx, cy, hearts: [], dur: 6.2 });
  vfx.ring(P3(f), { r0: .5, r1: 14, dur: .8, color: 0xff6ad8 }); ui.flash('#ff6ad8', .4, .5); shake(1, .8); ui.pop(P3(f, 4.6), '💘 매혹의 하트비!', '#ff9ae6', true);
  runScript(f, [], 1);
}
function updLichRain(dt) {
  if (!B.lrain || !B.lrain.length) return;
  for (const r of B.lrain) {
    r.t += dt; const f = r.owner, u = Math.min(1, r.t / .9), out = r.t > r.dur - .8 ? Math.max(0, (r.dur - r.t) / .8) : 1;
    r.face.scale.setScalar(Math.max(.01, 4.4 * ease.out(u) * out)); r.face.position.y = 46 + Math.sin(r.t * 2) * .8; r.face.children[3].scale.y = 1 + Math.sin(r.t * 9) * .15;
    while (r.n < r.N && r.t >= 1 + r.n * .09 && f.hp > 0) {   // 얼굴이 하트를 마구 쏟아낸다
      r.n++; const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * (r.n % 2 ? 90 : 380), x = clamp(r.cx + Math.cos(a) * d, PAD, W - PAD), y = clamp(r.cy + Math.sin(a) * d, PAD, H - PAD);
      const m = heartMesh(new THREE.MeshStandardMaterial({ color: 0xff6adf, emissive: 0xff2ac0, emissiveIntensity: 1.6, roughness: .3 }), 1.1); m.position.copy(W3(x, y, 40)); addExtra(m); r.hearts.push({ m, x, y, t: 0, fall: .6 });
    }
    for (const h of r.hearts) {
      h.t += dt; h.m.position.copy(W3(h.x, h.y, lerp(40, .6, Math.min(1, h.t / h.fall) ** 2))); h.m.rotation.y += dt * 6;
      if (h.t >= h.fall && !h.done) {
        h.done = true; rmExtra(h.m); const p = W3(h.x, h.y, .3); vfx.burst('heart', p, 5, { speed: 2, speed2: 6, life: .6, size: .6, c0: 0xff9ae6, c1: 0xff2ac0, up: 3 }); vfx.ring(p, { r0: .3, r1: 3.2, dur: .35, color: 0xff6ad8 });
        for (const t of B.fighters) if (t !== f && t.hp > 0 && !ally(f, t) && realmOf(t) === r.realm && Math.hypot(t.x - h.x, t.y - h.y) < 100 + t.r) {
          hurt(f, t, 150, { quiet: true, field: true }); if (!(t.def.id === 'pva' || t.def.id === 'mystic')) { if (!(t.st.charmS > 0)) ui.pop(P3(t, 3.4), '💘 매혹! 공격이 아군/자신에게', '#ff9ae6', true); t.st.charmS = Math.max(t.st.charmS || 0, 5); }
          t.hAcc = (t.hAcc || 0) + 150 * dmgMul(f); if (t.hAcc >= 900) { ui.pop(P3(t, 2.8 + rnd(0, 1)), Math.round(t.hAcc), '#ff9ae6', true); t.hAcc = 0; }
        }
      }
    }
    r.hearts = r.hearts.filter(h => !h.done);
    if (r.t >= r.dur) { rmExtra(r.face); r.done = true; }
  }
  B.lrain = B.lrain.filter(r => !r.done);
}
/* ===== 골드치즈 쿠키 (id 'gold') ===== */
const GLD = 0xffd84a;
function goldSpear(len, rad) {   // 금빛 창: +z 방향으로 뻗는다 (중심 = 창 중간)
  const g = new THREE.Group(), gm = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa800, emissiveIntensity: 1.3, metalness: .8, roughness: .25 }), wm = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len * .78, 8), gm); sh.rotation.x = Math.PI / 2; sh.position.z = -len * .11; g.add(sh);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(rad * 2.6, len * .26, 8), gm); tip.rotation.x = Math.PI / 2; tip.position.z = len * .37; g.add(tip);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(rad * .4, rad * .4, len * .8, 6), wm); core.rotation.x = Math.PI / 2; core.position.z = -len * .1; g.add(core);
  const gd = new THREE.Mesh(new THREE.TorusGeometry(rad * 2, rad * .5, 6, 14), gm); gd.position.z = len * .22; g.add(gd);
  return g;
}
function buildWings() {   // 금빛 날개
  const g = new THREE.Group(), fm = new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffa800, emissiveIntensity: .9, metalness: .5, roughness: .35, transparent: true, opacity: .88, side: THREE.DoubleSide });
  g.userData.w = [];
  for (const sd of [-1, 1]) { const w = new THREE.Group(); for (let i = 0; i < 7; i++) { const ln = 1.5 - i * .09, f = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), fm); f.scale.set(ln * .5, .09, .17); const a = .35 + i * .16; f.position.set(Math.cos(a) * ln * .5, Math.sin(a) * ln * .5, 0); f.rotation.z = a; w.add(f); } w.scale.x = sd; g.add(w); g.userData.w.push(w); }
  return g;
}
function gflash(x, y, a, len, wid, dur, o = {}) {   // 금빛 직선 이펙트(빠르게 나타났다 바로 사라진다)
  B.gfx = B.gfx || []; const c = { x: x + Math.cos(a) * len / 2, y: y + Math.sin(a) * len / 2 }, h = o.h || 2.4;
  const m = new THREE.Group(), m1 = new THREE.Mesh(new THREE.BoxGeometry(len * S, h, wid * S), new THREE.MeshBasicMaterial({ color: GLD, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false }));
  const m2 = new THREE.Mesh(new THREE.BoxGeometry(len * S, h * .6, wid * S * .45), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.add(m1, m2); m.position.copy(W3(c.x, c.y, h / 2)); m.rotation.y = -a; addExtra(m); B.gfx.push({ m, t: 0, dur });
}
function gHit(f, a, len, wid, dmg) {   // 직사각형 범위 판정
  const hits = [];
  for (const t of B.fighters) {
    if (t === f || t.hp <= 0 || ally(f, t) || realmOf(t) !== realmOf(f)) continue;
    const dx = t.x - f.x, dy = t.y - f.y, al = dx * Math.cos(a) + dy * Math.sin(a), pe = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    if (al > -t.r && al < len + t.r && pe < wid / 2 + t.r) { hurt(f, t, dmg, { dir: a }); hits.push(t); }
  }
  return hits;
}
function rmExtra(m) { world.scene.remove(m); B.extra = B.extra.filter(x => x !== m); }
function gAbsorbEnd(f) {
  const c = f.gabs; if (!c) return; f.gabs = null; f.root.remove(c.wings); vfx.remove(c.ring);
  if (f.hp <= 0) return;
  const tg = foe(f), a = tg && tg !== B.ghost && tg.hp > 0 ? ang(f, tg) : f.face; f.face = a; setAnim(f, 'cast', .4);
  const dmg = c.sum / dmgMul(f);
  shoot(f, { a, sp: 1100, r: 110, dmg, color: GLD, kind: 'gspear', life: 1.8, pierce: true });
  vfx.ring(P3(f), { r0: .5, r1: 18, dur: .8, color: GLD }); vfx.flash(P3(f, 2), { size: 20, color: GLD, dur: .5, grow: true }); ui.flash('#ffd84a', .5, .4); shake(1.4, .6);
  ui.pop(P3(f, 4.6), `✦ 재림의 창! ${Math.round(c.sum)}`, '#fff0a8', true);
}
function updGold(dt) {
  B.gfx = B.gfx || [];
  for (const g of B.gfx) { g.t += dt; const u = g.t / g.dur; g.m.children[0].material.opacity = .75 * Math.max(0, 1 - u * u); g.m.children[1].material.opacity = .95 * Math.max(0, 1 - u * u); g.m.scale.y = 1 - u * .4; }
  B.gfx = B.gfx.filter(g => { if (g.t >= g.dur) { rmExtra(g.m); return false; } return true; });
  if (B.gsp) {
    for (const s of B.gsp) {   // 하늘에서 떨어지는 창
      s.t += dt; const u = Math.min(1, s.t / s.fall), e1 = W3(s.x, s.y, .4); s.m.position.copy(W3(s.x - s.ox * (1 - u), s.y - s.oy * (1 - u), lerp(34, .4, u))); s.m.lookAt(e1);   // 시작점→착지점 방향을 창끝이 향한다
      if (s.t >= s.fall && !s.done) {
        s.done = true; rmExtra(s.m); const p = W3(s.x, s.y, .2); vfx.burst('glow', p, 5, { speed: 2, speed2: 6, life: .45, size: .7, c0: 0xffffff, c1: GLD, up: 2 }); vfx.ring(p, { r0: .3, r1: 3, dur: .35, color: GLD });
        const f = s.owner; for (const t of B.fighters) if (t !== f && t.hp > 0 && !ally(f, t) && realmOf(t) === s.realm && Math.hypot(t.x - s.x, t.y - s.y) < s.r + t.r) {
          hurt(f, t, s.dmg, { quiet: true, field: true }); t.gAcc = (t.gAcc || 0) + s.dmg * dmgMul(f); if (t.gAcc >= 1000) { ui.pop(P3(t, 2.8 + rnd(0, 1)), Math.round(t.gAcc), '#ffd84a', true); t.gAcc = 0; hitFX(t, GLD, false); }
        }
      }
    }
    B.gsp = B.gsp.filter(s => !s.done);
  }
  for (const f of B.fighters) {
    if (f.def.id !== 'gold') continue;
    if (f.hp <= 0) { if (f.gabs) { f.root.remove(f.gabs.wings); vfx.remove(f.gabs.ring); f.gabs = null; } f.rain = null; continue; }
    const c = f.gabs;
    if (c) {   // 금빛 날개의 재림: 10초 흡수 (체력 안 닳음)
      c.t += dt; const u = Math.min(1, c.t / c.dur), p = P3(f);
      c.wings.scale.setScalar(lerp(.5, 3.2, u)); c.wings.userData.w.forEach((w, i) => { w.rotation.y = (i ? 1 : -1) * (.25 + Math.sin(c.t * 5) * .08); });
      c.ring.obj.position.set(p.x, c.ring.obj.position.y, p.z);
      for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283), d = rnd(5, 9); vfx.emit('glow', { x: p.x + Math.cos(a) * d, y: rnd(.5, 4), z: p.z + Math.sin(a) * d, vx: -Math.cos(a) * d * 1.6, vz: -Math.sin(a) * d * 1.6, vy: 0, life: .6, s0: .7, s1: 0, c0: 0xffffff, c1: GLD, a: .8, drag: 0 }); }
      if (c.t >= c.dur) gAbsorbEnd(f);
    }
    const r = f.rain;
    if (r) {   // 금빛 창의 비: 총 12000 / N
      r.t += dt; const tg = foe(f);
      while (r.n < r.N && r.t >= .5 + r.n * .04) {
        r.n++; const base = tg && tg !== B.ghost && tg.hp > 0 ? tg : { x: r.px, y: r.py }, cl = r.n % 2 === 0, a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * (cl ? 70 : 220);
        const x = clamp(base.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(base.y + Math.sin(a) * d, PAD, H - PAD);
        const m = goldSpear(5, .12), ra = f.face + rnd(-.25, .25); addExtra(m);
        (B.gsp = B.gsp || []).push({ m, x, y, ox: Math.cos(ra) * 380, oy: Math.sin(ra) * 380, t: 0, fall: .55, r: 85, dmg: 12000 / r.N, owner: f, realm: realmOf(f) });   // 비스듬히(진행 방향으로 기울어) 떨어진다
      }
      if (r.n >= r.N) f.rain = null;
    }
  }
}
CHARS.gold = {
  id: 'gold', name: '골드치즈 쿠키', color: GLD, fx: GLD, cost: 1800, hp: 21000, pref: 4.2, atkRange: 620, aiPref: 340, tag: '금빛 창 · 날개의 재림 · 창의 비',
  passive: '체력이 깎일수록 주는 피해가 비례해서 강해집니다. (체력 0%일 때 최대 2배)',
  skills: {
    base: {
      a: { name: '금빛 창 투척', cd: .8, desc: '금빛 창을 던진다 500', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 1000, r: 20, dmg: 500, color: GLD, kind: 'gspear', life: 1.2 }); } },
      z: { name: '금빛 창격', cd: 10, desc: '창으로 앞쪽 길고 두꺼운 범위를 금빛으로 내리친다 4500. 시전이 빠르고 이펙트는 바로 사라진다', use(f, p) {
        const a = ang(f, p); f.face = a; setAnim(f, 'slash', .3);
        runScript(f, [{ at: .12, fn: () => { gflash(f.x, f.y, a, 980, 230, .22); const hs = gHit(f, a, 980, 230, 4500); vfx.slashGround(P3(f, .9), Math.PI / 2 - a, { len: 26, color: 0xffffff, from: 1, dur: .22 }); shake(1, .3); ui.flash('#ffd84a', .3, .2); if (hs.length) B.hitstop = Math.max(B.hitstop, .08); } }], .3);
      } },
      x: { name: '금빛 창 러쉬', cd: 14, desc: '빠르게 3번 돌진하며 창으로 찌른다. 찌를 때마다 1700', use(f, p) {
        const T = 1.15, per = .38; let st = null; const fired = [false, false, false];
        setAnim(f, 'slash', .25);
        act(f, T, (u, dt) => {
          const t = u * T, i = Math.min(2, Math.floor(t / per)), k = t - i * per, tg = foe(f), ok = tg && tg !== B.ghost && tg.hp > 0, a0 = ok ? ang(f, tg) : f.face;
          if (!st || st.i !== i) { st = { i, sx: f.x, sy: f.y, a: a0, len: ok ? clamp(dist(f, tg) - 110, 0, 340) : 300 }; f.face = a0; }
          if (k < .2) { const q = ease.io(k / .2); f.x = clamp(st.sx + Math.cos(st.a) * st.len * q, PAD, W - PAD); f.y = clamp(st.sy + Math.sin(st.a) * st.len * q, PAD, H - PAD); const w = P3(f, 1); vfx.emit('glow', { x: w.x, y: w.y, z: w.z, vy: 1, life: .4, s0: 1, s1: 0, c0: 0xffffff, c1: GLD, a: .7, drag: 0 }); }
          if (k >= .2 && !fired[i]) { fired[i] = true; setAnim(f, 'slash', .2); gflash(f.x, f.y, f.face, 300, 70, .16); gHit(f, f.face, 300, 110, 1700); vfx.burst('spark', P3(f, 1).add(new THREE.Vector3(Math.cos(f.face), 0, Math.sin(f.face)).multiplyScalar(7)), 14, { speed: 6, speed2: 14, life: .35, size: .45, c0: 0xffffff, c1: GLD }); shake(.5, .15); }
        });
      } },
      c: { name: '금빛 날개의 재림', cd: 40, desc: '금빛 날개가 커지며 10초간 주변의 모든 피해를 흡수한다 (체력이 닳지 않음). 10초 뒤 거대한 창을 던져 흡수한 피해만큼 준다', use(f) {
        if (f.gabs) return false; setAnim(f, 'cast', .6);
        const w = buildWings(); w.position.set(0, 2.2, -.5); w.scale.setScalar(.5); f.root.add(w);
        f.gabs = { t: 0, dur: 10, sum: 0, wings: w, ring: vfx.decal(P3(f), { tex: 'ring', r: 9, color: GLD, alpha: .6, spin: .8, y: .06 }) };
        vfx.ring(P3(f), { r0: .5, r1: 12, dur: .7, color: GLD }); vfx.flash(P3(f, 2), { size: 14, color: GLD, dur: .5, grow: true }); ui.flash('#ffd84a', .4, .35); ui.pop(P3(f, 4.6), '✦ 금빛 날개의 재림!', '#fff0a8', true);
      } },
      v: { name: '금빛 창의 비', cd: 55, desc: '[컷신] 하늘로 날아올라 무수히 많은 금빛 창을 만들어 던진다. 총 12000 (창 n개 중 맞은 창 하나당 12000/n)', use(f, p) {
        if (f.rain || f.cutV) return false; setAnim(f, 'cast', 3); f.st.inv = Math.max(f.st.inv, 3.6); f.cutV = true;
        const tg0 = foe(f), a0 = tg0 && tg0 !== B.ghost ? ang(f, tg0) : f.face; f.face = a0; const px = tg0 && tg0 !== B.ghost ? tg0.x : p.x, py = tg0 && tg0 !== B.ghost ? tg0.y : p.y;
        ui.cinema(true); ui.title(f.def.name, '금빛 창의 비'); ui.flash('#ffd84a', .5, .5);
        vfx.ring(P3(f), { r0: .5, r1: 20, dur: 1, color: GLD }); vfx.burst('glow', P3(f, 1.6), 50, { speed: 3, speed2: 14, life: .9, size: 1, c0: 0xffffff, c1: GLD, up: 6 });
        const sky = []; let made = 0;
        act(f, 3.2, (u, dt) => {
          const t = u * 3.2; f.face = a0; f.pose = 'raise'; f.air = 15 * Math.min(1, t / 1.1) * (t > 2.7 ? Math.max(0, 1 - (t - 2.7) / .5) : 1);   // 하늘로 날아올랐다가 내려온다
          const c = P3(f, 0);
          while (made < 60 && t >= .9 + made * .03) {   // 하늘에 금빛 창이 하나씩 생겨난다
            const a = rnd(0, 6.283), d = rnd(9, 24), m = goldSpear(3.6, .09); m.position.set(c.x + Math.cos(a) * d, 4 + rnd(0, 8), c.z + Math.sin(a) * d); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(a0) * .6, -1, Math.sin(a0) * .6).normalize()); m.userData.dir = new THREE.Vector3(Math.cos(a0) * .6, -1, Math.sin(a0) * .6).normalize(); m.scale.setScalar(.01); addExtra(m); sky.push({ m, k: 0 }); made++;
            vfx.burst('glow', m.position.clone(), 3, { speed: 1, life: .4, size: .8, c0: 0xffffff, c1: GLD });
          }
          for (const s of sky) { s.k = Math.min(1, s.k + dt * 4); s.m.scale.setScalar(s.k); s.m.position.y += Math.sin(t * 6 + s.m.position.x) * dt * .6; }
          if (t > .8 && t < 2.7 && Math.random() < .5) vfx.ring(P3(f, 0), { r0: 1, r1: 14, dur: .6, color: GLD, alpha: .6 });
          if (t > 2.4) sky.forEach(s => { s.m.position.addScaledVector(s.m.userData.dir, dt * 22); });
        }, () => {
          sky.forEach(s => rmExtra(s.m)); ui.cinema(false); ui.title('', ''); f.pose = null; f.air = 0; f.cutV = false;
          ui.flash('#ffd84a', .5, .5); shake(1.4, .8); ui.pop(P3(f, 4.6), '✦ 금빛 창의 비!', '#fff0a8', true);
          f.rain = { t: 0, n: 0, N: 60, px, py };   // 컷신이 끝나면 실제로 던진다
        });
      } },
    }
  }
};
/* ===== 각성 골드치즈 쿠키 (id 'goldA', HP 21000 + 보호막 5000) ===== */
const CHZ = 0xffc42e, CHZ2 = 0xffe27a;
const Wr = (x, y, h = 0, rl = 0) => { const v = W3r(x, y, h); if (rl) v.x += RDX; return v; };
const gaTg = (f, R = 1e9) => B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && realmOf(o) === realmOf(f) && dist(f, o) < R);
const chzMat = (o = .85) => new THREE.MeshStandardMaterial({ color: CHZ, emissive: 0xff9a10, emissiveIntensity: .55, roughness: .35, transparent: true, opacity: o });
function spearAt(p, dir, len = 5, rad = .12) { const m = goldSpear(len, rad); m.position.copy(p); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()); return m; }
function gaWingsAura(f) {
  const g = new THREE.Group(); g.userData.sp = [];
  for (let i = 0; i < 6; i++) { const sp = goldSpear(2.4, .07), a = i / 6 * 6.283; sp.position.set(Math.cos(a) * 1.9, 2.6, Math.sin(a) * 1.9); sp.rotation.x = -Math.PI / 2.4; sp.rotation.order = 'YXZ'; sp.rotation.y = -a + Math.PI / 2; g.add(sp); }
  f.root.add(g); return g;
}
/* 치즈 폭포: 25초, 반경 520, 초당 800 (총 20000) + 슬로우 */
function startFalls(f, x, y) {
  const R = 520, g = new THREE.Group(), pool = new THREE.Mesh(new THREE.CircleGeometry(R * S, 44), new THREE.MeshStandardMaterial({ color: CHZ, emissive: 0xff9010, emissiveIntensity: .5, roughness: .3, transparent: true, opacity: 0, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.y = .09; g.add(pool);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.8, 34, 22, 1, true), new THREE.MeshBasicMaterial({ color: CHZ2, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); col.position.y = 17; g.add(col);
  const rib = []; for (let i = 0; i < 12; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(.5, 7, .5), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: .8 })); const a = i / 12 * 6.283, rr = 3.6 + (i % 3) * .5; r.position.set(Math.cos(a) * rr, 30 - i * 2.4, Math.sin(a) * rr); g.add(r); rib.push(r); }
  const top = new THREE.Mesh(new THREE.TorusGeometry(3.4, .9, 8, 26), chzMat(.9)); top.rotation.x = Math.PI / 2; top.position.y = 34; g.add(top);
  const base = new THREE.Mesh(new THREE.TorusGeometry(5, 1.1, 8, 30), chzMat(.9)); base.rotation.x = Math.PI / 2; base.position.y = .5; g.add(base);
  g.position.copy(Wr(x, y, 0)); addExtra(g); (B.gfalls = B.gfalls || []).push({ owner: f, x, y, R, t: 0, dur: 25, tick: 0, g, pool, col, rib, top });
  vfx.ring(Wr(x, y, 0), { r0: 1, r1: R * S, dur: 1, color: CHZ }); ui.flash('#ffd04a', .4, .4); shake(1.2, .8); ui.pop(P3(f, 4.4), '🧀 흘러내리는 치즈폭포!', '#fff0a8', true);
}
/* 꾹 눌러 차징: 금빛 창이 하늘에서 떨어져 속박(1500) → 치즈 덩어리(3500) → 치즈에 갇혀 봉인(3초) — 총 5000 */
function gaStrike(f) {
  const tg = gaTg(f, 1300); if (!tg.length) { toast(f, '대상이 없습니다'); return false; }
  ui.flash('#ffe27a', .5, .5); shake(1.4, .8); ui.pop(P3(f, 4.4), '✦ 금빛 창의 속박!', '#fff0a8', true);
  for (const e of tg) (B.gstr = B.gstr || []).push({ owner: f, e, t: 0, sp: [], ch: [], mk: 0, mc: 0, blk: null, rl: e.realm || 0 });
}
function updGStr(dt) {
  if (!B.gstr) return; const dir = new THREE.Vector3(0, -1, 0);
  for (const s of B.gstr) {
    s.t += dt; const e = s.e, f = s.owner; if (e.hp <= 0 || f.hp <= 0) s.t = 99; const c = P3(e, 0);
    while (s.mk < 6 && s.t >= s.mk * .08) {   // 하늘에서 금빛 창 6개가 상대 둘레에 꽂힌다
      const a = s.mk / 6 * 6.283, to = c.clone().add(new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6)), m = spearAt(to.clone().setY(34), dir, 6, .16); addExtra(m); s.sp.push({ m, to, k: 0, done: false }); s.mk++;
    }
    for (const q of s.sp) {
      if (q.done) continue; q.k = Math.min(1, q.k + dt / .35); q.m.position.set(q.to.x, lerp(34, 3, q.k * q.k), q.to.z);
      if (q.k >= 1) { q.done = true; vfx.ring(q.to, { r0: .3, r1: 3.2, dur: .35, color: GLD }); vfx.burst('glow', q.to.clone().setY(.4), 6, { speed: 2, speed2: 7, life: .45, size: .7, c0: 0xffffff, c1: GLD, up: 2 }); if (e.hp > 0) { e.st.lock = Math.max(e.st.lock, 3.4); hurt(f, e, 250, { quiet: true, field: true }); } shake(.4, .15); }
    }
    while (s.mc < 7 && s.t >= 1.05 + s.mc * .12) {   // 치즈 덩어리가 떨어진다
      const a = rnd(0, 6.283), d = rnd(0, 1.8), m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), chzMat(.95)); m.scale.setScalar(rnd(1.3, 2.2)); const to = c.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)); m.position.set(to.x, 30, to.z); addExtra(m); s.ch.push({ m, to, k: 0, done: false }); s.mc++;
    }
    for (const q of s.ch) {
      if (q.done) continue; q.k = Math.min(1, q.k + dt / .5); q.m.position.y = lerp(30, 1.2, q.k * q.k); q.m.rotation.x += dt * 4; q.m.rotation.z += dt * 3;
      if (q.k >= 1) { q.done = true; rmExtra(q.m); vfx.burst('glow', q.to.clone().setY(.8), 14, { speed: 3, speed2: 10, life: .6, size: 1, c0: 0xffffff, c1: CHZ, up: 3 }); vfx.ring(q.to, { r0: .4, r1: 4, dur: .4, color: CHZ }); if (e.hp > 0) hurt(f, e, 500, { quiet: true, field: true }); shake(.6, .2); }
    }
    if (s.t >= 2.1 && !s.blk && s.mc >= 7) {   // 치즈 덩어리에 갇혀 봉인
      const b = new THREE.Mesh(new THREE.BoxGeometry(4.6, 5.6, 4.6), chzMat(.72)); b.position.copy(c).setY(2.8); addExtra(b); s.blk = b; s.bt = 0; e.st.lock = Math.max(e.st.lock, 3); e.st.silence = Math.max(e.st.silence, 3); ui.pop(P3(e, 5), '🧀 봉인!', '#fff0a8', true); vfx.burst('glow', c.clone().setY(2), 30, { speed: 4, speed2: 12, life: .8, size: 1.2, c0: 0xffffff, c1: CHZ, up: 2 });
    }
    if (s.blk) { s.bt += dt; s.blk.position.set(P3(e).x, 2.8, P3(e).z); if (s.bt >= 3) s.t = 99; }
    if (s.t >= 99) { s.sp.forEach(q => rmExtra(q.m)); s.ch.forEach(q => { if (!q.done) rmExtra(q.m); }); if (s.blk) { vfx.burst('glow', P3(e, 2), 30, { speed: 5, speed2: 14, life: .7, size: 1, c0: 0xffffff, c1: CHZ }); rmExtra(s.blk); } s.done = true; }
  }
  B.gstr = B.gstr.filter(s => !s.done);
}
function endGSky(f) {
  if (f.form !== 'sky') return; f.form = 'base'; f.formT = 0; f.air = 0; f.pose = null; if (f.skyM) { f.root.remove(f.skyM); f.skyM = null; } f.cd.z = Math.max(0, (f.skyZ || 0) - 8); f.st.inv = Math.max(f.st.inv, .5);
  vfx.ring(P3(f), { r0: 1, r1: 12, dur: .6, color: GLD }); shake(.8, .4);
}
function gaSkyRain(f, p) {   // 금빛 하늘의 벌: 2000 (창 10개 × 200)
  setAnim(f, 'cast', .4); const tg = gaTg(f, 1600).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0], base = tg && Math.hypot(tg.x - p.x, tg.y - p.y) < 800 ? tg : p;
  for (let i = 0; i < 10; i++) {
    const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * 85, x = clamp(base.x + Math.cos(a) * d, PAD, W - PAD), y = clamp(base.y + Math.sin(a) * d, PAD, H - PAD), m = goldSpear(5, .12), ra = rnd(0, 6.283); addExtra(m);
    (B.gsp = B.gsp || []).push({ m, x, y, ox: Math.cos(ra) * 120, oy: Math.sin(ra) * 120, t: -i * .05, fall: .55, r: 110, dmg: 200, owner: f, realm: realmOf(f) });
  }
  ui.flash('#ffd84a', .25, .25); ui.pop(P3(f, 5.5), '⚡ 금빛 하늘의 벌!', '#fff0a8', true);
}
/* V: 창조주의 포위 (컷신) — 적 한 명마다 금빛 창 우리가 둘러싸고, 컷신이 끝나면 일제히 찌른다. 적당 10000 */
function startGSiege(f) {
  const es = gaTg(f).filter(o => !o.minion); if (f.cutV || f.form !== 'base' || !es.length) { toast(f, '대상이 없습니다'); return false; }
  setAnim(f, 'cast', 5.4); f.pose = 'raise'; f.cutV = true; f.st.inv = Math.max(f.st.inv, 5.8); const T = 5.4, N = 30, R0 = 5.2, rings = es.map(e => ({ e, sp: [], mk: 0, a0: rnd(0, 6.283) })); let dealt = false;
  ui.cinema(true); ui.title(f.def.name, '창조주의 포위'); ui.flash('#ffe27a', .6, .5); ui.tint('rgba(255,200,60,.10)');
  es.forEach(e => { e.st.stun = Math.max(e.st.stun, 5); });
  vfx.ring(P3(f), { r0: .5, r1: 22, dur: 1.2, color: GLD }); vfx.burst('glow', P3(f, 1.6), 60, { speed: 3, speed2: 16, life: 1, size: 1.1, c0: 0xffffff, c1: GLD, up: 6 });
  const halo = gaWingsAura(f); halo.scale.setScalar(1.8);
  act(f, T, (u, dt) => {
    const t = u * T; f.pose = 'raise'; f.air = 16 * ease.io(Math.min(1, t / 1.3)) * (t > 4.9 ? Math.max(0, 1 - (t - 4.9) / .5) : 1); halo.rotation.y += dt * 2;
    B.camFocus = t < 1.3 ? null : { x: rings[Math.min(rings.length - 1, Math.floor((t - 1.3) / 1.1))].e.x, y: rings[Math.min(rings.length - 1, Math.floor((t - 1.3) / 1.1))].e.y, air: 2.4 };
    const conv = t > 3.7 ? Math.min(1, (t - 3.7) / .75) : 0;
    for (const r of rings) {
      const e = r.e, c = P3(e, 0), want = t < 1.3 ? 0 : Math.min(N, Math.floor((t - 1.3) / 1.9 * N)); r.a0 += dt * (.6 + conv * 5);
      while (r.mk < want) { const m = goldSpear(4.2, .1); m.scale.setScalar(.01); addExtra(m); r.sp.push({ m, i: r.mk, k: 0 }); vfx.burst('glow', c.clone().setY(2 + r.mk % 6), 2, { speed: 1, life: .4, size: .7, c0: 0xffffff, c1: GLD }); r.mk++; }
      for (const q of r.sp) {
        q.k = Math.min(1, q.k + dt * 3.5); const a = r.a0 + q.i / N * 6.283 * 2, h = 1 + (q.i % 8) * 1.1 + conv * 0, rad = R0 * (1 - conv * .92), p = new THREE.Vector3(c.x + Math.cos(a) * rad, h, c.z + Math.sin(a) * rad), to = new THREE.Vector3(c.x - p.x, 1.4 - h, c.z - p.z).normalize();
        q.m.position.copy(p); q.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to); q.m.scale.setScalar(q.k * (1 + conv * .2));
      }
      if (t > 1.3 && t < 3.7 && Math.random() < dt * 3) vfx.ring(c, { r0: R0 * .6, r1: R0, dur: .5, color: GLD, alpha: .5 });
    }
    if (conv > 0 && !dealt && conv >= 1) {
      dealt = true; ui.flash('#ffffff', .9, .6); shake(3, 1); B.hitstop = Math.max(B.hitstop, .2);
      for (const r of rings) { const e = r.e; vfx.burst('glow', P3(e, 1.3), 120, { speed: 8, speed2: 30, life: 1, size: 1.4, c0: 0xffffff, c1: GLD }); vfx.column(P3(e), { r: 3, h: 40, dur: .8, color: 0xffd040, alpha: .85 }); vfx.ring(P3(e), { r0: 1, r1: 18, dur: .7, color: 0xffffff }); e.st.inv = 0; if (e.hp > 0) hurt(f, e, 10000, { dir: ang(f, e) }); }
      ui.pop(P3(f, 8), '✦ 창조주의 포위!', '#fff0a8', true);
    }
  }, () => { rings.forEach(r => r.sp.forEach(q => rmExtra(q.m))); f.root.remove(halo); B.camFocus = null; ui.cinema(false); ui.title('', ''); ui.tint(''); f.pose = null; f.air = 0; f.cutV = false; if (!dealt) es.forEach(e => { e.st.stun = 0; }); });
}
/* ===== 궁극기: 가상의 골드치즈 왕국 ===== */
CHARS.mob_marzi = mobDef('mob_marzi', '마지팬맛 쿠키', 0xd8b078, 1500, '가상의 골드치즈 왕국 · 체포', {
  a: { name: '체포 곤봉', cd: 1.2, desc: '근접 110', use(f) { setAnim(f, 'slash', .25); swing(f, 130, 1, 110, 0xe8c890); } },
}, { range: 130, pref: 60 });
function gkMazeGen(cols, rows) {
  const o = Array.from({ length: cols }, () => Array.from({ length: rows }, () => ({ r: false, d: false, seen: false }))), st = [[0, 0]]; o[0][0].seen = true;
  while (st.length) {
    const [i, j] = st[st.length - 1], nb = [];
    if (i + 1 < cols && !o[i + 1][j].seen) nb.push([i + 1, j, 'r']); if (i > 0 && !o[i - 1][j].seen) nb.push([i - 1, j, 'l']); if (j + 1 < rows && !o[i][j + 1].seen) nb.push([i, j + 1, 'd']); if (j > 0 && !o[i][j - 1].seen) nb.push([i, j - 1, 'u']);
    if (!nb.length) { st.pop(); continue; }
    const [ni, nj, dr] = nb[Math.floor(Math.random() * nb.length)]; if (dr === 'r') o[i][j].r = true; else if (dr === 'l') o[ni][nj].r = true; else if (dr === 'd') o[i][j].d = true; else o[ni][nj].d = true; o[ni][nj].seen = true; st.push([ni, nj]);
  }
  return o;
}
const gkCan = (o, i, j, ni, nj) => ni > i ? o[i][j].r : ni < i ? o[ni][nj].r : nj > j ? o[i][j].d : o[ni][nj].d;
function gkPos(D, e, k) { const sx = k === 1 ? 380 : 0; return { x: 360 + (k === 1 ? 0 : 0), y: H / 2 + (D.vs.indexOf(e) - (D.vs.length - 1) / 2) * 150 + sx * 0 }; }
function startGK(f) {
  if (!f.awake) { toast(f, '각성 필요'); return false; }
  if (f.gauge < 100) { toast(f, '궁극기 게이지가 부족합니다'); return false; }
  const vs = B.fighters.filter(o => o !== f && !ally(f, o) && o.hp > 0 && !o.minion && !o.realm);
  if (f.form !== 'base' || f.cutV || B.gk || B.dream || B.voidR || B.mind || B.seal || B.abyss || B.lult || B.cut || B.forks.length || B.explore || B.raid || B.fx || !vs.length) { toast(f, '지금은 사용할 수 없습니다'); return false; }
  f.gauge = 0; setAnim(f, 'cast', 2.4); f.pose = 'raise'; runScript(f, [], 2.4, () => { f.pose = null; }); if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f);
  ui.flash('#ffe27a', .8, .8); ui.title('가상의 골드치즈 왕국', 'THE VIRTUAL GOLD CHEESE KINGDOM'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2600);
  vfx.ring(P3(f), { r0: .5, r1: 30, dur: 1.4, color: GLD }); vfx.column(P3(f), { r: 5, h: 50, dur: 1.4, color: 0xffd040, alpha: .8 });
  const D = B.gk = { f, vs: vs.slice(), esc: [], t: 0, phase: 1, mobs: [], objs: [], decs: [], rs: { owner: f, target: vs[0] }, ret: new Map(), spawnT: 1, boss: null, door: { x: W - 780, y: H / 2, r: 190 }, open: false, maze: null, total: 210 };
  world.setDream(6); camState.init = false; B.viewSeal = false;
  vs.forEach((e, i) => { D.ret.set(e, { x: e.x, y: e.y }); clearStates(e); dropOwned(x => x.owner === e); B.projs.forEach(p => { if (p.owner === e) killProj(p); }); e.realm = 1; const p = gkPos(D, e); e.x = p.x; e.y = p.y; e.st.inv = 1.2; e.gkCd = e.cdMul; e.gErrT = 3.5; e.gErrN = 0; e.arrT = 2; });
  const b = addMinion('gold', W * .52, H / 2, { hp: 10000, pm: .2, realm: 1 }); b.team = f.team; b.dmob = true; b.gkBoss = true; b.nick = '각성 전 골드치즈'; b.cd.v = 1e9; b.gauge = -1e9; b.awake = false; b.cmb = B.time; D.boss = b; D.mobs.push(b);
  D.decs.push(vfx.decal(P3({ x: D.door.x, y: D.door.y, realm: 1 }), { tex: 'ring', r: D.door.r * S, color: 0x6a5a2a, alpha: .6, y: .1 }));
  const me = B.fighters[0]; if (vs.includes(me)) { ui.tint('rgba(40,255,230,.07)'); toast(me, '⚠ 오류 디버프! 각성 전 골드치즈를 쓰러뜨리고 마지팬맛 쿠키를 피해 피라미드로 들어가 미로를 탈출하세요'); } else toast(f, '적들을 가상의 골드치즈 왕국에 가뒀습니다. G키로 왕국을 볼 수 있어요');
  ui.pop(P3(f, 4.6), '👑 가상의 골드치즈 왕국!', '#fff0a8', true);
}
function gkMaze(D) {
  const cols = 8, rows = 4, CS = Math.floor(Math.min(380, (W - 140) / cols, (H - 140) / rows)), x0 = (W - cols * CS) / 2, y0 = (H - rows * CS) / 2, o = gkMazeGen(cols, rows), dist2 = Array.from({ length: cols }, () => Array(rows).fill(-1));
  const nbs = (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && gkCan(o, i, j, a, b));
  let q = [[0, 0]], far = [0, 0], d0 = Array.from({ length: cols }, () => Array(rows).fill(-1)); d0[0][0] = 0;
  while (q.length) { const [i, j] = q.shift(); if (d0[i][j] > d0[far[0]][far[1]]) far = [i, j]; for (const [a, b] of nbs(i, j)) if (d0[a][b] < 0) { d0[a][b] = d0[i][j] + 1; q.push([a, b]); } }
  q = [far]; dist2[far[0]][far[1]] = 0; while (q.length) { const [i, j] = q.shift(); for (const [a, b] of nbs(i, j)) if (dist2[a][b] < 0) { dist2[a][b] = dist2[i][j] + 1; q.push([a, b]); } }
  const wm = new THREE.MeshStandardMaterial({ color: 0xb98a3a, emissive: 0x3a2808, roughness: .8, flatShading: true }), tm = new THREE.MeshBasicMaterial({ color: 0x3affa0 });
  const seg = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay), mx = (ax + bx) / 2, my = (ay + by) / 2, vert = Math.abs(bx - ax) < 1, m = new THREE.Mesh(new THREE.BoxGeometry((vert ? 48 : len + 48) * S, 5, (vert ? len + 48 : 48) * S), wm), tr = new THREE.Mesh(new THREE.BoxGeometry((vert ? 14 : len + 48) * S, .25, (vert ? len + 48 : 14) * S), tm);
    m.position.copy(Wr(mx, my, 2.5, 1)); tr.position.copy(Wr(mx, my, 5.1, 1)); addExtra(m); addExtra(tr); D.objs.push(m, tr);
    const n = Math.max(1, Math.ceil(len / 95)); for (let k = 0; k <= n; k++) B.objs.push({ x: ax + (bx - ax) * k / n, y: ay + (by - ay) * k / n, r: 46, realm: 1, gk: true });
  };
  for (let i = 0; i < cols; i++) for (let j = 0; j <= rows; j++) if (j === 0 || j === rows || !o[i][j - 1].d) seg(x0 + i * CS, y0 + j * CS, x0 + (i + 1) * CS, y0 + j * CS);
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) if (i === 0 || i === cols || !o[i - 1][j].r) seg(x0 + i * CS, y0 + j * CS, x0 + i * CS, y0 + (j + 1) * CS);
  const cen = (i, j) => ({ x: x0 + (i + .5) * CS, y: y0 + (j + .5) * CS });
  return { cols, rows, CS, x0, y0, o, dist: dist2, exit: cen(far[0], far[1]), exitC: far, start: cen(0, 0), cen, cell: (x, y) => [clamp(Math.floor((x - x0) / CS), 0, cols - 1), clamp(Math.floor((y - y0) / CS), 0, rows - 1)], nbs };
}
function gkPhase2(D) {
  D.phase = 2; D.open = false; D.t2 = 0; D.mobs.forEach(m => { if (m.hp > 0) m.hp = 0; }); D.decs.forEach(d => vfx.remove(d)); D.decs = [];
  world.setDream(7); camState.init = false; const M = D.maze = gkMaze(D); ui.flash('#ffe27a', .7, .7); ui.title('피라미드 미로', 'ESCAPE THE PYRAMID'); const bb = B; setTimeout(() => { if (B === bb) ui.title('', ''); }, 2000);
  D.vs.forEach((e, i) => { if (e.hp <= 0 || e.realm !== 1) return; e.x = M.start.x + rnd(-40, 40); e.y = M.start.y + rnd(-40, 40); e.st.inv = Math.max(e.st.inv, 1); e.arrT = 2; });
  D.decs.push(vfx.decal(P3({ x: M.exit.x, y: M.exit.y, realm: 1 }), { tex: 'ring', r: 130 * S, color: 0x6affb0, alpha: .95, y: .1 }));
  const me = B.fighters[0]; if (D.vs.includes(me)) toast(me, '🧭 초록빛 출구까지 미로를 탈출하세요!');
}
function gkExit(D, e, why) {
  const r = D.ret.get(e); e.realm = 0; if (r) { e.x = r.x; e.y = r.y; } e.cdMul = e.gkCd; e.gErrT = 0; e.arrT = 0; e.gkMv = null; e.st.inv = Math.max(e.st.inv, .6); D.vs = D.vs.filter(x => x !== e);
  if (why === 'esc') { e.st.stun = Math.max(e.st.stun, 1); ui.pop(P3(e, 4), '🚪 탈출 성공!', '#bfffd8', true); ui.flash('#ffffff', .5, .5); }
}
function endGk(early) {
  const D = B.gk; if (!D) return; B.gk = null; const f = D.f;
  for (const e of D.vs.slice()) { gkExit(D, e, 'end'); e.st.inv = 0; if (!early && e.hp > 0) { e.shield = 0; ui.pop(P3(e, 4), '💀 왕국에 갇혔다', '#ff9a9a', true); hurt(f, e, 999999, { quiet: true, field: true }); } }
  D.mobs.forEach(m => { if (m.hp > 0) m.hp = 0; }); D.objs.forEach(o => rmExtra(o)); D.decs.forEach(d => vfx.remove(d)); B.objs = B.objs.filter(o => !o.gk);
  world.setDream(0); B.viewSeal = false; camState.init = false; ui.tint(''); ui.flash('#fff0b0', .6, .5);
}
function gkAvoid(D, e, mx, my) {
  for (const m of D.mobs) if (m.hp > 0 && !m.gkBoss) { const d = Math.hypot(m.x - e.x, m.y - e.y) || 1; if (d < 320) { const k = (320 - d) / 320 * 1.8; mx -= (m.x - e.x) / d * k; my -= (m.y - e.y) / d * k; } }
  const l = Math.hypot(mx, my) || 1; return { mx: mx / l, my: my / l };
}
function updGk(dt) {
  const D = B.gk; if (!D) return; const f = D.f; D.t += dt;
  if (f.hp <= 0) return endGk(true);
  D.vs = D.vs.filter(e => { if (e.hp > 0 && e.realm === 1) return true; if (e.realm === 1) gkExit(D, e, 'dead'); return false; });
  if (!D.vs.length) return endGk(true);
  const me = B.fighters[0]; D.rs.target = D.vs.includes(me) ? me : D.vs[0];
  if (D.t >= D.total) return endGk(false);
  D.spawnT -= dt; const alive = D.mobs.filter(m => m.hp > 0 && !m.gkBoss);
  if (D.spawnT <= 0 && alive.length < (D.phase === 1 ? 6 : 3)) {
    D.spawnT = D.phase === 1 ? 4.5 : 6; const tg = D.vs[Math.floor(Math.random() * D.vs.length)]; let x, y;
    if (D.phase === 1) { const side = Math.random(); x = side < .5 ? rnd(W * .3, W - PAD - 100) : W - PAD - 60; y = side < .5 ? (Math.random() < .5 ? PAD + 50 : H - PAD - 50) : rnd(PAD + 60, H - PAD - 60); }
    else { const M = D.maze, [ci, cj] = M.cell(tg.x, tg.y), ops = M.nbs(ci, cj).filter(([a, b]) => Math.hypot(M.cen(a, b).x - tg.x, M.cen(a, b).y - tg.y) > 380), pick = ops.length ? ops[Math.floor(Math.random() * ops.length)] : [ci, cj], c = M.cen(pick[0], pick[1]); x = c.x; y = c.y; }
    const m = addMinion('mob_marzi', x, y, { hp: 1500, pm: .8, realm: 1, notag: true }); m.team = f.team; m.dmob = true; m.gkTtl = D.phase === 1 ? 40 : 16; m.cmb = B.time; m.nick = '마지팬맛'; D.mobs.push(m); vfx.burst('spark', P3(m, 1.2), 10, { speed: 3, life: .4, size: .4, c0: 0x38ffe8, c1: 0xffb830 });
  }
  for (const m of D.mobs) { if (m.hp > 0 && m.gkTtl !== undefined && (m.gkTtl -= dt) <= 0) m.hp = 0; }
  for (const e of D.vs) {   // 오류 디버프: 일정 시간마다 찌릿 — 스킬 봉인 + 쿨타임 증가 + 스턴
    e.arrT = Math.max(0, (e.arrT || 0) - dt); e.gErrT -= dt;
    if (e.gErrT <= 0) { e.gErrT = 5; e.gErrN = (e.gErrN || 0) + 1; e.st.stun = Math.max(e.st.stun, .9); e.st.silence = Math.max(e.st.silence, 3); for (const k in e.cd) e.cd[k] += 2.5; e.cdMul = Math.max(.5, (e.gkCd || 1) * (1 - e.gErrN * .06)); vfx.burst('spark', P3(e, 1.3), 24, { speed: 5, speed2: 14, life: .4, size: .5, c0: 0x38ffe8, c1: 0xffb830 }); ui.pop(P3(e, 4), '⚠ 오류! 찌릿', '#38ffe8', true); if (e === me) { ui.flash('#38ffe8', .45, .3); shake(.7, .3); } }
    if (e.arrT <= 0) for (const m of D.mobs) if (m.hp > 0 && !m.gkBoss && Math.hypot(m.x - e.x, m.y - e.y) < m.r + e.r + 26) {   // 체포: 스턴 후 출발점으로 끌려간다
      if (e.ctrl.kind === 'ai' && Math.random() < .5) { e.arrT = 3; break; } e.arrT = 5.5; e.st.stun = Math.max(e.st.stun, 1.4); let p; if (D.phase === 1) { p = gkPos(D, e, 0); p.x = Math.max(p.x, e.x - 450); } else { const M = D.maze, [ci, cj] = M.cell(e.x, e.y), bk = M.nbs(ci, cj).filter(([a2, b2]) => M.dist[a2][b2] > M.dist[ci][cj])[0]; p = bk ? M.cen(bk[0], bk[1]) : M.cen(ci, cj); } e.x = p.x + rnd(-30, 30); e.y = p.y + rnd(-30, 30); ui.pop(P3(e, 4), '🚔 체포!', '#ffd0a0', true); vfx.ring(P3(e), { r0: .5, r1: 6, dur: .6, color: 0xffb830 }); if (e === me) { ui.flash('#ffb830', .5, .4); toast(e, '🚔 체포되어 뒤로 끌려갔다!'); } break;
    }
  }
  if (D.phase === 1) {
    const b = D.boss;
    if (!D.open && b.hp <= 0) { D.open = true; ui.pop(P3(b, 4), '각성 전 골드치즈 격파!', '#fff0a8', true); vfx.column(P3({ x: D.door.x, y: D.door.y, realm: 1 }), { r: 4, h: 40, dur: 99, color: 0xffe27a, alpha: .6 }); D.decs.push(vfx.decal(P3({ x: D.door.x, y: D.door.y, realm: 1 }), { tex: 'ring', r: D.door.r * S, color: 0xffe27a, alpha: .95, y: .12 })); if (D.vs.includes(me)) toast(me, '🔱 피라미드의 문이 열렸다! 마지팬맛 쿠키를 피해 문으로 가세요'); }
    for (const e of D.vs) {
      e.gkMv = null; if (e.ctrl.kind !== 'ai' || e.minion) continue;
      if (D.open) { const a = Math.atan2(D.door.y - e.y, D.door.x - e.x); e.gkMv = gkAvoid(D, e, Math.cos(a), Math.sin(a)); } else if (b.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) > 420) { const a = Math.atan2(b.y - e.y, b.x - e.x); e.gkMv = gkAvoid(D, e, Math.cos(a), Math.sin(a)); }
    }
    if (D.open && D.vs.some(e => Math.hypot(e.x - D.door.x, e.y - D.door.y) < D.door.r)) gkPhase2(D);
  } else {
    D.t2 += dt; const M = D.maze;
    for (const e of D.vs.slice()) {
      e.gkMv = null; if (Math.hypot(e.x - M.exit.x, e.y - M.exit.y) < 120) { gkExit(D, e, 'esc'); continue; }
      if (e.ctrl.kind === 'ai' && !e.minion) {
        if (!e.gkT || Math.hypot(e.gkT.x - e.x, e.gkT.y - e.y) < 55) {   // 길찾기: 칸 중앙선을 맞춘 뒤 다음 칸 중앙으로
          const [i, j] = M.cell(e.x, e.y), nx = M.nbs(i, j).filter(([a2, b2]) => M.dist[a2][b2] < M.dist[i][j]).sort((p, q) => M.dist[p[0]][p[1]] - M.dist[q[0]][q[1]])[0], cc = M.cen(i, j);
          if (!nx) e.gkT = M.exit; else { const tc = M.cen(nx[0], nx[1]), horiz = nx[0] !== i; e.gkT = (horiz ? Math.abs(e.y - cc.y) > 50 : Math.abs(e.x - cc.x) > 50) ? (horiz ? { x: e.x, y: cc.y } : { x: cc.x, y: e.y }) : tc; }
        }
        const a = Math.atan2(e.gkT.y - e.y, e.gkT.x - e.x); e.gkMv = { mx: Math.cos(a), my: Math.sin(a) };
      }
    }
    if (!D.vs.length) return endGk(true);
  }
}
function updGoldA(dt) {
  if (B.gfalls) {
    for (const w of B.gfalls) {
      w.t += dt; const fin = Math.min(1, w.t / .9), fout = w.t > w.dur - 1.4 ? Math.max(0, (w.dur - w.t) / 1.4) : 1, k = fin * fout;
      w.pool.material.opacity = .85 * k; w.col.material.opacity = .62 * k; w.top.material.opacity = .9 * k; w.pool.scale.setScalar(.6 + .4 * fin + Math.sin(w.t * 3) * .012); w.col.rotation.y += dt * .4;
      w.rib.forEach(r => { r.position.y -= dt * 24; if (r.position.y < 1) r.position.y = 31; r.material.opacity = .8 * k; });
      if (Math.random() < dt * 8) { const a = rnd(0, 6.283), d = rnd(0, 7); vfx.burst('glow', Wr(w.x, w.y, .6).add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)), 2, { speed: 1.5, speed2: 5, life: .6, size: .9, c0: 0xffffff, c1: CHZ, up: 2 }); }
      w.tick -= dt; if (w.tick <= 0 && w.t < w.dur) { w.tick = .25; for (const t of gaTg(w.owner)) if (Math.hypot(t.x - w.x, t.y - w.y) < w.R + t.r) { hurt(w.owner, t, 200, { quiet: true, field: true }); slowOn(t, .6, .45); t.gcAcc = (t.gcAcc || 0) + 200 * dmgMul(w.owner); if (t.gcAcc >= 1000) { ui.pop(P3(t, 2.8 + rnd(0, 1)), Math.round(t.gcAcc), '#ffd84a', true); t.gcAcc = 0; } } }
      if (w.t >= w.dur) { rmExtra(w.g); w.done = true; }
    }
    B.gfalls = B.gfalls.filter(w => !w.done);
  }
  updGStr(dt);
  for (const f of B.fighters) {
    if (f.def.id !== 'goldA') continue;
    if (f.hp <= 0) { if (f.gcrM) { f.root.remove(f.gcrM); f.gcrM = null; } f.gcr = 0; f.gzch = null; if (f.form === 'sky') endGSky(f); continue; }
    if (f.gcr > 0) { f.gcr -= dt; if (!f.gcrM) f.gcrM = gaWingsAura(f); f.gcrM.rotation.y += dt * 2.2; if (f.gcr <= 0) { f.root.remove(f.gcrM); f.gcrM = null; ui.pop(P3(f, 4), '창조주의 창 종료', '#fff0a8'); } }
    if (f.form === 'sky') { f.air = (f.air || 0) + (12 - (f.air || 0)) * Math.min(1, dt * 2.5); if (!f.skyM) { f.skyM = gaWingsAura(f); f.skyM.scale.setScalar(1.5); } f.skyM.rotation.y += dt * 1.6; if (Math.random() < dt * 10) vfx.emit('glow', { x: P3(f, 1).x + rnd(-2, 2), y: P3(f, 1).y + (f.air || 0) + rnd(-1, 2), z: P3(f, 1).z + rnd(-2, 2), vy: -2, life: .6, s0: .8, s1: 0, c0: 0xffffff, c1: GLD, a: .7, drag: 0 }); }
    const c = f.gzch; if (c) {
      c.t += dt; slowOn(f, .1, .35); const kd = f.ctrl.kind === 'h1' ? !!down.KeyZ : f.ctrl.kind === 'h2' ? !!down.Digit7 : c.t < c.hold, p = P3(f, 1.4);
      if (f.st.stun > 0 || f.st.lock > 0 && c.t < .5) { f.gzch = null; f.cd.z = 6; continue; }
      if (c.t > .4) { f.pose = 'raise'; while (c.sp.length < Math.min(10, Math.floor((c.t - .4) / .15) + 1)) { const a = c.sp.length / 10 * 6.283, m = goldSpear(3, .09); m.position.set(p.x + Math.cos(a) * 3.2, p.y + 7 + (c.sp.length % 3) * .6, p.z + Math.sin(a) * 3.2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)); addExtra(m); c.sp.push(m); } c.sp.forEach((m, i) => { const a = i / 10 * 6.283 + c.t * 2; m.position.x = P3(f).x + Math.cos(a) * 3.2; m.position.z = P3(f).z + Math.sin(a) * 3.2; }); if (Math.random() < dt * 20) vfx.emit('glow', { x: p.x + rnd(-1, 1), y: p.y + rnd(0, 6), z: p.z + rnd(-1, 1), life: .5, s0: .9, s1: 0, c0: 0xffffff, c1: GLD, a: .8, drag: 0 }); }
      if (!kd || c.t >= 2.2) {
        f.gzch = null; f.pose = null; c.sp.forEach(m => rmExtra(m));
        if (c.t < .4) { const tx = clamp(c.p.x, PAD, W - PAD), ty = clamp(c.p.y, PAD, H - PAD), d = Math.hypot(tx - f.x, ty - f.y), k = d > 900 ? 900 / d : 1; setAnim(f, 'cast', .5); startFalls(f, f.x + (tx - f.x) * k, f.y + (ty - f.y) * k); f.cd.z = 18; }
        else if (gaStrike(f) === false) f.cd.z = 4; else { setAnim(f, 'slash', .5); f.cd.z = 22; }
      }
    }
  }
}
CHARS.goldA = {
  id: 'goldA', base: 'gold', name: '각성 골드치즈 쿠키', color: GLD, fx: GLD, cost: 0, hp: 21000, shield: 5000, pref: 4.4, atkRange: 640, aiPref: 360, ult: { need: 9000 },
  tag: '각성 · 창조주의 창 · 치즈폭포 · 금빛 하늘의 벌 · 창조주의 포위 · 가상의 골드치즈 왕국',
  skills: {
    base: {
      a: { name: '금빛 창 삼연', cd: .9, desc: '창 3개를 던진다 (총 1500)', use(f) { setAnim(f, 'cast', .25); const cr = f.gcr > 0; for (const o of [-1, 0, 1]) shoot(f, { a: f.face + o * .03, x: f.x - Math.sin(f.face) * o * 34, y: f.y + Math.cos(f.face) * o * 34, sp: 1000, r: 20, dmg: cr ? 750 : 500, color: GLD, kind: 'gspear', life: 1.4, homing: cr ? 1500 : 0, turn: cr ? 5.5 : 0, sbreak: cr }); } },
      z: { name: '치즈폭포 / 금빛 창 (꾹 누르기)', cd: 18, desc: '짧게: 흘러내리는 치즈폭포 25초(맵 일부가 끈적한 치즈로 덮여 슬로우, 총 20000). 꾹 눌러 차징: 하늘의 금빛 창이 속박하고 치즈 덩어리가 떨어져 일시 봉인 (총 5000)', use(f, p) { if (f.gzch) return false; f.gzch = { t: 0, p: { x: p.x, y: p.y }, sp: [], hold: Math.random() < .5 ? .15 : 1.3 }; setAnim(f, 'cast', .3); return 'nocd'; } },
      x: { name: '창조주의 창', cd: 30, desc: '15초 동안 평타가 유도탄이 되고, 상대의 보호막을 완전히 깨서 흡수하며, 평타 데미지가 1.5배', use(f) { f.gcr = 15; setAnim(f, 'cast', .5); ui.flash('#ffe27a', .4, .4); vfx.ring(P3(f), { r0: .5, r1: 14, dur: .8, color: GLD }); ui.pop(P3(f, 4.6), '🔱 창조주의 창!', '#fff0a8', true); } },
      c: { name: '하늘로', cd: 35, desc: '10초 동안 하늘로 올라간다. 이때는 Z 스킬만 쓸 수 있고 쿨타임이 짧아지며, 금빛 하늘의 벌(창 비, 한 번에 2000)로 바뀐다', use(f) { if (f.form !== 'base') return false; f.skyZ = f.cd.z; f.cd.z = 0; f.form = 'sky'; f.formT = 10; setAnim(f, 'cast', .6); f.st.inv = Math.max(f.st.inv, .5); ui.flash('#ffe27a', .4, .4); vfx.ring(P3(f), { r0: .5, r1: 16, dur: .8, color: GLD }); vfx.burst('glow', P3(f, 1.4), 40, { speed: 3, speed2: 12, life: .9, size: 1, c0: 0xffffff, c1: GLD, up: 6 }); ui.pop(P3(f, 5), '☁ 하늘로!', '#fff0a8', true); } },
      v: { name: '창조주의 포위', cd: 70, desc: '[컷신] 하늘 위로 올라가 무수한 금빛 창을 소환해 적 한 명마다 빙 둘러싸고, 컷신이 끝나면 창들이 일제히 공격한다. 적당 10000', use(f) { return startGSiege(f); } },
      q: { name: '날개 돌진', cd: 3, desc: '날개로 빠르게 날아가며 창으로 찌른다 200', use(f, p) {
        const a = ang(f, p); f.face = a; setAnim(f, 'slash', .3); const hit = new Set();
        act(f, .3, (u, dt) => { f.x = clamp(f.x + Math.cos(a) * 2700 * dt, PAD, W - PAD); f.y = clamp(f.y + Math.sin(a) * 2700 * dt, PAD, H - PAD); const w = P3(f, 1.2); vfx.emit('glow', { x: w.x, y: w.y, z: w.z, life: .45, s0: 1.4, s1: 0, c0: 0xffffff, c1: GLD, a: .8, drag: 0 }); for (const t of gaTg(f)) if (!hit.has(t) && dist(f, t) < f.r + t.r + 80) { hit.add(t); hurt(f, t, 200, { dir: a }); vfx.burst('spark', P3(t, 1.2), 12, { speed: 6, speed2: 14, life: .35, size: .5, c0: 0xffffff, c1: GLD }); } });
      } },
      r: { name: '가상의 골드치즈 왕국', cd: 0, desc: '(게이지 100%) 모든 적을 가상의 골드치즈 왕국으로 보낸다. 오류 디버프, 각성 전 골드치즈(HP 10000), 쏟아지는 마지팬맛 쿠키를 피해 피라미드의 미로를 탈출해야 한다', use(f) { return startGK(f); } },
    },
    sky: {
      a: { name: '-', cd: 1, desc: '하늘에서는 Z 만 사용', use() { return false; } },
      z: { name: '금빛 하늘의 벌', cd: 1.6, desc: '하늘에서 많은 금빛 창을 떨어뜨린다. 한 번에 2000', use(f, p) { gaSkyRain(f, p); } },
      x: { name: '-', cd: 1, desc: '', use() { return false; } }, c: { name: '-', cd: 1, desc: '', use() { return false; } }, v: { name: '-', cd: 1, desc: '', use() { return false; } }, q: { name: '-', cd: 1, desc: '', use() { return false; } },
      r: { name: '하강', cd: 1, desc: '땅으로 내려온다', use(f) { endGSky(f); } },
    }
  }
};
CHARS.gold.awakeId = 'goldA';
/* ===== 각성 미스틱플라워 쿠키 (id 'mysticA', HP 25000 임시) ===== */
const SILK = 0xf4eed8, VD_R = 430, MA_BEAST_R = 650;
const stubSk = n => ({ name: n, cd: 1, desc: '(준비 중 — 스펙 대기)', use() { return false; } });
const maTeam = f => { if (f.team === undefined) f.team = 100 + B.fighters.indexOf(f); };
const maHostEnemy = f => !!f.att && !ally(f, f.att);
function silkShot(f) {
  setAnim(f, 'cast', .25);
  shoot(f, { a: f.face, sp: 900, r: 20, dmg: 150, color: SILK, kind: 'silk', life: 1.4, onHit: t => {
    slowOn(t, 2.5, .55);
    if (!(t.def.id === 'pva' || t.def.id === 'mystic' || t.def.id === 'mysticA')) { if (!(t.silkT > 0)) ui.pop(P3(t, 3.6), '🕸 실에 감겼다! 쿨타임 감소', '#f4eed8'); t.silkT = 4; maStack(t, f); }
  } });
}
/* --- 공허의 스택 10 → 고치(10초) → 거미(15초, 통제권 상실) --- */
function maStack(t, src) {
  if (t.hp <= 0 || t.minion || t.enc || t.spd || t.cocoon) return;
  t.vst = (t.vst || 0) + 1; ui.pop(P3(t, 4.2), '🕳 공허 ×' + t.vst, '#d8c8ff');
  if (t.vst >= 10) {
    t.vst = 0; const m = buildCocoon(); m.position.set(0, 0, 0); t.root.add(m); t.enc = { t: 10, mesh: m, by: src }; t.st.stun = Math.max(t.st.stun, 10);
    vfx.burst('spark', P3(t, 1.2), 40, { speed: 4, speed2: 12, life: .8, size: .5, c0: 0xffffff, c1: 0xb8b8c8 }); ui.pop(P3(t, 4.8), '🕸 고치에 갇혔다!', '#f4eed8', true);
  }
}
function maEncEnd(t, brk) {
  const e = t.enc; if (!e) return; t.root.remove(e.mesh); t.enc = null; if (brk || t.hp <= 0) return;
  const m = buildSpider(); m.scale.setScalar(.7); t.root.add(m); t.spiderM = m; t.spd = { t: 15, m, by: e.by }; t.st.stun = 0; t.st.charmS = 15;
  vfx.burst('glow', P3(t, 1.2), 50, { speed: 4, speed2: 14, life: 1, size: .9, c0: 0xffffff, c1: 0x7a4aff }); ui.pop(P3(t, 4.8), '🕷 거미가 되었다! 통제권 상실', '#e0d0ff', true);
}
/* --- 만두 사대천왕 동상 --- */
CHARS.mob_mandu = mobDef('mob_mandu', '만두 사대천왕 동상', 0xffe066, 12000, '미스틱플라워의 동상 · 빙의 가능 (스킬 미정)', {
  a: { name: '만두 던지기', cd: 1.6, desc: '(임시) 200', use(f) { setAnim(f, 'cast', .25); shoot(f, { a: f.face, sp: 520, r: 16, dmg: 200, color: 0xffe066, life: 1.2 }); } },
}, { range: 520, pref: 400 });
function maStatues(f) {
  maTeam(f); const bx = f.x < W / 2 ? clamp(f.x - 260, PAD + 60, W - PAD) : clamp(f.x + 260, PAD, W - PAD - 60);
  for (let i = 0; i < 4; i++) { const m = addMinion('mob_mandu', bx, clamp(f.y + (i - 1.5) * 150, PAD + 60, H - PAD - 60), { hp: 12000, big: 1.5, rooted: true, realm: f.realm }); m.team = f.team; m.statue = true; m.statueOf = f; }
  ui.pop(P3(f, 4.6), '🗿 만두 사대천왕의 동상!', '#ffe066', true);
}
/* --- 안개이동 / 붙기 --- */
function maDetach(f) {
  const was = f.att || f.fog; f.att = null; f.fog = null; f.hidden = false; f.rooted = false; f.st.inv = Math.max(f.st.inv, .5);
  if (was) { vfx.burst('glow', P3(f, 1.2), 30, { speed: 3, speed2: 9, life: .8, size: 1, c0: 0xffffff, c1: 0x9a6aff }); ui.pop(P3(f, 3.8), '☁ 안개가 걷힌다', '#e0d0ff'); }
}
function maZ(f, p) {
  if (f.att || f.fog) { maDetach(f); f.cd.z = 3; return 'nocd'; }
  maTeam(f); let best = null, bd = 1e18;
  for (const o of B.fighters) { if (o === f || o.hp <= 0 || realmOf(o) !== realmOf(f) || o.cocoon || o.enc) continue; const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2; if (d < bd) { bd = d; best = o; } }
  if (!best) { toast(f, '들러붙을 대상이 없습니다'); return false; }
  f.fog = { tg: best }; f.cd.z = 1; ui.pop(P3(f, 3.8), '☁ 안개 이동', '#e0d0ff'); vfx.burst('glow', P3(f, 1.2), 40, { speed: 4, speed2: 12, life: 1, size: 1.2, c0: 0xffffff, c1: 0xb8a8ff }); return 'nocd';
}
/* --- X 고치수행 --- */
function maCocoon(f) {
  const al = B.fighters.filter(o => o.hp > 0 && !o.minion && (o === f || ally(f, o)) && realmOf(o) === realmOf(f)), tg = al[(f.cocIdx || 0) % al.length];
  if (!tg || tg.cocoon || tg.enc) { toast(f, '이미 고치 안에 있습니다'); return false; }
  const m = buildCocoon(); m.position.set(0, 0, 0); tg.root.add(m); tg.cocoon = { hp: 10000, max: 10000, mesh: m, heal: 10000, healed: 0, by: f };
  vfx.burst('spark', P3(tg, 1.2), 30, { speed: 4, speed2: 10, life: .7, size: .5, c0: 0xffffff, c1: 0xb8b8c8 }); ui.pop(P3(tg, 4.2), '🕸 고치수행!', '#f4eed8', true);
  f.cd.x = 40; return 'nocd';
}
/* --- C 공허의 바람 --- */
function maWind(f) {
  setAnim(f, 'cast', .5); breakTerrain(f.x, f.y, 620);
  const c = P3(f); for (let i = 0; i < 3; i++) vfx.ring(c, { r0: 1, r1: 620 * S * (.6 + i * .25), dur: .7 + i * .15, color: i % 2 ? 0xffffff : 0xb8a8ff }); vfx.burst('glow', P3(f, 1), 80, { speed: 8, speed2: 26, life: 1.2, size: 1.2, c0: 0xf4eed8, c1: 0x9a6aff, flat: true }); shake(.8, .5);
  for (const o of mAllies(f)) mHeal(o, 2500);
  let n = 0; const hs = o => o && o !== f && !ally(f, o);
  for (const k of ['lakes', 'hexes', 'barriers', 'lights']) for (const s of B[k]) if (hs(s.owner) && realmOf(s.owner) === realmOf(f) && Math.hypot(f.x - s.x, f.y - s.y) < 620 + (s.r || 0)) { s.owner = f; n++; }
  for (const o of B.fighters) if (hs(o) && o.hp > 0 && realmOf(o) === realmOf(f)) { if (o.ldom && !f.ldom) { f.ldom = o.ldom; o.ldom = null; n++; } if (o.veil && !f.veil) { f.veil = o.veil; o.veil = null; n++; } }
  ui.pop(P3(f, 4.4), n ? '🌪 공허의 바람! 영역 통제권 탈취 ×' + n : '🌪 공허의 바람!', '#e0d0ff', true);
  f.cd.c = 30; return 'nocd';
}
/* --- V 안개몽환진 몽무미경 --- */
function maFog(f) {
  if (B.fogA) { toast(f, '이미 안개가 껴 있습니다'); return false; }
  B.fogA = { owner: f, t: 0, dur: 25, armT: 1, giT: 2.5, d0: world.scene.fog ? world.scene.fog.density : 0 }; B.armM = B.armM || [];
  setAnim(f, 'cast', .7); ui.flash('#e8e8f4', .6, .6); shake(.7, .5); ui.pop(P3(f, 4.6), '🌫 안개몽환진 · 몽무미경', '#f4f0ff', true); toast(f, '맵 전체에 안개가 낀다 (25초): 나는 다 보이고 적은 시야 방해 / 밀가루 팔이 솟아 스턴·슬로우·피해 / 거대한 밀가루 팔 1000');
  f.cd.v = 60; return 'nocd';
}
function endFogA() { const G = B.fogA; if (!G) return; if (world.scene.fog) world.scene.fog.density = G.d0; B.fogA = null; }
function maArmMesh(big) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xfaf6ea, roughness: 1, emissive: 0x6a6658, emissiveIntensity: .25 });
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.55, .75, 12, 8), m); arm.position.y = 6; g.add(arm);
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), m); palm.scale.set(1.2, .5, 1); palm.position.y = 0; g.add(palm);
  for (let i = 0; i < 5; i++) { const a = (i - 2) * .5, fg = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, 1.5, 6), m); fg.position.set(Math.sin(a) * 1.1, -.5, Math.cos(a) * .3); fg.rotation.z = -a * .5; g.add(fg); }
  g.scale.setScalar(big ? 2 : .8); return g;
}
function maArm(f, x, y, big) {
  zone(f, { x, y, r: big ? 200 : 85, delay: big ? 1 : .8, dmg: big ? 1000 : 300, color: 0xf4eed8, onHit: t => { if (!big) { t.st.stun = Math.max(t.st.stun, 1); slowOn(t, 3, .5); } else t.st.stun = Math.max(t.st.stun, .6); } });
  const m = maArmMesh(big); m.position.copy(P3({ x, y, realm: f.realm }, 16)); world.scene.add(m); (B.armM = B.armM || []).push({ m, p: P3({ x, y, realm: f.realm }), t: 0, delay: big ? 1 : .8 });
}
function maControl(f) {
  const e = f.att; if (!e || immune(e)) { ui.pop(P3(e || f, 3.4), '저항!', '#9fb8ff'); return false; }
  setAnim(f, 'cast', .4); f.cast = { type: 'control', t: 0, dur: 10, fx: 0 }; e.st.ctl = 10; e.ctlBy = f; ui.pop(P3(e, 3.4), '🧠 조종 (10초)', '#9fb8ff'); ui.flash('#3a5bff', .4, .3); f.cd.v = 40; return 'nocd';
}
/* --- 죽으면: 공허의 고치(60000, 이동 불가, 중앙) → 마지막으로 대왕거미 --- */
function startVoidCocoon(t) {
  t.beastUsed = true; maDomOff(t); t.att = null; t.fog = null; t.hidden = false; if (B.fogA && B.fogA.owner === t) endFogA();
  t.form = 'beast'; t.formT = 1e9; t.max = 60000; t.hp = 60000; t.shield = 0; t.shieldMax = 0; t.big = 3.4; t.r = 22 * 3.4; clearStates(t); t.rooted = true; t.hidden = false; t.x = W / 2; t.y = H / 2; t.bsT = 0; t.bz1 = 6; t.bz2 = 9;
  for (const k of ['stun', 'silence', 'slow', 'lock', 'rev', 'charm', 'charmS', 'ctl', 'cdfreeze']) t.st[k] = 0; t.st.inv = 1.5; t.flash = 0; t.silkT = 0; for (const k in t.cd) t.cd[k] = 0;
  if (t.cocoon) { t.root.remove(t.cocoon.mesh); t.cocoon = null; }
  const p = P3(t, 1.4);
  vfx.burst('glow', p, 110, { speed: 5, speed2: 22, life: 1.2, life2: 2, size: 1.4, c0: 0xffffff, c1: 0x9a6aff, up: 3 }); vfx.burst('spark', p, 80, { speed: 8, speed2: 24, life: 1, size: .8, c0: 0xf4eed8, c1: 0x7a4aff, grav: 3 });
  for (let i = 0; i < 3; i++) vfx.ring(P3(t), { r0: .5, r1: 10 + i * 6, dur: .7 + i * .2, color: i % 2 ? 0xf4eed8 : 0x9a6aff }); vfx.column(P3(t), { r: 3.2, h: 40, dur: 1.4, color: 0x9a6aff, alpha: .8 });
  ui.flash('#9a6aff', .8, .6); shake(1.4, .8); ui.pop(P3(t, 7), '🕸 공허의 고치!', '#e0d0ff', true); toast(t, '거대한 공허의 고치가 되었다! (체력 60000 · 이동 불가 · 중앙 고정) 만두 사대천왕이 깨어난다');
  for (const m of B.fighters) if (m.statueOf === t && m.hp > 0) { m.statue = false; m.rooted = false; m.pm = 1.2; ui.pop(P3(m, 3.4), '🗿 동상이 깨어났다!', '#ffe066', true); vfx.ring(P3(m), { r0: .5, r1: 8, dur: .6, color: 0xffe066 }); }
}
function startSpiderKing(t) {
  t.kingUsed = true; t.form = 'king'; t.formT = 1e9; t.max = 30000; t.hp = 30000; t.shield = 0; t.shieldMax = 0; t.big = 2.2; t.r = 22 * 2.2; clearStates(t); t.rooted = false;
  for (const k in t.cd) t.cd[k] = 0; t.st.inv = 1.5; const m = buildSpider(); t.root.add(m); t.spiderM = m;
  const p = P3(t, 1.4); vfx.burst('glow', p, 120, { speed: 6, speed2: 24, life: 1.2, life2: 2, size: 1.5, c0: 0xffffff, c1: 0x7a4aff, up: 3 }); for (let i = 0; i < 3; i++) vfx.ring(P3(t), { r0: .5, r1: 12 + i * 6, dur: .7 + i * .2, color: i % 2 ? 0xf4eed8 : 0xff4060 });
  ui.flash('#ff4060', .7, .6); shake(1.6, .9); ui.pop(P3(t, 6), '🕷 대왕거미 부활!', '#ffb0c0', true); toast(t, '마지막으로 대왕거미로 부활했습니다! (체력 30000)');
}
/* --- 매 프레임 --- */
function maDomOff(f) { if (f.vdm) { world.scene.remove(f.vdm.dome); vfx.remove(f.vdm.ring); f.vdm = null; } }
function updMA(dt) {
  if (!B) return; const me = B.fighters[0]; if (B.maTint === undefined) B.maTint = '';
  for (const t of B.fighters) {
    if (t.enc) { t.enc.t -= dt; t.st.stun = Math.max(t.st.stun, .2); if (t.hp <= 0) maEncEnd(t, true); else if (t.enc.t <= 0) maEncEnd(t, false); }
    if (t.spd) { t.spd.t -= dt; t.st.charmS = Math.max(t.st.charmS, .2); if (t.spd.t <= 0 || t.hp <= 0) { t.root.remove(t.spd.m); if (t.spiderM === t.spd.m) t.spiderM = null; t.spd = null; t.st.charmS = 0; } }
    const c = t.cocoon; if (c && c.by && c.heal) { t.st.stun = Math.max(t.st.stun, .3); const h = Math.min(c.heal - c.healed, 1000 * dt); mHeal(t, h, true); c.healed += h; c.acc = (c.acc || 0) + dt; if (c.acc >= 1) { c.acc = 0; ui.pop(P3(t, 3.4), '+1000', '#7dff9b'); } if (c.healed >= c.heal - .01) cocoonBreak(t); }
    if (t.whiteT > 0) t.whiteT -= dt;
  }
  for (const f of B.fighters) if (f.def.id === 'mysticA') updMAf(f, dt);
  const G = B.fogA; if (G) {
    const f = G.owner; G.t += dt;
    if (G.t >= G.dur || f.hp <= 0 || f.form !== 'base') endFogA();
    else {
      for (let i = 0; i < 4; i++) vfx.emit('glow', { x: rnd(-W / 2, W / 2) * S, y: rnd(.5, 5), z: rnd(-H / 2, H / 2) * S, vx: rnd(-1, 1), vy: 0, vz: rnd(-1, 1), life: 2, s0: 7, s1: 11, c0: 0xffffff, c1: 0xe0e0f0, a: .1, drag: 0 });
      const blind = me && me !== f && !ally(f, me); if (world.scene.fog) world.scene.fog.density = blind ? .03 : G.d0;
      G.armT -= dt; if (G.armT <= 0) { G.armT = 1.6; const es = B.fighters.filter(o => o.hp > 0 && o !== f && !ally(f, o) && realmOf(o) === realmOf(f) && !o.minion); if (es.length) { const o = es[Math.floor(Math.random() * es.length)]; maArm(f, clamp(o.x + rnd(-90, 90), PAD, W - PAD), clamp(o.y + rnd(-90, 90), PAD, H - PAD), false); } }
      G.giT -= dt; if (G.giT <= 0) { G.giT = 4; const e = foe(f); if (e && e !== B.ghost) maArm(f, e.x, e.y, true); }
    }
  }
  if (B.armM && B.armM.length) { for (const a of B.armM) { a.t += dt; const u = Math.min(1, a.t / a.delay); a.m.position.set(a.p.x, 16 * (1 - u * u) + .2, a.p.z); if (a.t > a.delay + .5) { world.scene.remove(a.m); a.dead = true; } } B.armM = B.armM.filter(a => !a.dead); }
  let want = '';
  if (me && me.whiteT > 0) want = 'rgba(255,255,255,.96)';
  else if (B.fogA && me && me !== B.fogA.owner && !ally(B.fogA.owner, me)) want = 'rgba(235,235,245,.5)';
  else if (me && me.bseen > B.time) want = 'rgba(150,130,190,.4)';
  if (want !== B.maTint) { B.maTint = want; ui.tint(want); }
}
function updMAf(f, dt) {
  if (f.hp <= 0 || f.form !== 'base' || f.pseal > 0) {
    maDomOff(f);
    if (f.hp > 0 && f.form === 'beast') {   // 공허의 고치: 10초마다 보호막 +1000, 주위 적에게 슬로우·스킬 실패 60%·시야 방해·z 디버프
      f.bsT = (f.bsT || 0) + dt; if (f.bsT >= 10) { f.bsT -= 10; f.shield += 1000; f.shieldMax = Math.max(f.shieldMax, f.shield); ui.pop(P3(f, 7), '🛡 +1000', '#e0d0ff'); }
      f.bz1 -= dt; f.bz2 -= dt; const z1 = f.bz1 <= 0, z2 = f.bz2 <= 0; if (z1) f.bz1 = 12; if (z2) f.bz2 = 15;
      for (const o of B.fighters) if (o !== f && o.hp > 0 && !ally(f, o) && realmOf(o) === realmOf(f) && Math.hypot(o.x - f.x, o.y - f.y) < MA_BEAST_R + o.r) {
        slowOn(o, .3, .45); o.vdIn = B.time + .3; o.vdFail = .6; o.bseen = B.time + .3;
        if (z1) { o.whiteT = Math.max(o.whiteT || 0, 4); ui.pop(P3(o, 3.6), '☁ 시야 차단', '#ffffff'); }
        if (z2) { o.st.charmS = Math.max(o.st.charmS, 4); ui.pop(P3(o, 3.6), '🌀 아군이 적으로 보인다', '#e0d0ff'); }
      }
      if (Math.random() < .5) { const a = rnd(0, 6.283), rr = rnd(.3, 1) * MA_BEAST_R * S, pp = P3(f); vfx.emit('glow', { x: pp.x + Math.cos(a) * rr, y: rnd(.3, 3), z: pp.z + Math.sin(a) * rr, vy: rnd(1, 3), life: 1.2, s0: .8, s1: 1.6, c0: 0xffffff, c1: 0x9a6aff, a: .3, drag: 0 }); }
    }
    return;
  }
  if (!f.stat0) { f.stat0 = true; maTeam(f); if (!f.minion) maStatues(f); }
  if (f.ctrl.kind !== 'ai') {
    const k = !!down.KeyE;
    if (k && !f._e) { f.cocIdx = (f.cocIdx || 0) + 1; const al = B.fighters.filter(o => o.hp > 0 && !o.minion && (o === f || ally(f, o))), tg = al[f.cocIdx % al.length]; toast(f, '고치수행 대상: ' + (tg === f ? '나' : tg.def.name)); }
    f._e = k;
  }
  if (f.fog) {
    const tg = f.fog.tg;
    if (tg.hp <= 0) maDetach(f);
    else {
      const dx = tg.x - f.x, dy = tg.y - f.y, d = Math.hypot(dx, dy);
      if (d < tg.r + 25) { f.att = tg; f.fog = null; f.attT = 0; vfx.ring(P3(tg), { r0: .5, r1: 6, dur: .6, color: 0x9a6aff }); ui.pop(P3(tg, 4), ally(f, tg) ? '☁ 아군에게 붙었다 (5초마다 +2000)' : tg.statueOf === f ? '🗿 동상에 빙의!' : '☁ 적에게 들러붙었다!', '#e0d0ff', true); }
      else { const s = Math.min(d, 800 * dt); f.x += dx / d * s; f.y += dy / d * s; }
      if (Math.random() < .8) { const pp = P3(f); vfx.emit('glow', { x: pp.x, y: rnd(.5, 2), z: pp.z, vy: rnd(1, 3), life: .8, s0: 1.2, s1: 2.4, c0: 0xffffff, c1: 0xb8a8ff, a: .4, drag: 0 }); }
    }
  } else if (f.att) {
    const h = f.att;
    if (h.hp <= 0) maDetach(f);
    else { f.x = h.x; f.y = h.y; f.attT = (f.attT || 0) + dt; if (!maHostEnemy(f) && f.attT >= 5) { f.attT -= 5; mHeal(h, 2000); } }
  }
  if (f.fog || f.att) { f.st.inv = Math.max(f.st.inv, .2); f.hidden = true; f.rooted = true; }
  if (f.fog) { maDomOff(f); return; }   // 안개로 변해 있는 동안은 공허의 영역이 발동하지 않는다
  if (!f.vdm) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1b1233, transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide }));
    dome.scale.setScalar(VD_R * S); dome.renderOrder = 4; world.scene.add(dome);
    f.vdm = { dome, ring: vfx.decal(P3(f), { tex: 'ring', r: VD_R * S, color: 0x9a6aff, alpha: .8, y: .07 }) };
  }
  const p = P3(f); f.vdm.dome.position.set(p.x, 0, p.z); f.vdm.ring.obj.position.set(p.x, f.vdm.ring.obj.position.y, p.z);
  const ins = B.fighters.filter(o => o.hp > 0 && realmOf(o) === realmOf(f) && Math.hypot(o.x - f.x, o.y - f.y) < VD_R + o.r), al = ins.filter(o => o === f || ally(f, o)), en = ins.filter(o => o !== f && !ally(f, o));
  const me = B.fighters[0]; f.vdm.dome.material.opacity = me && ins.includes(me) ? .1 : .88;
  f.vdAcc = (f.vdAcc || 0) + dt; if (f.vdAcc >= 1) { f.vdAcc -= 1; const n = al.length + en.length; for (const o of al) mHeal(o, 500 * n); }
  for (const o of en) {
    o.vdIn = B.time + .25; o.vdFail = .3; o.vdT = (o.vdT || 0) + dt;
    const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1; if (!o.rooted && d > f.r + o.r + 10) { o.x += dx / d * 85 * dt; o.y += dy / d * 85 * dt; }
    if (o.vdT >= 7) { o.vdT = 0; let any = false; for (const k in o.cd) { const sk = o.def.skills[o.form] && o.def.skills[o.form][k]; if (k !== 'a' && sk && o.cd[k] > 0) { o.cd[k] = sk.cd; any = true; } } if (any) ui.pop(P3(o, 3.8), '🕳 쿨타임이 처음으로!', '#d8c8ff'); }
  }
}
CHARS.mysticA = {
  id: 'mysticA', base: 'mystic', name: '각성 미스틱플라워 쿠키', color: MYS, fx: LOTUS, cost: 0, hp: 25000, pref: 4.2, atkRange: 640, aiPref: 400,
  tag: '각성 · 공허의 영역 · 안개 · 고치 · 만두 사대천왕',
  passive: '[공허의 영역] 나를 따라다니는 영역: 밖에서는 안이 보이지 않는다. 영역 안 아군·나는 초당 500×(안의 아군수+적수) 회복. 안의 적은 끌려와 빠져나가기 어렵고, 스킬이 늦게 나가며(30% 실패) 쿨타임이 주기적으로 처음으로 돌아간다. 안개로 변한 동안은 발동 안 함. 시작 시 만두 사대천왕 동상 4개. 죽으면 공허의 고치(60000, 중앙 고정) → 죽으면 대왕거미로 마지막 부활. 정신계·디버프 면역.',
  skills: {
    base: {
      a: { name: '고치의 실', cd: .7, desc: '고치의 실 150 + 느려짐 + 쿨타임 느려짐. 맞은 적에게 공허 스택 +1 (10스택이면 고치에 10초 갇혔다가 거미가 되어 15초간 통제권을 잃고 자기 팀을 공격)', use(f) { silkShot(f); } },
      z: { name: '안개이동', cd: 1, desc: '안개로 변해 적/아군/동상에 들러붙는다 (마우스 근처 대상). 적에게 붙으면 X·C·V 가 시야 차단·혼동·조종으로 바뀐다. 아군에게 붙으면 5초마다 2000 회복. 동상에 붙으면 빙의. 다시 누르면 떨어진다', use(f, p) { return maZ(f, p); } },
      x: { name: '고치수행 / 시야 차단', cd: 1, desc: '[고치수행] 아군(나 포함)을 체력 10000의 고치에 가둬 10초간 10000 회복. 대상은 E 키로 변경. 고치가 부서지거나 끝나면 거미 등장 / [붙은 상태] 상대 시야를 6초간 하얗게', use(f) { if (maHostEnemy(f)) { const e = f.att; e.whiteT = 6; ui.pop(P3(e, 3.6), '☁ 시야 차단', '#ffffff', true); f.cd.x = 16; return 'nocd'; } if (f.fog) return false; return maCocoon(f); } },
      c: { name: '공허의 바람 / 혼동', cd: 1, desc: '[공허의 바람] 주위 지형을 가루로 만들고 아군과 나를 2500 회복, 상대 영역(호수·마법진·장막 등)의 통제권을 가져온다 / [붙은 상태] 8초간 상대가 적을 아군으로, 아군을 적으로 보며 실제로 때린다', use(f) { if (maHostEnemy(f)) { const e = f.att; e.st.charmS = Math.max(e.st.charmS, 8); ui.pop(P3(e, 3.6), '🌀 혼동', '#e0d0ff', true); f.cd.c = 25; return 'nocd'; } if (f.fog) return false; return maWind(f); } },
      v: { name: '안개몽환진 몽무미경 / 조종', cd: 1, desc: '[몽무미경] 맵 전체에 25초간 안개. 나는 다 보이고 적은 시야 방해, 밀가루 팔이 솟아 스턴·슬로우·피해, 거대 밀가루 팔 1000 / [붙은 상태] 상대를 10초간 조종', use(f) { if (maHostEnemy(f)) return maControl(f); if (f.fog) return false; return maFog(f); } },
    },
    beast: { a: { name: '고치의 실', cd: .7, desc: '고치의 실 150', use(f) { silkShot(f); } }, z: stubSk('준비 중'), x: stubSk('준비 중'), c: stubSk('준비 중'), v: stubSk('준비 중') },
    king: { a: { name: '거미줄', cd: .7, desc: '고치의 실 150', use(f) { silkShot(f); } }, z: { name: '독니', cd: 3, desc: '(임시) 근접 600', use(f) { setAnim(f, 'slash', .25); swing(f, 220, 1.3, 600, 0xd08cff); } }, x: stubSk('준비 중'), c: stubSk('준비 중'), v: stubSk('준비 중') },
  }
};
CHARS.mystic.awakeId = 'mysticA';
const ORDER = ['silent', 'lich', 'shadow', 'sugar', 'dark', 'pv', 'burn', 'lily', 'dkk', 'brave', 'mystic', 'gold', 'berry', 'timekeeper', 'pitaya', 'ananas'];

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
        f.form = 'dragon'; f.formT = 25; f.max = (f.def.dragon && f.def.dragon.hp) || 52000; f.hp = ratio * f.max; f.dragonPop = 0;
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
  if (f.form === 'sky') { endGSky(f); return; }
  if (f.form === 'pdragon') { endPDragon(f, true); return; }
  if (f.form === 'angel') { endArchangel(f); return; }
  const ratio = f.hp / f.max; f.form = 'base'; f.formT = 0; f.max = f.def.hp; f.hp = Math.max(1, ratio * f.max); if (f.def.id === 'lichA') f.cd.e = 5; else f.cd.v = 40; if (f.breath) endBreath(f);
  const p = P3(f, 1.5); vfx.burst('spark', p, 80, { speed: 6, speed2: 20, life: .8, size: .8, c0: 0xffffff, c1: 0xc46bff }); vfx.ring(P3(f), { r1: 8, color: 0xc46bff }); shake(.5, .3);
}

/* ================= 캐릭터 생성 + 애니메이션 ================= */
function mkFighter(def, x, y, ctrl) {
  const f = {
    def, x, y, r: 22, hp: def.hp, max: def.hp, face: 0, form: 'base', formT: 0,
    cd: { a: 0, z: 0, x: 0, c: 0, v: 0 }, st: { slow: 0, slowF: 1, silence: 0, stun: 0, charm: 0, charmS: 0, inv: 0, lock: 0, cdfreeze: 0, knock: 0, rev: 0, ctl: 0, lightBuff: 0 },
    cast: null, script: null, awake: ctrl.kind === 'ai' || SAVE.awake.includes(def.id) || def.id === 'lichA' || def.id === 'lilyA' || def.id === 'goldA', ctrl, ai: { t: 0, strafe: 1 }, flash: 0, mindBuff: false,
    gauge: 0, ult: { armed: false }, soul: false, hidden: false, last: { mx: 0, my: 0 }, shield: def.shield || 0, shieldMax: def.shield || 0, drT: 0, drV: 0, anim: null, pose: null, at: Math.random() * 10, yaw: 0, vel: 0, cutGlow: 0, dragonPop: 1,
  };
  f.root = new THREE.Group(); f.rig = buildCookie(def); f.root.add(f.rig.root);
  if (def.id === 'burnA' || def.id === 'mysticA') { f.rigB = buildCookie(Object.assign({}, def, { id: def.id === 'burnA' ? 'burnB' : 'mysticB' })); f.rigB.root.visible = false; f.root.add(f.rigB.root); }   // 괴수화(불지네) 모델
  if (def.dragon) { f.drg = buildDragon(); f.drg.root.visible = false; f.root.add(f.drg.root); }
  if (def.id === 'pitayaA' && vcReady('pitayaD')) { f.pdrg = makeVCModel('pitayaD'); f.pdrg.visible = false; f.root.add(f.pdrg); }   // 변신: 용과드래곤 모델
  if (def.id === 'lilyA') { f.angelM = buildArchangel(); f.angelM.visible = false; f.root.add(f.angelM); }   // 운명의 대천사
  f.root.scale.setScalar(1); world.scene.add(f.root);
  if (def.spider) { f.spiderM = buildSpider(); f.root.add(f.spiderM); }
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
  if (f.big) f.root.scale.setScalar(f.big); else if (f.def.id === 'burn') f.root.scale.setScalar(lerp(f.root.scale.x, f.giant > 0 ? 1.85 : 1, .12)); else if (f.def.id === 'burnA') f.root.scale.setScalar(lerp(f.root.scale.x, f.boss > 0 ? 5 : 1, .06)); else if (f.def.id === 'dark') f.root.scale.setScalar(lerp(f.root.scale.x, f.form === 'witch' ? 1.3 : 1, .15));
  const T = f.at, dead = f.hp <= 0, dragon = f.form === 'dragon';
  // 위치/방향
  const tp = P3(f, 0);
  if (!B.cut || f !== B.cut.f) f.root.position.set(tp.x, f.root.position.y * (f.lift ? 1 : 0) + (f.pose === 'float' ? 1.2 + Math.sin(T * 4) * .15 : 0) + (f.pose === 'sleep' && f.cast && f.cast.type === 'paradise' ? 1.9 : 0) + (f.air || 0) + (f.platY || 0), tp.z);
  const want = Math.PI / 2 - f.face; let d = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw)); f.yaw += d * Math.min(1, dt * 16);
  f.root.rotation.y = f.yaw;
  // 모델 전환
  if (f.rigB) { const bst = f.form === 'beast'; if (bst !== !!f._bst) { f._bst = bst; [f.rig, f.rigB] = [f.rigB, f.rig]; } f.rigB.root.visible = false; }   // 각성 버닝: 괴수화하면 불지네 모델로 교체
  f.rig.root.visible = !dragon && !f.hidden && !f.bushHid && !f.spiderM && f.form !== 'pdragon'; if (f.pdrg) f.pdrg.visible = f.form === 'pdragon' && !f.hidden && !f.bushHid;
  if (f.spiderM) { f.spiderM.visible = !f.hidden && !f.bushHid; const run2 = Math.min(1, f.vel / 3); f.spiderM.position.y = Math.abs(Math.sin(f.at * 10)) * .12 * run2; f.spiderM.userData.legs.forEach((l, i) => { l.rotation.z = Math.sin(f.at * 12 + i * 1.7) * .22 * run2; }); }
  if (f.drg) f.drg.root.visible = dragon && !f.bushHid;
  if (dragon) { f.dragonPop = Math.min(1, f.dragonPop + dt * 2.5); const s = ease.out(f.dragonPop); f.drg.root.scale.setScalar(Math.max(.01, s * 1.7 * (1 + Math.sin(f.dragonPop * 9) * .06 * (1 - f.dragonPop)))); }
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
const K1 = { KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyE: 'e', KeyQ: 'q', KeyR: 'r' }, K2 = { Digit7: 'z', Digit8: 'x', Digit9: 'c', Digit0: 'v', Digit5: 'e', Digit6: 'q', Minus: 'r' };
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
function hotZoneFor(f) {   // 우리 팀이 못 가진 구역(없으면 가까운 구역)
  const mine = f.team === GEM_TEAM[0] ? 0 : 1, zs = B.gem.zones.slice().sort((a, b) => (a.st === mine ? 1 : 0) - (b.st === mine ? 1 : 0) || Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y)), Z = zs[0];
  return { Z, dz: Math.hypot(Z.x - f.x, Z.y - f.y) };
}
function aiInput(f) {
  if (f.statue) return { mx: 0, my: 0, a: false, keys: [] };   // 만두 사대천왕 동상은 주인이 쓰러지기 전엔 가만히 있는다
  if (f.gkMv && B.gk) return { mx: f.gkMv.mx, my: f.gkMv.my, a: false, keys: [] };   // 가상의 왕국 안의 AI 는 규칙대로 움직인다
  if (B.dream && B.dream.e === f && !B.dream.human && B.dream.mv) return { mx: B.dream.mv.mx, my: B.dream.mv.my, a: false, keys: [] };   // 꿈 속 AI 희생자는 꿈의 규칙대로 움직인다
  const e = foe(f), d = dist(f, e), def = f.def, pref = def.aiPref ?? (def.id === 'silent' ? 90 : def.id === 'lich' ? 260 : 230), a = ang(f, e), dt = B.dt;
  const inp = { mx: 0, my: 0, a: false, keys: [] };
  if (B.abyss && !B.abyss.done && f === B.abyss.target) {
    const A = B.abyss, c = A.chaser, dc = dist(f, c), pa = A.open ? ang(f, A.portal) : ang(c, f); let mx = Math.cos(pa), my = Math.sin(pa);
    if (dc < 320) { const aw = ang(c, f); mx = mx * .4 + Math.cos(aw); my = my * .4 + Math.sin(aw); } inp.mx = mx; inp.my = my; return inp;
  }
  const hz = B.gem && B.gem.kind === 'hot' ? hotZoneFor(f) : null;   // 핫존: 적이 멀면 구역으로 가서 지키고, 가까워도 구역 밖이면 구역 쪽으로 움직이며 싸운다
  if (hz && d > 480) { if (hz.dz > hz.Z.r * .55) { const za = Math.atan2(hz.Z.y - f.y, hz.Z.x - f.x); inp.mx = Math.cos(za); inp.my = Math.sin(za); } return inp; }
  if (B.gem && B.gem.kind === 'gem' && d > 700) { const g = gemTarget(f), ga = Math.atan2(g.y - f.y, g.x - f.x); inp.mx = Math.cos(ga); inp.my = Math.sin(ga); return inp; }   // 젬그랩: 멀리 적이 없으면 젬을 주우러 간다
  if (f.aggro && B.explore && d > f.aggro && f.hp >= f.max * .999) return inp;
  f.ai.t -= dt; if (f.ai.t <= 0) { f.ai.t = .6 + Math.random() * .8; f.ai.strafe = Math.random() < .5 ? 1 : -1; }
  if (d > pref) { inp.mx = Math.cos(a); inp.my = Math.sin(a); } else if (d < pref * .6) { inp.mx = -Math.cos(a); inp.my = -Math.sin(a); } else { inp.mx = -Math.sin(a) * f.ai.strafe; inp.my = Math.cos(a) * f.ai.strafe; }
  inp.a = d < (f.def.id === 'burnA' && f.form === 'beast' ? 470 : def.atkRange);
  for (const k of ['z', 'x', 'c', 'v']) {
    if (f.cd[k] > 0 || Math.random() > dt * .9) continue;
    if (k === 'v' && f.def.id === 'silent' && d > 250) continue;
    if (f.def.id === 'burn' && ((k === 'v' && (d > 820 || d < 160)) || (k === 'x' && (d > 800 || d < 140)) || (k === 'z' && d > 420))) continue;
    if (f.def.id === 'burn' && f.undy > 0 && k === 'z') continue;
    if (f.def.id === 'pva' && ((k === 'z' && f.ldom) || (k === 'c' && d > 700) || (k === 'x' && d > 800) || (k === 'v' && d > 1200))) continue;
    if (f.def.id === 'pv' && k === 'c' && !(f.st.lock > 0 || f.st.ctl > 0 || f.st.silence > 0 || B.mind || foe(f).veil || (foe(f).cast && foe(f).cast.type))) continue;
    if (k === 'v' && f.form !== 'base' && f.form !== 'hour' && f.form !== 'beast') continue;
    if (f.def.id === 'mysticA') { if (f.form !== 'base') { if (k !== 'a' && k !== 'z') continue; } else if (f.fog) continue; else { const eh = maHostEnemy(f); if ((k === 'z' && (f.att ? (f.attT || 0) < 7 : Math.random() > .004)) || (k === 'x' && !eh && (f.hp > f.max * .6 || f.cocoon)) || (k === 'c' && !eh && d > 600) || (k === 'v' && !eh && (B.fogA || d > 1200))) continue; } }
    if (f.def.id === 'mystic' && ((k === 'z' && d > 650) || (k === 'x' && d > 750) || (k === 'v' && (d > 550 || f.vdom)) || (k === 'c' && (f.cocoon || d > 900)))) continue;
    if (f.def.id === 'pitayaA') {
      if (f.form === 'pdragon') { if ((k === 'z' && d > 1000) || (k === 'x' && (f.fz || d > 1200)) || (k === 'c' && (f.fly || d > 1300)) || (k === 'v' && f.hp > f.max * .2)) continue; }
      else if ((k === 'z' && d > 900) || (k === 'x' && d > 1000) || (k === 'c' && d > 1100) || (k === 'v' && (d > 900))) continue;
    }
    if (f.def.id === 'ananas' && ((k === 'z' && (f.rrain || d > 950)) || (k === 'x' && (f.yz || d > 1200)) || (k === 'c' && (d > 1000 || d < 150)) || (k === 'v' && (B.reign || f.reignT > 0 || d > 1100)))) continue;
    if (f.def.id === 'pitaya' && ((k === 'z' && (f.pbr || d > 700)) || (k === 'x' && (f.dscale > 0 || d > 600)) || (k === 'c' && (d > 950 || d < 250)) || (k === 'v' && (f.pfield || d > 700)))) continue;
    if (f.def.id === 'timekeeper' && ((k === 'z' && (f.rift ? f.rift.t < 6 : d > 800)) || (k === 'x' && d > 850) || (k === 'c' && (d > 900 || B.voidR)) || (k === 'v' && d > 1100))) continue;
    if (f.def.id === 'berry' && ((k === 'z' && d > 300) || (k === 'x' && (f.holy > 0 || d > 700 || f.hp / f.max > .85)) || (k === 'c' && (d > 900 || d < 220)) || (k === 'v' && (f.hbV > 0 || d > 800)))) continue;
    if (f.def.id === 'lilyA') {
      if (f.form === 'angel') { if ((k === 'z' && d > 750) || (k === 'x' && (d > 900 || f.souls)) || (k === 'c' && f.absorb) || (k === 'v' && !(f.absorb && f.absorb.list.length >= 2))) continue; }
      else if ((k === 'z' && (f.vgrab ? !(f.vgrab.phase === 'hold' && f.vgrab.left < 5.5) : d > 700)) || (k === 'x' && (d > 1000 || (B.lbig && B.lbig.some(c => c.owner === f)))) || (k === 'c' && (d > 1100 || d < 200)) || (k === 'v' && (B.vflag || d > 800))) continue;
    }
    if (f.def.id === 'lichA') {
      if (f.illu && (k === 'x' || k === 'c' || k === 'v')) continue;
      if (f.form === 'base' && ((k === 'z' && d > 800) || (k === 'x' && (d > 800 || f.ctl2)) || (k === 'c' && d > 900) || (k === 'v' && (f.illuClone || d > 1100)))) continue;
      if (f.form === 'dragon' && ((k === 'z' && (f.breath ? f.breath.t < 8 : d > 650)) || (k === 'x' && d > 420) || (k === 'c' && (d > 1000 || (B.lfogs && B.lfogs.some(g => g.owner === f)))) || (k === 'v' && (B.esky || d > 1300)))) continue;
    }
    if (f.def.id === 'dkkA' && ((k === 'z' && d > 900) || (k === 'x' && d > 1000) || (k === 'c' && d > 1300) || (k === 'v' && (B.nem || d > 1500)))) continue;
    if (f.def.id === 'goldA') { if (f.form === 'sky') { if (k !== 'z' || d > 1300) continue; } else if ((k === 'z' && (f.gzch || d > 950)) || (k === 'x' && (f.gcr > 0 || d > 1000)) || (k === 'c' && (d < 300 || d > 1300)) || (k === 'v' && d > 1500)) continue; }
    if (f.def.id === 'gold' && ((k === 'z' && d > 900) || (k === 'x' && (d > 800 || d < 120)) || (k === 'c' && (f.gabs || d > 1100)) || (k === 'v' && (f.rain || d > 1200)))) continue;
    if (f.def.id === 'dkk' && ((k === 'x' && d > 700) || (k === 'c' && (d > 1000 || d < 250)) || (k === 'v' && d > 1300))) continue;
    if (f.def.id === 'burnA' && f.form === 'beast' && !(f.boss > 0) && ((k === 'z' && d > 500) || (k === 'x' && d > 700) || (k === 'v' && d > 900))) continue;
    if (f.def.id === 'burnA' && ((k === 'x' && d > 650) || (k === 'c' && d > 700) || (k === 'z' && d > 1100) || (k === 'v' && f.boss > 0))) continue;
    if (k === 'v' && f.cast) continue;
    if (f.def.id === 'sugar' && (k === 'c' || k === 'v') && f.hp / f.max > .7 && f.shield / f.shieldMax > .6) continue;
    inp.keys.push(k);
  }
  if (f.def.id === 'shadow') { if (f.veil && !f.cast && f.cd.q <= 0 && Math.random() < dt * .6) inp.keys.push('q'); if (f.awake && f.gauge >= 100 && !f.ult.armed && Math.random() < dt * 2) inp.keys.push('r'); }
  if ((f.def.id === 'silent' || ((f.def.id === 'lich' || f.def.id === 'lichA' || f.def.id === 'lilyA' || f.def.id === 'goldA') && f.form === 'base' && !f.minion)) && f.awake && f.gauge >= 100 && Math.random() < dt * 2) inp.keys.push('r');
  if (f.def.id === 'pitayaA' && f.form === 'pdragon' && f.pdb && !f.holdA) f.holdA = true;
  if (f.def.id === 'goldA' && f.form === 'base' && d > 450 && d < 1000 && !(f.cd.q > 0) && !f.gzch && Math.random() < dt * .5) inp.keys.push('q');
  if (f.def.id === 'pitaya' && f.inPF && d < 700 && !(f.cd.q > 0) && Math.random() < dt * .8) inp.keys.push('q');
  if (f.def.id === 'lichA') { if (f.form === 'base' && !(f.cd.e > 0) && !f.illu && d < 800 && Math.random() < dt * .12) inp.keys.push('e'); if (f.ctl2 && Math.random() < dt * .35) inp.keys.push('q'); }
  if (hz && hz.dz > hz.Z.r * .75 && !f.cast) { const za = Math.atan2(hz.Z.y - f.y, hz.Z.x - f.x); inp.mx = Math.cos(za) * .9 + inp.mx * .1; inp.my = Math.sin(za) * .9 + inp.my * .1; }   // 핫존: 구역 밖이면 구역으로
  if (f.cast && f.cast.type === 'field' && f.cast.t > 6) inp.keys.push('v');
  if (f.cast && f.cast.type === 'paradise' && f.cast.t > 30) inp.keys.push('v');
  return inp;
}
function aimPoint(f) {
  const os = f.st.charm > 0 ? B.objs.filter(o => (o.realm || 0) === realmOf(f)) : [];
  if (os.length) { let best = os[0]; for (const o of os) if (dist(f, o) < dist(f, best)) best = o; return best; }
  if (f.ctrl.kind === 'h1' || (f.ctl2by && f.ctl2by.ctl2 && f.ctl2by.ctl2.cur === 'tgt' && f.ctl2by.ctrl.kind === 'h1')) {
    if (isTouch) {   // 터치: 기본은 상대 자동 조준, 스킬 버튼을 드래그해서 뗀 직후에는 그 방향으로 조준
      const t = TOUCH.aim; if (t && performance.now() < TOUCH.until) { const d = camRel(t.dx / t.m, t.dy / t.m), L = 150 + 580 * clamp(t.m / 70, 0, 1); return { x: f.x + d.x * L, y: f.y + d.y * L }; }
      return foe(f);
    }
    return { x: mouse.wx, y: mouse.wy };
  }
  return foe(f);
}
// 아공간/영역을 전개하는 스킬 (각성 퓨어바닐라의 빛의 아공간이 켜져 있으면 다른 쿠키는 전개 불가)
const DOMAIN_SKILLS = { silent: ['v'], lich: ['c'], shadow: ['z', 'x', 'v'], sugar: ['z', 'v'], pv: ['x'], mystic: ['v'] };
const domainBlocked = (f, k) => !!(DOMAIN_SKILLS[f.def.id] && DOMAIN_SKILLS[f.def.id].includes(k) && B.fighters.some(p => p.ldom && p.hp > 0 && p !== f && !ally(p, f) && realmOf(p) === realmOf(f)));
/* ===== 사일런트솔트 패시브: 갈라진 자국 — 적의 영역/정신계 안에서 평타를 쓸 때마다 균열이 남고, 3번이면 그 영역이 갈라져 파괴된다 ===== */
function silentRealms(f) {   // f 가 안에 있는 '적의' 영역/공간 목록
  const r = [], hostile = o => o && o !== f && !ally(f, o), same = o => realmOf(o) === realmOf(f), R = f.r;
  const add = (obj, name, destroy, alive) => r.push({ obj, name, destroy, alive });
  const m = B.mind; if (m && hostile(m.f)) add(m, '정신세계', () => endMind(), () => B.mind === m);
  const D = B.dream; if (D && D.e === f) add(D, '상대의 꿈', () => dreamWin(), () => B.dream === D);
  const sl = B.seal; if (sl && sl.target === f) add(sl, '봉인수 내부', () => endSeal(), () => B.seal === sl);
  const ab = B.abyss; if (ab && ab.target === f) add(ab, '정신의 심연', () => endAbyss(true), () => B.abyss === ab);
  const vr = B.voidR; if (vr && vr.t === f) add(vr, '공허', () => endVoid(false), () => B.voidR === vr);
  const gk = B.gk; if (gk && gk.vs.includes(f)) add(gk, '가상의 골드치즈 왕국', () => endGk(true), () => B.gk === gk);
  for (const o of B.fighters) {
    if (!hostile(o) || o.hp <= 0 || !same(o)) continue;
    const c = o.cast;
    if (c && c.type === 'field' && Math.hypot(f.x - c.x, f.y - c.y) < c.r + R) add(c, '침묵의 영역', () => endField(o), () => o.cast === c);
    if (c && c.type === 'paradise') add(c, '낙원', () => endParadise(o), () => o.cast === c);
    const v = o.veil; if (v && inReg(v.reg, f)) add(v, '거짓의 장막', () => endVeil(o), () => o.veil === v);
    const L = o.ldom; if (L && Math.hypot(f.x - L.x, f.y - L.y) < L.r + R) add(L, '빛의 아공간', () => endLdom(o), () => o.ldom === L);
    const V = o.vdom; if (V && Math.hypot(f.x - V.x, f.y - V.y) < V.r + R) add(V, '연꽃 영역', () => endSteamer(o), () => o.vdom === V);
  }
  const st = B.storm; if (st && hostile(st.f)) add(st, '폭풍우', () => endStorm(true), () => B.storm === st);
  for (const [k, nm, rm] of [['lakes', '호수', removeLake], ['hexes', '마법진', removeHex], ['barriers', '장막', removeBarrier], ['lights', '빛의 영역', removeLight]])
    for (const o of B[k]) if (hostile(o.owner) && same(o.owner) && o.kind !== 'strip' && o.r && Math.hypot(f.x - o.x, f.y - o.y) < o.r + R) add(o, nm, () => { rm(o); B[k] = B[k].filter(x => x !== o); }, () => B[k].includes(o));
  return r;
}
function crackMesh(a) {   // 바닥에 갈라진 자국 (검은 테두리 + 흰 균열선)
  const g = new THREE.Group();
  const seg = (x0, z0, x1, z1, w) => { const len = Math.hypot(x1 - x0, z1 - z0); for (const [col, ww, yy] of [[0x05030a, w * 2.6, .1], [0xe6eeff, w, .12]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(len, .02, ww), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .95, depthWrite: false })); m.position.set((x0 + x1) / 2, yy, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); m.renderOrder = 6; g.add(m); } };
  for (let br = 0; br < 4; br++) { let cx = 0, cz = 0, d = a + br * 1.57 + rnd(-.5, .5); const n = 4 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { d += rnd(-.6, .6); const l = rnd(.8, 1.8), nx = cx + Math.cos(d) * l, nz = cz + Math.sin(d) * l; seg(cx, cz, nx, nz, .16 * (1 - i / n) + .05); cx = nx; cz = nz; } }
  return g;
}
function silentCrack(f) {
  if (f.def.id !== 'silent' || f.soul || f.sealSoul || f.pseal > 0 || f.hp <= 0) return;
  B.cracks = B.cracks || [];
  for (const rm of silentRealms(f)) {
    const ob = rm.obj; ob.crk = (ob.crk || 0) + 1;
    const pt = { x: f.x + Math.cos(f.face) * 70, y: f.y + Math.sin(f.face) * 70, realm: f.realm }, p = P3(pt);
    const g = crackMesh(rnd(0, 6.283)); g.position.copy(p); world.scene.add(g); B.cracks.push({ g, alive: rm.alive, ob });
    vfx.burst('spark', P3(pt, .3), 14, { speed: 3, speed2: 9, life: .5, size: .35, c0: 0xffffff, c1: SIL });
    if (ob.crk >= 3) {
      B.cracks = B.cracks.filter(c => { if (c.ob !== ob) return true; world.scene.remove(c.g); return false; });
      const pf = P3(f); vfx.burst('spark', P3(f, 1.4), 90, { speed: 6, speed2: 26, life: 1, size: .6, c0: 0xffffff, c1: 0x8fa4ff, grav: 6 });
      for (let i = 0; i < 3; i++) vfx.ring(pf, { r0: .5, r1: 9 + i * 6, dur: .5 + i * .15, color: i % 2 ? SIL : 0xe6eeff });
      ui.flash('#e6eeff', .6, .4); shake(1, .6); B.hitstop = Math.max(B.hitstop || 0, .12);
      ui.pop(P3(f, 4.4), '💥 ' + rm.name + ' 파괴! (갈라진 자국 3/3)', '#e6eeff', true);
      rm.destroy();
    } else ui.pop(P3(f, 3.6), '갈라진 자국 ' + ob.crk + '/3', '#cfd8ff');
  }
}
function updCracks() { if (!B.cracks || !B.cracks.length) return; B.cracks = B.cracks.filter(c => { if (c.alive()) return true; world.scene.remove(c.g); return false; }); }
function tryUse(f, k) {
  const s = f.def.skills[f.form][k];
  if (f.sealSoul && k === 'r' && f.def.id === 'shadow') return;
  if (!s || f.cd[k] > 0 || f.script || B.cut || f.gzch) return;
  if (domainBlocked(f, k)) { if (!f.domMsg || B.time - f.domMsg > 1.2) { f.domMsg = B.time; toast(f, '빛의 아공간 안에서는 아공간·영역을 전개할 수 없습니다'); ui.pop(P3(f, 3.4), '🚫 전개 불가', '#fff0a8'); } return; }
  const pvc = f.def.id === 'pv' && k === 'c';
  if (f.st.stun > 0 || (f.st.lock > 0 && !pvc)) return;
  if (f.cast && !((f.cast.type === 'field' || f.cast.type === 'paradise') && k === 'v')) return;
  if (k !== 'a' && f.st.silence > 0 && !pvc) { toast(f, '침묵 상태!'); return; }
  if ((f.voidP > 0 || f.vdIn > B.time) && k !== 'a' && !f.cast) {   // 허무/공허의 영역: 스킬 발동이 지연되고 일부는 실패한다
    if (f.vdIn > B.time && Math.random() < (f.vdFail || .3)) { ui.pop(P3(f, 3.4), '🕳 공허: 스킬 실패', '#d8c8ff'); f.cd[k] = Math.max(f.cd[k], 1.2); return; }
    const dly = Math.min(1.2, .25 * (f.voidP || 0) + (f.vdIn > B.time ? .6 : 0)); ui.pop(P3(f, 3.4), '⏳ 허무: 발동 지연', '#e8e0c0');
    runScript(f, [], dly, () => { if (f.hp <= 0) return; const r2 = s.use(f, aimPoint(f)); if (r2 !== false) { f.cmb = B.time; if (r2 !== 'nocd') f.cd[k] = s.cd * (f.soul || f.sealSoul ? 1.5 : 1); } }); return;
  }
  const r = s.use(f, aimPoint(f));
  if (r !== false && k === 'a' && f.def.id === 'silent') silentCrack(f);
  if (r !== false) f.cmb = B.time;   // 자연 회복은 공격/피격 후 일정 시간이 지나야 시작
  if (r !== false && r !== 'nocd') f.cd[k] = s.cd * (f.soul || f.sealSoul ? 1.5 : 1);
}

/* ================= 업데이트 ================= */
function updFighter(f, dt) {
  if (B.explore && f.hp <= 0) return;
  if (f.minion && f.hp <= 0 && (f.illu || f.dreamOf || f.dkking || f.dmob || f.legion)) { f.script = null; f.cast = null; f.act = null; return; }   // 죽은 분신(환각/꿈/병사)은 땅 속에서 공격하지 않는다
  if (f.sealHold) return;
  updCommon(f, dt);
  if (f.def.id === 'silent' && f.form === 'base' && !f.sealSoul && !f.soul && !(f.pseal > 0) && f.hp > 0 && f.hp <= 10000) enterHour(f);
  if (f.form === 'hour') hourAura(f);
  if (!(f.st.cdfreeze > 0)) for (const k in f.cd) f.cd[k] = Math.max(0, f.cd[k] - dt * (f.cdMul || 1) * (f.silkT > 0 ? .5 : 1));
  if (f.silkT > 0) f.silkT -= dt;
  for (const k of ['slow', 'silence', 'stun', 'charm', 'charmS', 'inv', 'lock', 'cdfreeze', 'knock', 'rev', 'ctl', 'lightBuff']) f.st[k] = Math.max(0, f.st[k] - dt);
  if (f.permRev) f.st.rev = Math.max(f.st.rev, .2); if (f.permSlow && f.st.slow < .2) slowOn(f, .2, .65);
  f.flash = Math.max(0, f.flash - dt); f.drT = Math.max(0, f.drT - dt);
  if (f.form !== 'base' && f.form !== 'hour' && f.form !== 'beast' && !f.script) { f.formT -= dt; if (f.formT <= 0) { revertForm(f); toast(f, '변신 종료'); } }
  let inp = readInput(f); f.last = { mx: inp.mx, my: inp.my }; f.holdA = !!inp.a;   // 누르고 있는지 (변신 브레스)
  if (f.ctl2 && f.ctl2.cur === 'tgt') { f.rawInp = { ...inp, keys: inp.keys.filter(k => k !== 'q') }; if (inp.keys.includes('q')) tryUse(f, 'q'); inp = { mx: 0, my: 0, a: false, keys: [] }; }   // 정신의 심연: 조종 중엔 내 캐릭터는 가만히
  else if (f.ctl2) f.rawInp = null;
  if (f.ctl2by && f.ctl2by.ctl2 && f.ctl2by.ctl2.cur === 'tgt' && f.ctl2by.rawInp) { inp = f.ctl2by.rawInp; f.ctl2by.rawInp = { ...inp, keys: [], a: inp.a }; f.last = { mx: inp.mx, my: inp.my }; }   // 조종당하는 적은 리치의 입력으로 움직인다
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
  if (!f.outside) { f.x = clamp(f.x, PAD, W - PAD); f.y = clamp(f.y, PAD, H - PAD); }
  if (f.realm && !B.gk) {
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
const inR = fn => { if (B.seal || B.abyss || B.dream || B.voidR || B.gk) { inRealm(0, fn); inRealm(1, fn); } else fn(); };
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
  for (const m of B.fighters) if ((m.legion || m.illu || m.dreamOf || m.dkking || m.dmob) && m.hp <= 0) { m.deadT = (m.deadT || 0) + dt; if (m.deadT > 1) m.gone = true; }
  if (B.fighters.some(m => m.gone)) { B.fighters.filter(m => m.gone && (m.legion || m.illu || m.dreamOf || m.dkking || m.dmob)).forEach(removeFighter); B.fighters = B.fighters.filter(m => !(m.gone && (m.legion || m.illu || m.dreamOf || m.dkking || m.dmob))); }
  updFxm(dt); updFire(dt); updLdoms(dt); updMystic(dt); updGold(dt); updGoldA(dt); updCracks(); updMA(dt); updLichRain(dt); updDka(dt); updLichA(dt); updLilyA(dt); updArchangel(dt); updBerry(dt); updTimekeeper(dt); updPitaya(dt); updAnanas(dt); updPitayaA(dt); updForks(dt); updSeal(dt); updLult(dt); updAbyss(dt);
  inR(() => { updProjs(dt); updBarriers(dt); updLights(dt); updStorm(dt); updZones(dt); updLakes(dt); updAngels(dt); updHexes(dt); });
  if (B.mind) { B.mind.t -= dt; if (B.mind.t <= 0) endMind(); }
  if (B.explore) { updExplore(dt); return; }
  if (B.gem) { updGem(dt); return; }
  const dead = B.fighters.find(f => f.hp <= 0 && !f.minion);
  if (dead && !B.over) { B.over = B.abyss ? B.abyss.owner : (B.fighters.find(o => o !== dead && !o.minion && !ally(dead, o)) || foe(dead)); if (B.mind) endMind(); ui.vignette(false); setTimeout(finish, 2200); }
}
function finish() {
  if (!B) return;
  if (B.fx) { const cb = B.fx.done, win = B.over === B.fighters[0]; cleanup(); ui.hideHud(); toLobby(); cb && cb({ win }); return; }
  if ((B.mode === 'gem' || B.mode === 'bounty' || B.mode === 'hot') && B.gem) {   // 젬그랩/바운티 결과
    const win = B.gem.win === GEM_TEAM[0], gain = win ? 400 : 150; SAVE.coins += gain; const tn = troRec(win); if (win) SAVE.mat += 1; persist();
    const kk = B.gem.kind, nm = kk === 'bounty' ? '바운티' : kk === 'hot' ? '핫존' : '젬그랩', ic = kk === 'bounty' ? '⭐' : kk === 'hot' ? '🔥' : '💎'; ui.result(win ? nm + ' 승리!' : nm + ' 패배...', `${ic} ${Math.floor(B.gem.cnt[0])} : ${Math.floor(B.gem.cnt[1])}  ·  +${gain} 코인` + (win ? '  ·  각성 재료 +1' : '') + tn); return;
  }
  if (B.mode === 'duel') {   // 1v1 결투: 먼저 3승
    const s = B.series, p1win = B.over === B.fighters[0]; s.w[p1win ? 0 : 1]++;
    if (s.w[0] < 3 && s.w[1] < 3) {
      ui.toast(`라운드 ${s.round} ${p1win ? '승리' : '패배'}  ·  ${s.w[0]} : ${s.w[1]}`); s.round++;
      const bb = B, a = bb.fighters[0].def.id, b = bb.fighters[1].def.id, mid = bb.map.id;
      setTimeout(() => { if (B === bb) startBattle(a, b, 'duel', mid, s); }, 2200); return;
    }
    const win = s.w[0] >= 3, gain = win ? 500 : 150; SAVE.coins += gain; const tn = troRec(win);
    if (win) { const id = B.fighters[1].def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; SAVE.mat += 2; } persist();
    ui.result(win ? '결투 승리!' : '결투 패배...', `${s.w[0]} : ${s.w[1]}  ·  +${gain} 코인` + (win ? '  ·  각성 재료 +2' : '') + tn); return;
  }
  if (B.mode === 'raid') { const r = ui.recordRaid(B.raid.dmg); ui.result(B.over === B.fighters[0] ? '보스 처치!' : '레이드 종료', `이번 피해 ${Math.round(B.raid.dmg).toLocaleString()}${r.isBest ? ' (최고 기록!)' : ''} · 최고 ${r.best.toLocaleString()}`); return; }
  const w = B.over, p1win = w === B.fighters[0]; let sub = '';
  if (B.mode === 'ai') { const gain = p1win ? 300 : 100; SAVE.coins += gain; const tn = troRec(p1win); if (p1win) { const id = w.def.id; SAVE.wins[id] = (SAVE.wins[id] || 0) + 1; SAVE.mat += 1; } persist(); sub = '+' + gain + ' 코인' + (p1win ? '  ·  각성 재료 +1' : '') + tn; }
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
  if (qAcc > 3) { qAcc = 0; if (qAvg > (B && (B.gem || B.bounty) ? .026 : .036)) { world.setQuality(1); vfx.density = .5; } }
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
/* ================= 3v3 젬그랩 (브롤스타즈 규칙) =================
   중앙 광산에서 젬이 솟는다. 우리 팀이 젬 10개를 모아 15초 동안 지키면 승리. 쓰러지면 들고 있던 젬을 떨어뜨리고 3.5초 뒤 기지에서 부활. */
const HOT_TIME = 150, HOT_WIN = 100, BTY_TIME = 135, AI_NICKS = ['달콤이', '초코칩', '바삭이', '말랑이', '쫀득이', '캐러멜', '마카롱', '와플', '푸딩', '젤리빈', '솜사탕', '별사탕', '누룽지', '마시멜로', '크림빵', '시나몬', '버터링', '팥빙수', '모카', '딸기잼'];
const aiNick = () => AI_NICKS[Math.floor(Math.random() * AI_NICKS.length)] + (Math.random() < .5 ? '' : Math.floor(Math.random() * 90 + 10));
const GEM_NEED = 10, GEM_HOLD = 15, GEM_TIME = 180, GEM_RESP = 3.5, GEM_TEAM = [20, 21], GEM_COL = [0x4be36a, 0xff5a6a];
let GEM_GEO = null, GEM_MAT = null, GEM_GLOW = null;   // 젬은 지오메트리/재질 공유, 조명(PointLight) 없음 — 조명 수가 변하면 모든 재질 셰이더가 재컴파일돼 렉이 걸렸다
function gemMesh() {
  if (!GEM_GEO) {
    GEM_GEO = new THREE.OctahedronGeometry(.75, 0); GEM_MAT = new THREE.MeshBasicMaterial({ color: 0xd9a8ff });
    GEM_GLOW = new THREE.MeshBasicMaterial({ color: 0x9a3cff, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  const m = new THREE.Mesh(GEM_GEO, GEM_MAT); m.scale.y = 1.4; const h = new THREE.Mesh(GEM_GEO, GEM_GLOW); h.scale.set(1.9, 2.5, 1.9);
  const g = new THREE.Group(); g.add(m, h); g.userData.m = m; return g;
}
function spawnGem(x, y, scatter) {
  const a = rnd(0, 6.283), d = rnd(0, scatter), gx = clamp(x + Math.cos(a) * d, PAD, W - PAD), gy = clamp(y + Math.sin(a) * d, PAD, H - PAD);
  const m = gemMesh(); m.position.copy(W3(gx, gy, 1.2)); addExtra(m); B.gem.gems.push({ x: gx, y: gy, m, t: rnd(0, 6) });
  vfx.burst('glow', W3(gx, gy, 1), 6, { speed: 2, speed2: 6, life: .5, size: .6, c0: 0xffffff, c1: 0xc27bff, up: 3 });
}
function setupGem(p1, p2, kind = 'gem') {
  const me = B.fighters[0], e1 = B.fighters[1], pool = ORDER.filter(id => id !== p1 && id !== p2 && id !== 'brave'), pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const mk = (id, x, y, team, face, nick) => { const f = mkFighter(CHARS[id], x, y, { kind: 'ai' }); f.team = team; f.face = face; f.yaw = Math.PI / 2 - face; f.nick = nick || aiNick(); B.fighters.push(f); return f; };
  const pty = i => (SAVE.party && SAVE.party[i] && CHARS[SAVE.party[i].id] ? SAVE.party[i] : null);   // 파티원(AI 동료) 이 있으면 그 쿠키로
  const A = [me, mk(pty(0) ? pty(0).id : pick(), W * .1, H / 2 - 260, GEM_TEAM[0], 0, pty(0) && pty(0).nick), mk(pty(1) ? pty(1).id : pick(), W * .1, H / 2 + 260, GEM_TEAM[0], 0, pty(1) && pty(1).nick)], E = [e1, mk(pick(), W * .9, H / 2 - 260, GEM_TEAM[1], Math.PI), mk(pick(), W * .9, H / 2 + 260, GEM_TEAM[1], Math.PI)];
  me.team = GEM_TEAM[0]; e1.team = GEM_TEAM[1]; me.y = H / 2; e1.y = H / 2 - 0; e1.x = W * .9; e1.y = H / 2;
  for (const f of [...A, ...E]) { if (kind === 'gem') f.gems = 0; else if (kind === 'bounty') f.bty = 1; else f.hz = 0; f.spawn = { x: f.x, y: f.y }; f.gring = vfx.decal(P3(f), { tex: 'ring', r: 2.2, color: GEM_COL[f.team === GEM_TEAM[0] ? 0 : 1], alpha: .75, y: .05 }); }
  for (const f of [...A, ...E]) if (f !== me) f.root.traverse(o => { if (o.isMesh) o.castShadow = false; });   // 3v3: 모델 6개가 전부 그림자를 그리면 느려서 상대/동료는 그림자 끔
  B.gem = { kind, gems: [], cnt: [0, 0], cd: [null, null], spawnT: 1.5, time: 0, win: null, el: null };
  if (kind === 'hot') B.gem.zones = [[W / 2 - 560, H / 2], [W / 2 + 560, H / 2]].map(([x, y]) => ({ x, y, r: 250, st: -1, ring: vfx.decal(P3({ x, y, realm: 0 }), { tex: 'ring', r: 250 * S, color: 0xffffff, alpha: .95, y: .07 }), rune: vfx.decal(P3({ x, y, realm: 0 }), { tex: 'rune', r: 250 * S * .9, color: 0xffffff, alpha: .35, spin: .4, y: .06 }) }));   // 핫존: 점령 구역 2곳
}
function gemTarget(f) {   // AI: 가장 가까운 젬, 없으면 중앙 광산
  let best = null, bd = 1e18; for (const g of B.gem.gems) { const d = (g.x - f.x) ** 2 + (g.y - f.y) ** 2; if (d < bd) { bd = d; best = g; } }
  return best || { x: W / 2 + rnd(-80, 80), y: H / 2 + rnd(-80, 80) };
}
function gemEnd(team) {
  const G = B.gem; if (G.win !== null) return; G.win = team; B.over = team === GEM_TEAM[0] ? B.fighters[0] : B.fighters[1];
  ui.toast((G.kind === 'bounty' ? '⭐ ' : G.kind === 'hot' ? '🔥 ' : '💎 ') + (team === GEM_TEAM[0] ? '우리 팀 승리!' : '상대 팀 승리...')); setTimeout(finish, 2200);
}
function bountyKill(f, G) {   // 바운티: 처치하면 그 쿠키의 현상금(별) 만큼 팀 점수, 처치자 현상금 +1(최대 7), 죽으면 1로 초기화
  const k = f.lastAtk && B.time - f.lastAtk.t < 10 ? f.lastAtk.f : null, v = f.bty || 1;
  if (k && k.team !== undefined && k.team !== f.team) {
    G.cnt[k.team === GEM_TEAM[0] ? 0 : 1] += v; k.bty = Math.min(7, (k.bty || 1) + 1);
    ui.pop(P3(k, 4.2), '⭐ +' + v, '#ffe066', true); if (k === B.fighters[0]) ui.toast('⭐ +' + v + ' 처치!'); if (f === B.fighters[0]) ui.toast('쓰러졌습니다! ' + GEM_RESP + '초 뒤 부활');
  }
  f.bty = 1; f.lastAtk = null;
}
function updGem(dt) {
  const G = B.gem; G.time += dt; const real = B.fighters.filter(f => !f.minion && f.team !== undefined && (f.gems !== undefined || f.bty !== undefined || f.hz !== undefined));
  if (G.kind === 'gem') { G.spawnT -= dt; if (G.spawnT <= 0) { G.spawnT = 4; if (G.gems.length < 16) spawnGem(W / 2, H / 2, 90); } }
  for (const g of G.gems) { g.t += dt; g.m.position.y = 1.2 + Math.sin(g.t * 3) * .25; g.m.userData.m.rotation.y += dt * 2; }
  for (const f of real) {
    if (f.hp > 0) {
      f.gdead = false;
      for (const g of G.gems) if (!g.got && Math.hypot(g.x - f.x, g.y - f.y) < f.r + 55) { g.got = true; f.gems++; ui.pop(P3(f, 3.6), '💎 ' + f.gems, '#d9a8ff', true); vfx.burst('spark', P3(f, 1.4), 8, { speed: 3, life: .35, size: .35, c0: 0xffffff, c1: 0xc27bff }); }
    } else {
      if (!f.gdead) { f.gdead = true; if (G.kind === 'bounty') bountyKill(f, G); f.respT = B.time + GEM_RESP; const n = f.gems; f.gems = 0; for (let i = 0; i < n; i++) spawnGem(f.x, f.y, 140); if (n) ui.pop(P3(f, 3.6), '💎 -' + n, '#ff8aa0', true); if (f === B.fighters[0]) ui.toast('쓰러졌습니다! ' + GEM_RESP + '초 뒤 부활'); }
      if (B.time - (f.respT - GEM_RESP) > 1.3) f.root.visible = false;
      if (B.time >= f.respT && !f.noResp) {   // 기지에서 부활 (공허에서 죽으면 부활 불가)
        clearStates(f); f.hp = f.max; f.shield = f.shieldMax; f.gdead = false; f.deadT = 0; f.root.visible = true; f.root.rotation.z = 0; f.root.position.y = 0; f.x = f.spawn.x; f.y = f.spawn.y;
        for (const k in f.cd) f.cd[k] = 0; f.st.inv = 2; f.burn = null; f.mflame = null; f.cmb = B.time; vfx.ring(P3(f), { r0: .5, r1: 6, dur: .6, color: GEM_COL[f.team === GEM_TEAM[0] ? 0 : 1] });
      }
    }
    if (f.gring) { const p = P3(f); f.gring.obj.position.set(p.x, f.gring.obj.position.y, p.z); f.gring.obj.visible = f.hp > 0; }
  }
  if (G.kind === 'hot' && G.win === null) {   // 점령 구역에 우리 팀만 서 있으면 초당 2점 (둘 다 있으면 경합, 아무도 없으면 중립)
    for (const z of G.zones) {
      const inz = t => real.filter(f => f.hp > 0 && f.team === GEM_TEAM[t] && Math.hypot(f.x - z.x, f.y - z.y) < z.r).length, n0 = inz(0), n1 = inz(1);
      z.st = n0 && !n1 ? 0 : n1 && !n0 ? 1 : n0 && n1 ? 2 : -1; if (z.st === 0 || z.st === 1) G.cnt[z.st] += 2 * dt;
      const col = z.st === 0 ? 0x4be36a : z.st === 1 ? 0xff5a6a : z.st === 2 ? 0xffe066 : 0xffffff; z.ring.obj.material.color.setHex(col); z.rune.obj.material.color.setHex(col);
    }
    for (let t = 0; t < 2; t++) if (G.cnt[t] >= HOT_WIN) { G.cnt[t] = HOT_WIN; gemEnd(GEM_TEAM[t]); break; }
  }
  B.gem.gems = G.gems.filter(g => { if (g.got) { rmExtra(g.m); return false; } return true; });
  if (G.kind === 'gem') for (let t = 0; t < 2; t++) {
    G.cnt[t] = real.filter(f => f.team === GEM_TEAM[t]).reduce((s, f) => s + (f.gems || 0), 0);
    if (G.cnt[t] >= GEM_NEED) { if (G.cd[t] === null) { G.cd[t] = GEM_HOLD; ui.toast(t === 0 ? '💎 젬 10개! 15초만 지키세요!' : '💎 상대가 젬 10개! 젬을 빼앗으세요!'); } else { G.cd[t] -= dt; if (G.cd[t] <= 0 && G.win === null) gemEnd(GEM_TEAM[t]); } } else G.cd[t] = null;
  }
  if (G.win === null && G.time >= (G.kind === 'bounty' ? BTY_TIME : G.kind === 'hot' ? HOT_TIME : GEM_TIME) && G.cd[0] === null && G.cd[1] === null) {   // 시간 종료: 젬이 더 많은 팀 (같으면 남은 체력 합)
    const hp = t => real.filter(f => f.team === GEM_TEAM[t]).reduce((s, f) => s + Math.max(0, f.hp), 0);
    gemEnd(GEM_TEAM[G.cnt[0] !== G.cnt[1] ? (G.cnt[0] > G.cnt[1] ? 0 : 1) : (hp(0) >= hp(1) ? 0 : 1)]);
  }
  if (!G.el || !G.el.isConnected) { G.el = document.createElement('div'); G.el.style.cssText = 'position:absolute;top:56px;left:50%;transform:translateX(-50%);text-align:center;font:700 20px/1.25 sans-serif;color:#fff;text-shadow:0 2px 6px #000;pointer-events:none;z-index:5;white-space:nowrap'; document.getElementById('hud').appendChild(G.el); }
  const rem = Math.max(0, (G.kind === 'bounty' ? BTY_TIME : G.kind === 'hot' ? HOT_TIME : GEM_TIME) - G.time), c = i => G.cd[i] !== null ? ` <span style="color:#ffe066">${Math.ceil(G.cd[i])}s</span>` : '';
  const html = G.kind === 'hot' ? `<span style="color:#6cf">🔥 ${Math.floor(G.cnt[0])}/${HOT_WIN}</span> &nbsp;<span style="font-size:15px;color:#ddd">${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}</span>&nbsp; <span style="color:#f77">${Math.floor(G.cnt[1])}/${HOT_WIN} 🔥</span><br><span style="font-size:13px">${G.zones.map(z => ['🟢', '🔴', '🟡', '⚪'][z.st < 0 ? 3 : z.st]).join(' ')} 구역</span>` : G.kind === 'bounty' ? `<span style="color:#6cf">⭐ ${G.cnt[0]}</span> &nbsp;<span style="font-size:15px;color:#ddd">${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}</span>&nbsp; <span style="color:#f77">${G.cnt[1]} ⭐</span>` : `<span style="color:#6cf">💎 ${G.cnt[0]}/${GEM_NEED}${c(0)}</span> &nbsp;<span style="font-size:15px;color:#ddd">${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}</span>&nbsp; <span style="color:#f77">${G.cnt[1]}/${GEM_NEED} 💎${c(1)}</span>`;
  if (html !== G.html) { G.html = html; G.el.innerHTML = html; }
}
export function startBattle(p1, p2, mode, mapId, series, fx) {
  p1 = formOf(p1);   // 각성한 캐릭터를 각성 형태로 쓰는 중이면 각성 버전으로 출전
  cleanup(); lobbyHide(); world.setLobby(false);
  const map = MAPS.find(m => m.id === mapId) || MAPS[Math.floor(Math.random() * MAPS.length)], L = layoutMap(map); W = map.W; H = map.H; mouse.wx = W / 2; mouse.wy = H / 2;
  B = { barriers: [], lights: [], storm: null, fighters: [], projs: [], zones: [], lakes: [], angels: [], ghost: { x: W / 2, y: H / 2, r: 0, hp: 1, max: 1, st: {}, def: { id: 'ghost' }, cast: null, cd: {}, shield: 0, root: { position: new THREE.Vector3() } }, hexes: [], forks: [], extra: [], fxm: [], fkSeq: null, seal: null, abyss: null, lult: null, mind: null, cut: null, over: null, shake: 0, shakeT: 0, hitstop: 0, mode, time: 0, dt: .016,
    objs: L.objs, bushes: L.bushes, map, intro: true, fx: fx || null, series: mode === 'duel' ? (series || { w: [0, 0], round: 1 }) : null };
  const EX = fx && fx.explore;
  if (EX) B.fighters.push(mkFighter(CHARS[p1], EX.start[0] * W, EX.start[1] * H, { kind: 'h1' }));
  else B.fighters.push(mkFighter(CHARS[p1], W * .1, H / 2, { kind: 'h1' }), mkFighter(CHARS[p2], W - W * .1, H / 2, mode === 'local' ? { kind: 'h2' } : { kind: 'ai' }));
  if (!fx) { B.fighters[0].nick = SAVE.nick || '플레이어'; if (B.fighters[1] && !B.fighters[1].nick) B.fighters[1].nick = aiNick(); }
  if ((mode === 'gem' || mode === 'bounty' || mode === 'hot') && !fx) setupGem(p1, p2, mode);
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
  B.extra.forEach(m => world.scene.remove(m)); B.fire = null; ui.dim(0); ui.glass(false); world.setAbyss(false); world.setDream(0); world.setSealRealm(false); world.setMind(false); if (sealBtn) sealBtn.style.display = 'none';
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
  window.WB = { get B() { return B; }, gkPhase2: () => gkPhase2(B.gk), runFight, hurt, step: dt => update(dt), startBattle, tryUse, CHARS, SAVE, mouse, vfx, world, THREE };
}
