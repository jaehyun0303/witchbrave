// 뽑기 연출: 오븐 앞에 줄 선 쿠키들 → 장면 전환 → 마녀가 반죽을 젓고, 밀고, 커터로 찍고, 오븐에 굽는다 → 쿠키 등장.
// 가장 높은 등급에 따라 반죽 색이 다르다. 전부 SVG + CSS 애니메이션이라 별도 에셋이 없다.
const OUT = '#2b1830';
export const GRADE = [null,
  { name: '커먼', glow: '#ffb870', dough: '#d19a5c', dark: '#a8703a' },
  { name: '레어', glow: '#5ec8ff', dough: '#7fd6ff', dark: '#3a9ad8' },
  { name: '에픽', glow: '#b27cff', dough: '#b98aff', dark: '#7a4ad8' },
  { name: '슈퍼에픽', glow: '#ff7ac0', dough: '#ff8ac8', dark: '#c83a8a' },
  { name: '레전더리', glow: '#ffd23c', dough: '#ffd23c', dark: '#e0a000' },
  { name: '에인션트', glow: '#4de8b0', dough: '#3fe0a8', dark: '#12906a' },
  { name: '비스트', glow: '#ff5a4d', dough: '#d8283c', dark: '#5a0a1a' },
  { name: '드래곤', glow: '#9a7aff', dough: 'url(#rb)', dark: '#5a3ad8', rainbow: true }];

// 쿠키(진저브레드) 모양: 윤곽선을 먼저 굵게 깔고 그 위에 색을 칠해서 깔끔한 실루엣을 만든다
function shapes(fill, stroke, sw) {
  const a = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  return `<ellipse cx="-44" cy="-46" rx="13" ry="30" transform="rotate(38 -44 -46)" ${a}/><ellipse cx="44" cy="-46" rx="13" ry="30" transform="rotate(-38 44 -46)" ${a}/>
  <ellipse cx="-17" cy="34" rx="15" ry="34" ${a}/><ellipse cx="17" cy="34" rx="15" ry="34" ${a}/><rect x="-32" y="-68" width="64" height="86" rx="26" ${a}/><circle cx="0" cy="-96" r="34" ${a}/>`;
}
function ginger(x, y, s, fill, o = {}) {
  const face = o.face === false ? '' : `<circle cx="${-11 + (o.look || 0)}" cy="-100" r="4.2" fill="${OUT}"/><circle cx="${11 + (o.look || 0)}" cy="-100" r="4.2" fill="${OUT}"/><path d="M${-9 + (o.look || 0)} -88 Q${(o.look || 0)} -80 ${9 + (o.look || 0)} -88" stroke="${OUT}" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="${-20 + (o.look || 0)}" cy="-90" r="5" fill="#ff8fa8" opacity=".7"/><circle cx="${20 + (o.look || 0)}" cy="-90" r="5" fill="#ff8fa8" opacity=".7"/><circle cx="0" cy="-40" r="5" fill="#fff" opacity=".55"/><circle cx="0" cy="-22" r="5" fill="#fff" opacity=".55"/>`;
  const body = `<g transform="translate(${x} ${y}) scale(${s})">${shapes(fill, o.stroke || OUT, o.sw || 7)}${shapes(fill, 'none', 0)}${face}</g>`;
  return o.cls ? `<g class="${o.cls}" ${o.style ? `style="${o.style}"` : ''}>${body}</g>` : body;
}
const DEFS = `<defs><linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".33" stop-color="#ff8ad0"/><stop offset=".66" stop-color="#7ae8ff"/><stop offset="1" stop-color="#ffe066"/></linearGradient>
<radialGradient id="ovg"><stop offset="0" stop-color="#fff6c0"/><stop offset=".5" stop-color="#ffa63c"/><stop offset="1" stop-color="#c8401c"/></radialGradient>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3a78"/><stop offset="1" stop-color="#8a5a8a"/></linearGradient></defs>`;

