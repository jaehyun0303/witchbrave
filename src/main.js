import { init } from './game.js';
import { preloadLich, preloadAxe } from './lichglb.js';
import { preloadSugar } from './sugarglb.js';
Promise.all([preloadLich(), preloadSugar(), preloadAxe()]).then(init);
