// 빌드 후 www 를 8080 으로 서빙한다. (esbuild --serve 는 stdin 이 닫히면 종료돼서 미리보기에 쓸 수 없다)
const { execSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
execSync('npm run build', { cwd: root, stdio: 'inherit' });
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json' };
http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const p = path.join(root, 'www', u);
  if (!p.startsWith(path.join(root, 'www'))) { s.writeHead(403); return s.end(); }
  fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); return s.end('404'); } s.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); s.end(d); });
}).listen(8080, () => console.log('http://localhost:8080'));
