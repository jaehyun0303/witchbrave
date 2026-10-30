import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { preloadDark, debugMaterial } from './darkglb.js';
import { buildCookie } from './models.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a93a8);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100); cam.position.set(0, 1.2, 5.2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 3, 4); scene.add(d);
const ctl = new OrbitControls(cam, r.domElement); ctl.target.set(0, 1.1, 0);
const q = new URLSearchParams(location.search); let rig;
preloadDark().then(() => {
  rig = buildCookie({ id: 'dark', color: 0xd8202f }); scene.add(rig.root); window.__rig = rig;
  if (q.get('color')) rig.skinned.material = debugMaterial(rig.skinned.geometry);
});
// swing: 지팡이 팔(armR)과 얇은 팔(armL)을 게임의 공격 자세처럼 돌려 본다
r.setAnimationLoop(t => { if (rig && q.get('swing')) { const T = t / 1000, u = Math.abs(Math.sin(T * 1.5)); rig.armR.rotation.set(-1.55 * u, 0, -.2 * u); rig.armL.rotation.set(-1.2 * u, 0, .3 * u); } ctl.update(); r.render(scene, cam); });
