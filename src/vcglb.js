// 정점색(COLOR_0) glb 쿠키 로더 (버닝스파이스, 세인트릴리). 정적 단일 메시, 리깅 없음.
// 높이를 맞추고 발끝 y=0, 가운데 정렬해서 rig 의 body 에 통째로 올린다.
// 원본(Tripo 115만 정점, 조각난 UV 아틀라스)은 줄이면 텍스처가 깨져서, 색을 정점색으로 구워 클러스터링한 glb 를 쓴다
// (scripts/_bake.html + scripts/_recv.cjs 로 생성 → www/assets/models/<id>/<id>.glb, 텍스처 없음).
import * as THREE from 'three';
import { loadGLB } from './glbload.js';

const VC = {
  burn: { url: 'assets/models/burning/burning.glb', h: 2.7 },
  lily: { url: 'assets/models/lily/lily.glb', h: 2.7 },
  pva: { url: 'assets/models/pva/pva.glb', h: 2.6 },
  burnA: { url: 'assets/models/burnA/burnA.glb', h: 2.9 },
  dkk: { url: 'assets/models/dkk/dkk.glb', h: 2.8 },
  burnB: { url: 'assets/models/burnB/burnB.glb', h: 6.5, fit: 'max' },   // 괴수화 불지네: 가장 긴 변 기준
};
const cache = {};
export const vcReady = id => cache[id];
export function preloadVC(id) {
  const d = VC[id], w = typeof window !== 'undefined' ? window : {};
  return new Promise(res => loadGLB(w['__' + id.toUpperCase() + '_URL'] || d.url, gl => {
    try {
      const obj = gl.scene; obj.traverse(o => { if (o.isMesh) { o.material.side = THREE.FrontSide; o.material.roughness = .7; o.material.metalness = 0; } });
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
  const m = c.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(c.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(c.scale);
  if (VC[id].fit === 'max' && c.size.x > c.size.z) holder.rotation.y = VC[id].yaw ?? -Math.PI / 2;   // 긴 몸통이 앞(+z)을 향하도록
  head.position.set(0, 1.9, 0); torso.position.set(0, 1.1, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }
  rig.headY = 1.9;
}