const CSS = `
.gf{position:absolute;left:0;top:0;width:1280px;height:720px;overflow:hidden;z-index:70;background:#2b1830;font-family:'Jua','Noto Sans KR',sans-serif}
.gf svg{position:absolute;left:0;top:0}
.gf .sc{position:absolute;inset:0}
.gf .iout{animation:iout .32s ease-in forwards}.gf .iin{animation:iin .38s ease-out both}
@keyframes iout{from{clip-path:circle(80% at 50% 55%)}to{clip-path:circle(0% at 50% 55%)}}
@keyframes iin{from{clip-path:circle(0% at 50% 55%)}to{clip-path:circle(80% at 50% 55%)}}
.gf .cap{position:absolute;left:0;right:0;bottom:46px;text-align:center;font-size:40px;color:#fff;-webkit-text-stroke:8px ${OUT};paint-order:stroke fill;z-index:3;animation:capin .4s both}
@keyframes capin{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
.gf .skip{position:absolute;right:22px;top:18px;z-index:9;height:44px;padding:0 20px;border:3px solid ${OUT};border-radius:16px;background:#fff3df;box-shadow:0 4px 0 ${OUT};font:inherit;font-size:20px;color:${OUT};cursor:pointer}
.bob{animation:bob .8s ease-in-out infinite alternate}@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-10px)}}
.flick{animation:flick .25s steps(2) infinite alternate}@keyframes flick{from{opacity:.85}to{opacity:1}}
.stir{animation:stir .62s linear infinite}@keyframes stir{0%{transform:translate(-46px,0)}25%{transform:translate(0,22px)}50%{transform:translate(46px,0)}75%{transform:translate(0,-18px)}100%{transform:translate(-46px,0)}}
.swirl{transform-origin:640px 478px;animation:spin 1.1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.hue{animation:hue 2.2s linear infinite}@keyframes hue{to{filter:hue-rotate(360deg)}}
.flat{transform-origin:700px 520px;animation:flat 1.5s ease-in-out both}@keyframes flat{0%{transform:scale(.35,1.1)}100%{transform:scale(1.6,.5)}}
.pin{animation:pin .5s ease-in-out 3 alternate both}@keyframes pin{from{transform:translateY(-50px)}to{transform:translateY(34px)}}
.cutter{animation:cutter 1.1s cubic-bezier(.5,0,.8,.4) both}@keyframes cutter{0%{transform:translateY(-330px)}60%{transform:translateY(0)}70%{transform:translateY(12px)}85%{transform:translateY(-6px)}100%{transform:translateY(-440px)}}
.cpop{animation:cpop .5s 0.62s cubic-bezier(.3,1.6,.5,1) both}@keyframes cpop{from{transform:scale(0) translateY(40px)}to{transform:scale(1) translateY(0)}}
.scrap{animation:fade .6s .9s both}@keyframes fade{to{opacity:0}}
.tray{animation:tray 1.1s .2s ease-in both}@keyframes tray{from{transform:translateX(-520px)}to{transform:translateX(0)}}
.door{animation:door .35s 1.4s ease-in both}@keyframes door{from{transform:translateY(-200px)}to{transform:none}}
.shake{animation:shake .12s linear infinite}@keyframes shake{0%{transform:translate(0,0)}25%{transform:translate(-3px,2px)}75%{transform:translate(3px,-2px)}}
.puff{animation:puff 1.2s ease-out infinite}@keyframes puff{from{transform:translateY(0) scale(.5);opacity:.9}to{transform:translateY(-120px) scale(1.7);opacity:0}}
.bar{transform-origin:left;animation:bar 1.9s .2s linear both}@keyframes bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.ray{transform-origin:640px 380px;animation:spin 6s linear infinite}
.flash{animation:flashf 1s ease-out both}@keyframes flashf{0%{opacity:1}100%{opacity:0}}
.rise{animation:rise 1s cubic-bezier(.2,1.2,.4,1) both}@keyframes rise{from{transform:translateY(120px) scale(.2);opacity:0}to{transform:none;opacity:1}}
.shock{transform-origin:640px 380px;animation:shock .9s ease-out both}@keyframes shock{from{transform:scale(.1);opacity:1}to{transform:scale(3.2);opacity:0}}
.spk{animation:spk .9s ease-out both}@keyframes spk{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
`;

