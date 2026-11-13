// Video (tanda 1): una sola toma 3D (scenes/toma.js) + capa (HUD y subtítulos). Combinación D.
import { BEATS } from './beats.js';
export const W = 1080, H = 1920, FPS = 30;
export const scenes = [
  { id: 'toma', mod: 'toma', start: 0, end: BEATS.duration, combo: 'D' },
  { id: 'capa', mod: 'capa', start: 0, end: BEATS.duration, combo: 'D' },
];
export const DURATION = BEATS.duration;
