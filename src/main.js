import { init } from './game.js';
import { preloadLich, preloadAxe } from './lichglb.js';
import { preloadSugar } from './sugarglb.js';
import { preloadDragon } from './dragonglb.js';
import { preloadDark } from './darkglb.js';
import { preloadShadow } from './shadowglb.js';
import { preloadPv } from './pvglb.js';
import * as scr from './screens.js';

// 로딩 화면을 먼저 띄우고, 모델이 하나씩 불러와질 때마다 진행도를 올린다.
scr.bootLoading();
const jobs = [preloadLich(), preloadSugar(), preloadAxe(), preloadDragon(), preloadDark(), preloadShadow().then(r => { try { scr.setLoadPortrait('A', 'shadow'); } catch (e) { console.warn(e); } return r; }), preloadPv().then(r => { try { scr.setLoadPortrait('B', 'pv'); } catch (e) { console.warn(e); } return r; })];
let n = 0; jobs.forEach(p => p.then(() => scr.setProgress(++n / jobs.length)));
Promise.all(jobs).then(() => scr.loadingDone(init));