// 오븐(정면): 문 창에 불빛
function oven(x, y, w, h, glow, extra = '') {
  const cx = x + w / 2;
  return `<g>${`<rect x="${x + w * .12}" y="${y - 70}" width="${w * .2}" height="80" rx="8" fill="#8a4a38" stroke="${OUT}" stroke-width="6"/>`}
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="34" fill="#c7664a" stroke="${OUT}" stroke-width="8"/>
  ${[0, 1, 2, 3].map(i => `<line x1="${x + 14}" y1="${y + 30 + i * 30}" x2="${x + w - 14}" y2="${y + 30 + i * 30}" stroke="#a84e38" stroke-width="3" opacity=".5"/>`).join('')}
  <rect x="${x + w * .12}" y="${y + h * .22}" width="${w * .76}" height="${h * .5}" rx="26" fill="${OUT}" stroke="${OUT}" stroke-width="6"/>
  <rect x="${x + w * .15}" y="${y + h * .25}" width="${w * .7}" height="${h * .44}" rx="20" fill="url(#ovg)" class="flick"/>
  <rect x="${x + w * .15}" y="${y + h * .25}" width="${w * .7}" height="${h * .44}" rx="20" fill="${glow}" opacity=".28"/>
  <rect x="${cx - w * .22}" y="${y + h * .78}" width="${w * .44}" height="14" rx="7" fill="#ffd873" stroke="${OUT}" stroke-width="4"/>
  ${extra}</g>`;
}

function sparkles(n, color, seed = 1) {
  let s = ''; for (let i = 0; i < n; i++) { const a = i / n * 6.283 + seed, d = 160 + (i * 53 % 140); s += `<g transform="translate(640 380)"><path class="spk" style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:${(i % 5) * .05}s" d="M0 -14 L4 -4 L14 0 L4 4 L0 14 L-4 4 L-14 0 L-4 -4Z" fill="${color}" stroke="#fff" stroke-width="2"/></g>`; }
  return s;
}

