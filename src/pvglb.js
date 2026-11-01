// 퓨어바닐라 쿠키 모델 (Tripo FBX + 베이스컬러 텍스처, 리깅 없음). 몸 전체를 rig 의 body 에 올린다.
// 높이는 PV_H 로 맞추고 발끝 y=0, 가운데 정렬한다.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export const PV_H = 2.35;   // 게임 안 목표 키
let cache = null;
export const pvReady = () => cache;
const fetchBuf = url => url.startsWith('data:')
  ? Promise.resolve((() => { const bin = atob(url.slice(url.indexOf(',') + 1)), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; })())
  : fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
export function preloadPv() {
  const w = typeof window !== 'undefined' ? window : {};
  return fetchBuf(w.__PVFBX_URL || 'assets/models/pv/pv.fbx').then(buf => new Promise((res, rej) => {
    const obj = new FBXLoader().parse(buf, ''), texUrl = w.__PVTEX_URL || 'assets/models/pv/pv_base.jpg';
    new THREE.TextureLoader().load(texUrl, map => {
      map.colorSpace = THREE.SRGBColorSpace; map.flipY = true; map.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map, roughness: .65, metalness: 0 });
      obj.traverse(o => { if (o.isMesh) o.material = mat; });
      obj.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(obj), s = bx.getSize(new THREE.Vector3());
      cache = { scene: obj, off: new THREE.Vector3(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2), scale: PV_H / s.y, size: s };
      res(cache);
    }, undefined, rej);
  })).catch(e => { console.warn('pv load failed', e); return null; });
}
export function applyPv(rig) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const m = cache.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(cache.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(cache.scale);
  head.position.set(0, 1.65, 0); torso.position.set(0, 1.0, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }
  rig.headY = 1.65;
}
