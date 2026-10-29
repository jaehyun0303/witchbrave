import { init } from './game.js';
import { preloadLich, preloadAxe } from './lichglb.js';
import { preloadSugar } from './sugarglb.js';
import { preloadDragon } from './dragonglb.js';
Promise.all([preloadLich(), preloadSugar(), preloadAxe(), preloadDragon()]).then(init);
