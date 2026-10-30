import { init } from './game.js';
import { preloadLich, preloadAxe } from './lichglb.js';
import { preloadSugar } from './sugarglb.js';
import { preloadDragon } from './dragonglb.js';
import { preloadDark } from './darkglb.js';
Promise.all([preloadLich(), preloadSugar(), preloadAxe(), preloadDragon(), preloadDark()]).then(init);