// 마녀 주방 배경 + 마녀
function kitchen(inner, witchArm = '') {
  return `<svg viewBox="0 0 1280 720" width="1280" height="720">${DEFS}
  <rect width="1280" height="720" fill="url(#wall)"/>
  <rect x="90" y="90" width="220" height="150" rx="16" fill="#1a1240" stroke="${OUT}" stroke-width="7"/><circle cx="220" cy="150" r="36" fill="#fff3c0"/><circle cx="236" cy="142" r="32" fill="#1a1240"/>
  <rect x="930" y="110" width="260" height="14" rx="6" fill="#6b4a3a" stroke="${OUT}" stroke-width="5"/>${[0, 1, 2, 3].map(i => `<rect x="${950 + i * 62}" y="${60}" width="40" height="50" rx="10" fill="${['#ff8ad0', '#7ae8ff', '#ffe066', '#a6ff9a'][i]}" stroke="${OUT}" stroke-width="4"/>`).join('')}
  <rect x="0" y="560" width="1280" height="160" fill="#7a4a30"/><rect x="0" y="556" width="1280" height="14" fill="#a8693f" stroke="${OUT}" stroke-width="4"/>
  <g>
    <path d="M200 700 L250 420 Q300 400 350 420 L400 700Z" fill="#4a2a8a" stroke="${OUT}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M250 340 Q250 300 300 300 Q350 300 350 340 L356 420 Q300 400 244 420Z" fill="#ff7ab8" stroke="${OUT}" stroke-width="5"/>
    <circle cx="300" cy="350" r="48" fill="#ffe0c0" stroke="${OUT}" stroke-width="7"/>
    <path d="M256 338 Q300 312 344 338 Q330 322 300 322 Q270 322 256 338Z" fill="#ff7ab8"/>
    <circle cx="284" cy="358" r="5" fill="${OUT}"/><circle cx="318" cy="358" r="5" fill="${OUT}"/><path d="M288 374 Q301 384 314 374" stroke="${OUT}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="300" cy="318" rx="92" ry="17" fill="#3a2a6a" stroke="${OUT}" stroke-width="7"/><path d="M236 318 L310 150 L366 318Z" fill="#3a2a6a" stroke="${OUT}" stroke-width="7" stroke-linejoin="round"/><rect x="246" y="290" width="112" height="22" fill="#ffd45c" stroke="${OUT}" stroke-width="5"/>
    ${witchArm}
  </g>${inner}</svg>`;
}
const arm = (x2, y2) => `<path d="M338 470 Q${(338 + x2) / 2} ${y2 - 30} ${x2} ${y2}" stroke="#4a2a8a" stroke-width="30" fill="none" stroke-linecap="round"/><path d="M338 470 Q${(338 + x2) / 2} ${y2 - 30} ${x2} ${y2}" stroke="${OUT}" stroke-width="40" fill="none" stroke-linecap="round" opacity=".0"/><circle cx="${x2}" cy="${y2}" r="17" fill="#ffe0c0" stroke="${OUT}" stroke-width="5"/>`;

