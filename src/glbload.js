// glb 로더. data: URL 은 fetch 가 막힌 환경(아티팩트)에서도 쓰이도록 직접 디코딩해서 parse 한다.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export function loadGLB(url, ok, fail) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (url.startsWith('data:')) {
    try {
      const bin = atob(url.slice(url.indexOf(',') + 1)), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      loader.parse(buf.buffer, '', ok, fail);
    } catch (e) { fail(e); }
  } else loader.load(url, ok, undefined, fail);
}
