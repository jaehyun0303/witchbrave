// 쉐도우밀크 쿠키 glb(부위별 오브젝트 + 정점 색). 몸 전체를 한 덩어리로 rig 의 body 에 올린다 (움직이는 부위 리깅은 추후).
// 모델 좌표: 정면 +z. 발끝 y=0, 가운데 정렬로 옮긴 뒤 높이를 맞춘다.
import * as THREE from 'three';
import { loadGLB } from './glbload.js';

export const SHADOW_H = 2.3;   // 게임 안 목표 키
let cache = null;
export const shadowReady = () => cache;
// 몸(shadow.glb)과 얼굴(shadow-face.glb, 눈 무늬 때문에 더 촘촘하게 줄임)을 따로 받아 한 그룹으로 합친다.
const load = url => new Promise(res => loadGLB(url, gl => res(gl.scene), e => { console.warn('shadow glb load failed', url, e); res(null); }));
export function preloadShadow() {
  const w = typeof window !== 'undefined' ? window : {};
  return Promise.all([load(w.__SHADOW_URL || 'assets/models/shadow.glb'), load(w.__SHADOWFACE_URL || 'assets/models/shadow-face.glb')]).then(([body, face]) => {
    try {
      if (!body) return null;
      const scene = new THREE.Group(); scene.add(body); if (face) scene.add(face);
      scene.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(scene), s = bx.getSize(new THREE.Vector3());
      cache = { scene, off: new THREE.Vector3(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2), scale: SHADOW_H / s.y };
    } catch (e) { console.warn('shadow failed', e); }
    return cache;
  });
}

export function applyShadow(rig) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const m = cache.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(cache.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(cache.scale);
  head.position.set(0, 1.65, 0); torso.position.set(0, 1.0, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }   // 지팡이는 모델에 포함
  rig.headY = 1.65;
}
