// 정점색(COLOR_0) glb 쿠키 로더 (버닝스파이스, 세인트릴리). 정적 단일 메시, 리깅 없음.
// 높이를 맞추고 발끝 y=0, 가운데 정렬해서 rig 의 body 에 통째로 올린다.
// 원본(Tripo 115만 정점, 조각난 UV 아틀라스)은 줄이면 텍스처가 깨져서, 색을 정점색으로 구워 클러스터링한 glb 를 쓴다
// (scripts/_bake.html + scripts/_recv.cjs 로 생성 → www/assets/models/<id>/<id>.glb, 텍스처 없음).
import * as THREE from 'three';
import { loadGLB } from './glbload.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const VC = {
  burn: { url: 'assets/models/burning/burning.glb', h: 2.7 },
  lily: { url: 'assets/models/lily/lily.glb', h: 2.7 },
  pva: { url: 'assets/models/pva/pva.glb', h: 2.6 },
  burnA: { url: 'assets/models/burnA/burnA.glb', h: 2.9 },
  dkk: { url: 'assets/models/dkk/dkk.glb', h: 2.8 },
  dkkA: { url: 'assets/models/dkkA/dkkA.glb', h: 3.0 },
  lilyA: { url: 'assets/models/lilyA/lilyA.glb', h: 2.9 },
  berry: { url: 'assets/models/berry/berry.glb', h: 2.8 },
  timekeeper: { url: 'assets/models/timekeeper/timekeeper.glb', h: 2.7, skinned: true },
  pitaya: { url: 'assets/models/pitaya/pitaya.glb', h: 2.8, skinned: true },
  pitayaD: { url: 'assets/models/pitayaD/pitayaD.glb', h: 8 },   // 변신(용과드래곤) 모델
  ananas: { url: 'assets/models/ananas/ananas.glb', h: 2.8, skinned: true },
  gold: { url: 'assets/models/gold/gold.glb', h: 2.7 },
  goldA: { url: 'assets/models/goldA/goldA.glb', h: 2.9 },
  mystic: { url: 'assets/models/mystic/mystic.glb', h: 2.8 },
  mysticA: { url: 'assets/models/mysticA/mysticA.glb', h: 2.9 },
  mysticB: { url: 'assets/models/mysticB/mysticB.glb', h: 4.2 },   // 공허의 고치 (괴수화)
  burnB: { url: 'assets/models/burnB/burnB.glb', h: 10, fit: 'max' },   // 괴수화 불지네: 가장 긴 변 기준
};
const cache = {};
export const vcReady = id => cache[id];
export function preloadVC(id) {
  const d = VC[id], w = typeof window !== 'undefined' ? window : {};
  return new Promise(res => loadGLB(w['__' + id.toUpperCase() + '_URL'] || d.url, gl => {
    try {
      const obj = gl.scene; obj.traverse(o => { if (o.isMesh) { o.material.side = THREE.FrontSide; o.material.roughness = .7; o.material.metalness = 0; const nr = o.geometry.attributes.normal; if (nr) for (let i = 0; i < nr.count; i++) { if (nr.getX(i) * nr.getX(i) + nr.getY(i) * nr.getY(i) + nr.getZ(i) * nr.getZ(i) < 1e-8) nr.setXYZ(i, 0, 1, 0); } } });   // 길이 0 인 법선은 셰이더에서 NaN 이 되어 블룸으로 화면 전체가 까맣게 된다
      obj.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(obj), s = bx.getSize(new THREE.Vector3());
      cache[id] = { scene: obj, off: new THREE.Vector3(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2), scale: d.h / (d.fit === 'max' ? Math.max(s.x, s.y, s.z) : s.y), size: s };
    } catch (e) { console.warn(id + ' glb setup failed', e); }
    res(cache[id] || null);
  }, e => { console.warn(id + ' glb load failed', e); res(null); }));
}
export function applyVC(id, rig) {
  const c = cache[id], { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const m = VC[id].skinned ? skClone(c.scene) : c.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(c.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(c.scale);
  if (VC[id].fit === 'max' && c.size.x > c.size.z) holder.rotation.y = VC[id].yaw ?? -Math.PI / 2;   // 긴 몸통이 앞(+z)을 향하도록
  head.position.set(0, 1.9, 0); torso.position.set(0, 1.1, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }
  rig.headY = 1.9;
}

export function makeVCModel(id) {   // 이름 붙은 정점색 모델을 독립 그룹으로 하나 더 만든다 (변신 모델 등)
  const c = cache[id]; if (!c) return null; const m = c.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(c.off); const h = new THREE.Group(); h.add(m); h.scale.setScalar(c.scale); return h;
}
let phCache = null;
export function buildPitayaHead() {   // 용과드래곤 모델에서 머리 부분(삼각형)만 떼어낸 메시. 앞(+z)을 향한다
  const c = cache.pitayaD; if (!c) return null;
  if (!phCache) {
    let mesh = null; c.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; }); if (!mesh || !mesh.geometry.index) return null;
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index.array, keep = [], inb = i => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return x >= -.34 && x <= -.12 && y >= 0 && y <= .3 && z >= .12 && z <= .45; };
    for (let t = 0; t < idx.length; t += 3) if (inb(idx[t]) && inb(idx[t + 1]) && inb(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    const ng = new THREE.BufferGeometry(); for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]); ng.setIndex(keep); ng.computeBoundingBox();
    const bb = ng.boundingBox, ctr = bb.getCenter(new THREE.Vector3()); phCache = { ng, ctr, size: Math.max(...bb.getSize(new THREE.Vector3()).toArray()), mat: mesh.material };
  }
  const m = new THREE.Mesh(phCache.ng, phCache.mat.clone()); m.position.sub(phCache.ctr); m.frustumCulled = false; const w = new THREE.Group(); w.add(m); w.userData.size = phCache.size; return w;
}