// grades: 보상별 등급 배열(1~8). 반죽을 젓고 미는 장면은 가장 높은 등급 색으로 한 번, 이후 보상 1개마다 커터 → 오븐 → 쿠키 등장을 각자의 등급 색으로 보여준다.
// 화면을 탭하면 현재 보상을 건너뛰고 다음 보상으로, 건너뛰기 버튼은 연출 전체를 끝낸다. (자막/대사 없음)
export function playGacha(parent, grades, onDone) {
  if (!Array.isArray(grades)) grades = [grades];
  let G = GRADE[grades[0]] || GRADE[1], rb = G.rainbow ? 'hue' : '';
  const useGrade = g => { G = GRADE[g] || GRADE[1]; rb = G.rainbow ? 'hue' : ''; };
  const root = document.createElement('div'); root.className = 'gf'; root.innerHTML = `<style>${CSS}</style><div class="sc"></div><button class="skip">건너뛰기 ▶▶</button>`;
  parent.appendChild(root); const sc = root.querySelector('.sc'); let dead = false, timers = [], tm = 0;
  const at = (ms, fn) => timers.push(setTimeout(() => !dead && fn(), ms));
  const finish = () => { if (dead) return; dead = true; timers.forEach(clearTimeout); clearTimeout(tm); root.remove(); onDone && onDone(); };
  root.querySelector('.skip').onclick = finish;
  const cap = () => '';   // 자막 없음
  const dough = (o = {}) => G.dough;
  const set = html => { sc.innerHTML = html; sc.className = 'sc iin'; };
  const go = (html, wait) => { sc.className = 'sc iout'; at(320, () => set(html)); return wait + 320; };

  const SC = {};
  // ① 오븐 앞에 줄 선 쿠키들
  SC.line = () => {
    const cols = ['#f3c07a', '#ff9ab8', '#9ad8ff', '#c8a2ff', '#a6e8a0', '#ffe066'];
    return `<svg viewBox="0 0 1280 720" width="1280" height="720">${DEFS}<rect width="1280" height="720" fill="#ffd9a0"/><rect x="0" y="0" width="1280" height="300" fill="#ffe8bd"/><rect y="560" width="1280" height="160" fill="#b97a45"/><rect y="556" width="1280" height="14" fill="#d9a066" stroke="${OUT}" stroke-width="4"/>
    ${oven(760, 150, 420, 410, G.glow)}
    ${cols.map((c, i) => ginger(130 + i * 98, 535 - (i % 2) * 8, .86 + (i === 5 ? .04 : 0), c, { look: 6, cls: 'bob', style: `animation-delay:${i * .12}s` })).join('')}
    ${cap('쿠키들이 오븐 앞에 줄을 섰어요!')}</svg>`;
  };
  // ② 반죽 젓기
  SC.stir = () => kitchen(`
    <g class="${rb}"><path d="M470 478 Q640 410 810 478 L780 600 Q640 640 500 600Z" fill="#f2e6d0" stroke="${OUT}" stroke-width="7" stroke-linejoin="round"/>
    <ellipse cx="640" cy="478" rx="172" ry="44" fill="#fbf3e2" stroke="${OUT}" stroke-width="7"/><ellipse cx="640" cy="482" rx="150" ry="34" fill="${dough()}" stroke="${G.dark}" stroke-width="4"/>
    <g class="swirl"><path d="M520 484 Q580 450 640 482 Q700 512 760 478" stroke="#fff" stroke-width="7" fill="none" opacity=".55" stroke-linecap="round"/><path d="M570 492 Q640 520 700 470" stroke="${G.dark}" stroke-width="6" fill="none" opacity=".6" stroke-linecap="round"/></g></g>
    <g class="stir"><line x1="480" y1="260" x2="640" y2="486" stroke="#c88a50" stroke-width="16" stroke-linecap="round"/><line x1="480" y1="260" x2="640" y2="486" stroke="${OUT}" stroke-width="3" opacity=".35"/><ellipse cx="645" cy="492" rx="22" ry="30" fill="#d89a60" stroke="${OUT}" stroke-width="6" transform="rotate(-35 645 492)"/>${arm(480, 270)}</g>
    ${cap('마녀가 반죽을 휘휘 젓는 중…')}`);
  // ③ 반죽 밀기
  SC.roll = () => kitchen(`
    <g class="${rb}"><ellipse class="flat" cx="700" cy="520" rx="130" ry="64" fill="${dough()}" stroke="${G.dark}" stroke-width="5"/></g>
    <g class="pin"><rect x="540" y="438" width="320" height="42" rx="21" fill="#d89a60" stroke="${OUT}" stroke-width="7"/><rect x="500" y="448" width="50" height="22" rx="11" fill="#a8693f" stroke="${OUT}" stroke-width="5"/><rect x="850" y="448" width="50" height="22" rx="11" fill="#a8693f" stroke="${OUT}" stroke-width="5"/>${arm(520, 460)}</g>
    ${cap('밀대로 쭉쭉 밀어요!')}`);
  // ④ 커터로 찍기
  SC.cut = () => kitchen(`
    <g class="${rb}"><ellipse cx="700" cy="528" rx="260" ry="36" fill="${dough()}" stroke="${G.dark}" stroke-width="5"/></g>
    <g class="scrap"><ellipse cx="700" cy="528" rx="262" ry="38" fill="none"/></g>
    <g class="cutter" transform="translate(0 0)">${ginger(700, 520, 1.15, 'none', { stroke: '#cfd8e0', sw: 9, face: false })}<rect x="650" y="340" width="100" height="22" rx="11" fill="#cfd8e0" stroke="${OUT}" stroke-width="5"/>${arm(640, 350)}</g>
    <g class="cpop ${rb}" style="transform-origin:700px 520px">${ginger(700, 520, 1.1, dough(), { face: true, stroke: G.dark, sw: 5 })}</g>
    ${cap('쿠키 모양 커터로 꾹!')}`);
  // ⑤ 오븐에 굽기
  SC.bake = () => `<svg viewBox="0 0 1280 720" width="1280" height="720">${DEFS}<rect width="1280" height="720" fill="#3a1f3a"/><rect y="590" width="1280" height="130" fill="#7a4a30"/>
    <g class="shake">${oven(390, 110, 500, 480, G.glow)}</g>
    <g clip-path="inset(0)"><g class="tray"><rect x="480" y="372" width="320" height="16" rx="8" fill="#9aa4b0" stroke="${OUT}" stroke-width="5"/><g class="${rb}">${ginger(640, 376, .62, dough(), { stroke: G.dark, sw: 6 })}</g></g></g>
    <rect class="door" x="440" y="300" width="400" height="190" rx="22" fill="#c7664a" stroke="${OUT}" stroke-width="7"/>
    ${[0, 1, 2].map(i => `<circle class="puff" cx="${520 + i * 120}" cy="90" r="22" fill="#fff" opacity=".7" style="animation-delay:${i * .35}s"/>`).join('')}
    <rect x="440" y="598" width="400" height="24" rx="12" fill="#fff3df" stroke="${OUT}" stroke-width="6"/><rect class="bar" x="446" y="604" width="388" height="12" rx="6" fill="${G.glow}"/>
    ${cap('오븐에서 노릇노릇 굽는 중…')}</svg>`;
  // ⑥ 오븐 문이 열리며 쿠키 등장
  SC.pop = () => `<svg viewBox="0 0 1280 720" width="1280" height="720">${DEFS}<rect width="1280" height="720" fill="#1a1030"/>
    <g class="ray ${rb}" opacity=".85">${Array.from({ length: 12 }, (_, i) => `<path d="M640 380 L${640 + Math.cos(i / 12 * 6.283) * 900} ${380 + Math.sin(i / 12 * 6.283) * 900} L${640 + Math.cos((i + .5) / 12 * 6.283) * 900} ${380 + Math.sin((i + .5) / 12 * 6.283) * 900}Z" fill="${G.glow}" opacity=".5"/>`).join('')}</g>
    <circle class="shock" cx="640" cy="380" r="200" fill="none" stroke="#fff" stroke-width="14"/><circle class="shock" cx="640" cy="380" r="200" fill="none" stroke="${G.glow}" stroke-width="30" style="animation-delay:.12s"/>
    <circle cx="640" cy="380" r="170" fill="${G.glow}" opacity=".45"/>
    <g class="rise ${rb}">${ginger(640, 470, 2.1, dough(), { stroke: G.dark, sw: 4 })}</g>
    ${sparkles(16, G.glow)}
    <rect class="flash" width="1280" height="720" fill="#fff"/>
    </svg>`;

  if (window.__GF_DEBUG) window.__gf = { SC, set };
  const best = Math.max(...grades);
  // 단계 목록: 한 번만 하는 도입부 + 보상별 [cut, bake, pop]
  const steps = [{ k: 'line', w: 1900, g: best, item: -1 }, { k: 'stir', w: 1900, g: best, item: -1 }, { k: 'roll', w: 1500, g: best, item: -1 }];
  grades.forEach((g, i) => steps.push({ k: 'cut', w: 1500, g, item: i }, { k: 'bake', w: 1900, g, item: i }, { k: 'pop', w: 1500, g, item: i }));
  let idx = -1;
  const run = i => {
    clearTimeout(tm); if (dead) return; if (i >= steps.length) return finish();
    idx = i; const st = steps[i]; useGrade(st.g);
    const show = () => { set(SC[st.k]()); tm = setTimeout(() => run(i + 1), st.w); };
    if (i === 0) show(); else { sc.className = 'sc iout'; tm = setTimeout(show, 260); }
  };
  // 탭하면 현재 보상(도입부면 도입부)을 건너뛰고 다음 보상의 시작으로
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.skip')) return; const cur = steps[idx]; if (!cur) return;
    let j = idx + 1; while (j < steps.length && (steps[j].item === cur.item || (cur.item < 0 && steps[j].item < 0))) j++;
    run(j);
  });
  run(0);
  return finish;
}
