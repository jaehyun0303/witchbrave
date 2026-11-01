// 3D 쿠키 모델을 투명 PNG 한 장으로 찍어 로딩 화면·컷신에서 쓴다 (별도 작은 렌더러, 찍고 바로 해제).
import * as THREE from 'three';
import { buildCookie } from './models.js';

const DEF = { silent: { id: 'silent', color: 0x8fa4ff }, shadow: { id: 'shadow', color: 0x3a7bff }, pv: { id: 'pv', color: 0xfff0a8 } };
const cache = {};
export function portraitURL(id, turn = 0) {
  const key = id + turn; if (cache[key]) return cache[key];
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); r.setSize(520, 760); r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene(), rig = buildCookie(DEF[id]); rig.root.rotation.y = turn; sc.add(rig.root);
  if (rig.weapon) rig.weapon.rotation.x = -.5;
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8a7fc0, 1.5)); const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(-3, 5, 6); sc.add(d);
  const rim = new THREE.DirectionalLight(id === 'shadow' ? 0x6a9bff : 0xffe9a0, 1.6); rim.position.set(4, 3, -4); sc.add(rim);
  const cam = new THREE.PerspectiveCamera(28, 520 / 760, .1, 50); cam.position.set(0, 1.35, 7.4); cam.lookAt(0, 1.2, 0);
  r.render(sc, cam); const url = r.domElement.toDataURL('image/png');
  r.dispose(); r.forceContextLoss(); return cache[key] = url;
}
export const portraitImg = (id, turn, style) => `<img alt="" src="${portraitURL(id, turn)}" style="${style}">`;
