import { init } from './game.js';
import { preloadLich } from './lichglb.js';
preloadLich().then(init);
