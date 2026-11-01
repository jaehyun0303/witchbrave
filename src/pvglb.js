// Tripo FBX 쿠키 모델 로더 (FBX + 베이스컬러 텍스처, 리깅 없음). 몸 전체를 rig 의 body 에 올린다.
// 높이를 맞추고 발끝 y=0, 가운데 정렬한다. 새 캐릭터는 FBX 표에 한 줄 추가.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const FBX = {
  pv: { fbx: 'assets/models/pv/pv.fbx', tex: 'assets/models/pv/pv_base.jpg', h: 2.35 },
  silent: { fbx: 'assets/models/silent/silent.fbx', tex: 'assets/models/silent/silent_base.jpg', h: 2.5 },
};
const cache = {};
export const fbxReady = id => cache[id];
const fetchBuf = url => url.startsWith('data:')
  ? Promise.resolve((() => { const bin = atob(url.slice(url.indexOf(',') + 1)), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; })())
  : fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
export function preloadFbx(id) {
  const w = typeof window !== 'undefined' ? window : {}, d = FBX[id], K = id.toUpperCase();
  return fetchBuf(w['__' + K + 'FBX_URL'] || d.fbx).then(buf => new Promise((res, rej) => {
    const obj = new FBXLoader().parse(buf, '');
    new THREE.TextureLoader().load(w['__' + K + 'TEX_URL'] || d.tex, map => {
      map.colorSpace = THREE.SRGBColorSpace; map.flipY = true; map.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map, roughness: .65, metalness: 0 });
      obj.traverse(o => { if (o.isMesh) o.material = mat; });
      obj.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(obj), s = bx.getSize(new THREE.Vector3());
      cache[id] = { scene: obj, off: new THREE.Vector3(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2), scale: d.h / s.y, size: s };
      res(cache[id]);
    }, undefined, rej);
  })).catch(e => { console.warn(id + ' fbx load failed', e); return null; });
}
export function applyFbx(id, rig) {
  const c = cache[id], { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const m = c.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  m.position.copy(c.off); const holder = new THREE.Group(); holder.add(m); holder.scale.setScalar(c.scale);
  head.position.set(0, 1.65, 0); torso.position.set(0, 1.0, 0); armR.add(hand);
  body.add(holder, legL, legR, torso, head, armL, armR);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }
  rig.headY = 1.65;
}
