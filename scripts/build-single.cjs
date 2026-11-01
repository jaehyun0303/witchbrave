// 링크(아티팩트)용 단일 HTML 을 만든다: 번들 + 모델(glb)을 data URL 로 인라인.  사용: node scripts/build-single.cjs <출력 html 경로>
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..'), out = process.argv[2];
const tmp = path.join(path.dirname(out), 'game.min.js');
execSync(`npx esbuild src/main.js --bundle --minify --loader:.html=text --outfile="${tmp}"`, { cwd: root, stdio: 'inherit' });
const h = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const style = h.match(/<style>[\s\S]*?<\/style>/)[0];
const font = (h.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [''])[0];
const body = h.match(/<body>([\s\S]*)<script src="game.js"><\/script>/)[1];
const js = fs.readFileSync(tmp, 'utf8').replace(/<\/script/gi, '<\\/script');
const u = f => 'data:model/gltf-binary;base64,' + fs.readFileSync(path.join(root, 'models', f)).toString('base64');
const urls = { LICH: 'lich.glb', SUGAR: 'sugar.glb', AXE: 'axe.glb', DRAGON: 'lich-rig.glb', DARK: 'dark.glb', SHADOW: 'shadow.glb', SHADOWFACE: 'shadow-face.glb' };
const data = Object.entries(urls).filter(([, f]) => fs.existsSync(path.join(root, 'models', f))).map(([k, f]) => `window.__${k}_URL="${u(f)}";`).join('');
const html = '<title>위치브레이브</title>\n' + font + '\n' + style + '\n' + body + '\n<script>' + data + '</script>\n<script>' + js + '</script>\n';
fs.writeFileSync(out, html); console.log((html.length / 1e6).toFixed(2) + 'MB ->', out);
