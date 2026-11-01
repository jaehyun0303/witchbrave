// 퓨어바닐라 쿠키 glb(한 덩어리 메시, 리깅 없음). 몸 전체를 rig 의 body 에 올린다.
// 모델 좌표: 정면 +z. 발끝 y=0, 가운데 정렬 후 높이를 맞춘다.
import * as THREE from 'three';
import { loadGLB } from './glbload.js';

export const PV_H = 2.35;   // 게임 안 목표 키
let cache = null;
export const pvReady = () => cache;
export function preloadPv() {
  const w = typeof window !== 'undefined' ? window : {};
  return new Promise(res => loadGLB(w.__PV_URL || 'assets/models/purevanilla.glb', gl => {
    try {
      const scene = gl.scene; scene.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(scene), s = bx.getSize(new THREE.Vector3());
      cache = { scene, off: new THREE.Vector3(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2), scale: PV_H / s.y };
    } catch (e) { console.warn('pv failed', e); }
    res(cache);
  }, e => { console.warn('pv glb load failed', e); res(null); }));
}
export function applyPv(rig) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const m = cache.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(cache.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(cache.scale);
  head.position.set(0, 1.65, 0); torso.position.set(0, 1.0, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }
  rig.headY = 1.65;
}
