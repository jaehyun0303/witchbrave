// 파티클 + 메시 이펙트 라이브러리 (전부 가산 블렌딩 + 블룸으로 화려하게)
import * as THREE from 'three';
import { tex } from './tex.js';

const C = new THREE.Color(), C2 = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = { out: p => 1 - Math.pow(1 - p, 3), in: p => p * p * p, io: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2 };
export { ease };

/* ---------- GPU 포인트 파티클 ---------- */
class Emitter {
  constructor(scene, texName, max, blending) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.d = new Float32Array(max * 12); // life,maxLife,s0,s1,r0,g0,b0,r1,g1,b1,a0,grav ; drag 따로
    this.drag = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex(texName) }, uScale: { value: 500 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale;
        void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uScale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC.rgb*t.rgb, t.a*vC.a); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 10;
    scene.add(this.pts);
  }
  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3, k = i * 12;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c0 = C.set(o.c0 ?? 0xffffff), c1 = C2.set(o.c1 ?? o.c0 ?? 0xffffff);
    const d = this.d; d[k] = 0; d[k + 1] = o.life || 1; d[k + 2] = o.s0 ?? .5; d[k + 3] = o.s1 ?? 0;
    d[k + 4] = c0.r; d[k + 5] = c0.g; d[k + 6] = c0.b; d[k + 7] = c1.r; d[k + 8] = c1.g; d[k + 9] = c1.b;
    d[k + 10] = o.a ?? 1; d[k + 11] = o.grav || 0; this.drag[i] = o.drag || 0;
    this.col[i * 4 + 3] = 0; this.size[i] = d[k + 2];
  }
  copy(a, b) { // b -> a
    for (let j = 0; j < 3; j++) { this.pos[a * 3 + j] = this.pos[b * 3 + j]; this.vel[a * 3 + j] = this.vel[b * 3 + j]; }
    for (let j = 0; j < 12; j++) this.d[a * 12 + j] = this.d[b * 12 + j];
    this.drag[a] = this.drag[b];
  }
  update(dt, uScale) {
    this.mat.uniforms.uScale.value = uScale;
    const { pos, vel, col, size, d, drag } = this;
    for (let i = 0; i < this.n;) {
      const k = i * 12; d[k] += dt;
      if (d[k] >= d[k + 1]) { this.n--; if (i < this.n) this.copy(i, this.n); continue; }
      const p = d[k] / d[k + 1], i3 = i * 3, dr = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - d[k + 11] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const c = i * 4;
      col[c] = d[k + 4] + (d[k + 7] - d[k + 4]) * p; col[c + 1] = d[k + 5] + (d[k + 8] - d[k + 5]) * p; col[c + 2] = d[k + 6] + (d[k + 9] - d[k + 6]) * p;
      col[c + 3] = d[k + 10] * Math.min(1, p * 10) * (1 - p) * (1 - p * .3);
      size[i] = d[k + 2] + (d[k + 3] - d[k + 2]) * p;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
}

/* ---------- 공용 지오메트리/머티리얼 ---------- */
const planeGeo = new THREE.PlaneGeometry(1, 1);
const colGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, .5, 0);
function addMat(map, color, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra });
}

