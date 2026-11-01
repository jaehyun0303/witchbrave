// 큰 OBJ(정점 색 포함, Nomad Sculpt 출력)를 스트리밍으로 읽어 GLB 로 바꾼다. 사용: node obj2glb.cjs in.obj out.glb
const fs = require('fs'), readline = require('readline');
const [, , inp, out] = process.argv;
const MAXV = 6000000, MAXI = 34000000;
const pos = new Float32Array(MAXV * 3), col = new Float32Array(MAXV * 3), idx = new Uint32Array(MAXI);
let nv = 0, ni = 0, hasCol = false; const prims = [{ name: "start", i0: 0 }];
const rl = readline.createInterface({ input: fs.createReadStream(inp, { highWaterMark: 1 << 24 }), crlfDelay: Infinity });
rl.on('line', line => {
  const c = line.charCodeAt(0);
  if (c === 111 && line.charCodeAt(1) === 32) { prims.push({ name: line.slice(2).trim(), i0: ni }); }   // o 오브젝트 시작
  else if (c === 118 && line.charCodeAt(1) === 32) {          // v
    const p = line.split(' '); const o = nv * 3;
    pos[o] = +p[1]; pos[o + 1] = +p[2]; pos[o + 2] = +p[3];
    if (p.length >= 7) { col[o] = +p[4]; col[o + 1] = +p[5]; col[o + 2] = +p[6]; hasCol = true; } else { col[o] = col[o + 1] = col[o + 2] = 1; }
    nv++;
  } else if (c === 102 && line.charCodeAt(1) === 32) {   // "f "
    const p = line.split(' '), n = p.length - 1, f = [];
    for (let i = 1; i <= n; i++) f.push(parseInt(p[i], 10) - 1);
    for (let i = 1; i < n - 1; i++) { idx[ni++] = f[0]; idx[ni++] = f[i]; idx[ni++] = f[i + 1]; }
  }
});
rl.on('close', () => {
  console.log('verts', nv, 'indices', ni, 'tris', ni / 3, 'vertexColor', hasCol);
  const P = Buffer.from(pos.buffer, 0, nv * 12), C = Buffer.from(col.buffer, 0, nv * 12), I = Buffer.from(idx.buffer, 0, ni * 4); prims.push({ name: 'end', i0: ni }); const real = []; for (let k = 0; k < prims.length - 1; k++) if (prims[k + 1].i0 > prims[k].i0) real.push({ name: prims[k].name, i0: prims[k].i0, n: prims[k + 1].i0 - prims[k].i0 }); const only = (process.env.OBJ_ONLY || '').split(',').filter(Boolean), skip = (process.env.OBJ_SKIP || '').split(',').filter(Boolean); for (let k = real.length - 1; k >= 0; k--) if ((only.length && !only.includes(real[k].name)) || skip.includes(real[k].name)) real.splice(k, 1);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const bin = Buffer.concat([P, C, I]);
  const json = {
    asset: { version: '2.0', generator: 'obj2glb' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'shadow' }],
    meshes: [{ primitives: real.map((p, k) => ({ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2 + k, material: 0, extras: { name: p.name } })) }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .6 }, doubleSided: false }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
      ...real.map(p => ({ bufferView: 2, byteOffset: p.i0 * 4, componentType: 5125, count: p.n, type: 'SCALAR' })),
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.length, target: 34962 }, { buffer: 0, byteOffset: P.length, byteLength: C.length, target: 34962 }, { buffer: 0, byteOffset: P.length + C.length, byteLength: I.length, target: 34963 }],
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 32)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(out, Buffer.concat([head, jh, js, bh, bin])); console.log('wrote', out, (fs.statSync(out).size / 1048576).toFixed(0) + 'MB', 'bbox', mn.map(v => v.toFixed(3)), mx.map(v => v.toFixed(3)));
});