export class VFX {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera; this.items = [];
    this.em = {
      glow: new Emitter(scene, 'glow', 5000, THREE.AdditiveBlending),
      spark: new Emitter(scene, 'spark', 2500, THREE.AdditiveBlending),
      heart: new Emitter(scene, 'heart', 600, THREE.AdditiveBlending),
      smoke: new Emitter(scene, 'smoke', 800, THREE.NormalBlending),
    };
  }
  emit(t, o) { this.em[t].emit(o); }

  update(dt, scale) {
    for (const k in this.em) this.em[k].update(dt, scale);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      const p = it.dur > 0 ? Math.min(1, it.t / it.dur) : 0;
      if (it.fn) it.fn(p, it.obj, dt);
      if (it.dur > 0 && it.t >= it.dur) this.drop(it);
    }
  }
  drop(it) {
    this.scene.remove(it.obj); it.obj.traverse?.(o => o.material && o.material.dispose && o.userData.own !== false && o.material.dispose());
    const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1);
  }
  add(obj, dur, fn) { this.scene.add(obj); const it = { obj, t: 0, dur, fn }; this.items.push(it); return it; }
  remove(it) { if (it) this.drop(it); }

  /* ----- 파티클 헬퍼 ----- */
  // 구/원뿔 형태로 퍼지는 폭발
  burst(texName, p, n, o = {}) {
    for (let i = 0; i < n; i++) {
      let dx, dy, dz;
      if (o.dir) { // 원뿔
        const a = rnd(0, 6.283), s = Math.tan(o.spread ?? .4) * Math.random();
        dx = o.dir.x + Math.cos(a) * s; dy = o.dir.y + Math.sin(a) * s; dz = o.dir.z + Math.cos(a + 1.3) * s;
      } else { dx = rnd(-1, 1); dy = o.flat ? rnd(0, .1) : rnd(-1, 1); dz = rnd(-1, 1); }
      const l = Math.hypot(dx, dy, dz) || 1, sp = rnd(o.speed ?? 4, o.speed2 ?? (o.speed ?? 4) * 1.6);
      this.emit(texName, {
        x: p.x + rnd(-1, 1) * (o.rad || 0), y: p.y + rnd(-1, 1) * (o.radY ?? o.rad ?? 0), z: p.z + rnd(-1, 1) * (o.rad || 0),
        vx: dx / l * sp, vy: dy / l * sp + (o.up || 0), vz: dz / l * sp,
        life: rnd(o.life ?? .5, o.life2 ?? (o.life ?? .5) * 1.5), s0: o.size ?? .4, s1: o.size1 ?? 0,
        c0: o.c0 ?? 0xffffff, c1: o.c1 ?? o.c0 ?? 0xffffff, a: o.a ?? 1, grav: o.grav || 0, drag: o.drag ?? 1.5,
      });
    }
  }
  // 선분을 따라 파티클 (잔상/궤적)
  line(texName, a, b, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      this.emit(texName, {
        x: a.x + (b.x - a.x) * u + rnd(-1, 1) * (o.rad || 0), y: a.y + (b.y - a.y) * u + rnd(-1, 1) * (o.rad || 0), z: a.z + (b.z - a.z) * u + rnd(-1, 1) * (o.rad || 0),
        vx: rnd(-1, 1) * (o.v || 0), vy: rnd(-1, 1) * (o.v || 0) + (o.up || 0), vz: rnd(-1, 1) * (o.v || 0),
        life: rnd(o.life ?? .4, (o.life ?? .4) * 1.6), s0: o.size ?? .5, s1: o.size1 ?? 0, c0: o.c0 ?? 0xffffff, c1: o.c1 ?? o.c0 ?? 0xffffff, a: o.a ?? 1, drag: 2,
      });
    }
  }

  /* ----- 메시 이펙트 ----- */
  // 바닥에 깔리는 링 (충격파)
  ring(p, o = {}) {
    const m = new THREE.Mesh(planeGeo, addMat(tex(o.tex || 'ring'), o.color ?? 0xffffff, o.alpha ?? 1));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, (o.y ?? .06) + (p.y || 0), p.z); m.renderOrder = 5;
    const r0 = o.r0 ?? .5, r1 = o.r1 ?? 6;
    return this.add(m, o.dur ?? .6, (u, ob) => {
      const r = (r0 + (r1 - r0) * ease.out(u)) * 2; ob.scale.set(r, r, 1); ob.material.opacity = (o.alpha ?? 1) * (1 - u) * (1 - u);
    });
  }
  // 수직 광기둥
  column(p, o = {}) {
    const m = new THREE.Mesh(colGeo, addMat(tex(o.tex || 'beam'), o.color ?? 0xffffff, 1));
    m.position.set(p.x, p.y || 0, p.z); m.renderOrder = 6;
    const r = o.r ?? 2, h = o.h ?? 14;
    return this.add(m, o.dur ?? .8, (u, ob) => {
      const grow = Math.min(1, u * 5), w = r * (1 + u * .3) * (1 - u * .6);
      ob.scale.set(w * grow + .001, h * ease.out(grow), w * grow + .001);
      ob.rotation.y += .1; ob.material.opacity = (u < .15 ? 1 : (1 - (u - .15) / .85)) * (o.alpha ?? 1);
    });
  }
  // 정지/지속형 바닥 데칼 (룬, 균열). 반환된 item 을 remove() 로 제거
  decal(p, o = {}) {
    const m = new THREE.Mesh(planeGeo, addMat(tex(o.tex || 'rune'), o.color ?? 0xffffff, o.alpha ?? .9));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, (o.y ?? .05), p.z); m.renderOrder = 4;
    const r = (o.r ?? 3) * 2; m.scale.set(r, r, 1);
    return this.add(m, o.dur ?? 0, (u, ob, dt) => {
      if (o.spin) ob.rotation.z += o.spin * dt;
      if (o.dur) ob.material.opacity = (o.alpha ?? .9) * (u < .12 ? u / .12 : 1 - (u - .12) / .88);
    });
  }
  // 빌보드 스프라이트 섬광
  flash(p, o = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(o.tex || 'glow'), color: o.color ?? 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: o.rot || 0 }));
    s.position.set(p.x, p.y, p.z); s.renderOrder = 12;
    const sz = o.size ?? 3;
    return this.add(s, o.dur ?? .25, (u, ob) => { const k = sz * (o.grow ? .4 + .6 * ease.out(u) : 1 - u * .5); ob.scale.set(k * (o.sx || 1), k, 1); ob.material.opacity = (1 - u) * (o.a ?? 1); });
  }
  // 바닥 위 초승달 베기 (근접 공격)
  slashGround(p, yaw, o = {}) {
    const m = new THREE.Mesh(planeGeo, addMat(tex('slash'), o.color ?? 0xffffff, 1));
    m.rotation.set(-Math.PI / 2, 0, 0); const g = new THREE.Group(); g.add(m); g.rotation.y = yaw; g.position.set(p.x, p.y ?? .9, p.z);
    m.position.z = (o.len ?? 3) * .55; m.position.y = 0; m.renderOrder = 8; m.rotation.z = Math.PI; // 볼록한 면이 앞쪽
    const L = o.len ?? 3, from = o.from ?? -1;
    return this.add(g, o.dur ?? .25, (u, ob) => {
      const k = ease.out(u); m.scale.set(L * 1.5 * (.6 + k * .5), L * 1.2 * (.5 + k * .5), 1);
      g.rotation.y = yaw + from * (1 - k) * 1.2; m.material.opacity = 1 - u * u;
    });
  }
  // 카메라를 향하는 베기 선 (X 베기 등)
  slashBB(p, o = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('spark'), color: o.color ?? 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: o.rot ?? 0 }));
    s.position.set(p.x, p.y, p.z); s.renderOrder = 12;
    const L = o.len ?? 5;
    return this.add(s, o.dur ?? .3, (u, ob) => { const e = ease.out(Math.min(1, u * 3)); ob.scale.set(L * e, .35 * (1 - u) * (o.w ?? 1) + .02, 1); ob.material.opacity = 1 - u; });
  }
  // 에너지 돔 (침묵의 심판 등)
  dome(p, r, color) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uA: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); vP=position; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.2);
          float lines=.5+.5*sin(vP.y*18.-uT*2.)*sin(atan(vP.z,vP.x)*14.+uT);
          float base=smoothstep(.0,.35,1.-vP.y)*.12;
          float a=(f*.55+base*.6+lines*.05*f)*uA*.7; gl_FragColor=vec4(uC*(1.+f),a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    m.position.set(p.x, 0, p.z); m.scale.setScalar(.01); m.renderOrder = 3;
    const it = this.add(m, 0, (u, ob, dt) => {
      mat.uniforms.uT.value += dt; it.k = Math.min(1, (it.k ?? 0) + dt * (it.closing ? -3 : 2.2));
      const s = r * ease.out(Math.max(0, it.k)); ob.scale.setScalar(Math.max(.01, s)); mat.uniforms.uA.value = Math.max(0, it.k);
      if (it.closing && it.k <= 0) this.drop(it);
    });
    return it;
  }
}
