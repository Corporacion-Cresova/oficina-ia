// Sprites chibi estilo RPG de bolsillo (cabeza grande, contorno negro, tres
// tonos por color) para el escuadrón de Cresova. Personajes propios: cada uno
// se arma con una plantilla común + su peinado, accesorio y colores.
// Cada sprite mide 16×22 px y se cachea por dirección y cuadro.
export const SPRITE_W = 16, SPRITE_H = 22;

// Letras: K contorno · H pelo · h pelo sombra · L pelo brillo · S piel · s piel sombra · E ojo · W blanco
// C ropa · c ropa sombra · A acento · P pantalón · p pantalón sombra · B botas · X accesorio · x accesorio sombra
const HEAD = {
  down: [
    '....KKKKKKKK....',
    '...KHHLLHHHHK...',
    '..KHHLLHHHHHhK..',
    '.KHHHHHHHHHHHhK.',
    '.KHHHHHHHHHHHhK.',
    'KHHhHHHHHHHHHHhK',
    'KHhSHHSSSSHHSShK',
    'KHSSSSSSSSSSSShK',
    'KhSSWESSSSWESSsK',
    '.KsSSESSSSESSsK.',
    '..KssSSSSSSssK..',
    '...KKKKKKKKKK...',
  ],
  up: [
    '....KKKKKKKK....',
    '...KHHLLHHHHK...',
    '..KHHLLHHHHHhK..',
    '.KHHHHHHHHHHHhK.',
    '.KHHHHHHHHHHHhK.',
    'KHHHHHHHHHHHHHhK',
    'KHHHHHHHHHHHHHhK',
    'KhHHHHHHHHHHHHhK',
    'KhhHHHHHHHHHHhhK',
    '.KhhHHHHHHHHhhK.',
    '..KhhhhhhhhhhK..',
    '...KKKKKKKKKK...',
  ],
  side: [
    '....KKKKKKK.....',
    '...KHHLLHHHK....',
    '..KHHLLHHHHHK...',
    '.KHHHHHHHHHHHK..',
    '.KhHHHHHHHHHHHK.',
    'KhHHHHHHHHHHHHK.',
    'KhHHHHHHHSSSSHK.',
    'KhHHHHHSSSSSSSK.',
    'KhhHHHSSSSSWESK.',
    '.KhhHSSSSSSSESK.',
    '..KhhKssSSSSsK..',
    '...KK.KKKKKKK...',
  ],
};
// Cuerpo: filas 12–21. stand / paso A / paso B.
const BODY = {
  down: [
    '....KKCCCCKK....',
    '...KCCCAACCCK...',
    '..KCKCCCCCCKCK..',
    '..KCKCCCCCCKCK..',
    '..KSKccccccKSK..',
    '...KKPPPPPPKK...',
  ],
  up: [
    '....KKCCCCKK....',
    '...KCCCCCCCCK...',
    '..KCKCCCCCCKCK..',
    '..KCKCCCCCCKCK..',
    '..KSKccccccKSK..',
    '...KKPPPPPPKK...',
  ],
  side: [
    '.....KKCCCK.....',
    '....KCCCCCCK....',
    '....KCCCCCCK....',
    '....KCKSSKCK....',
    '....KcKKKKcK....',
    '.....KPPPPK.....',
  ],
};
const LEGS = {
  down: [
    ['....KPPKKPPK....', '....KPpKKpPK....', '....KBBKKBBK....', '....KKK..KKK....'],
    ['....KPPKKPPK....', '....KBBKKPpK....', '....KKK.KBBK....', '.........KKK....'],
    ['....KPPKKPPK....', '....KPpKKBBK....', '....KBBK.KKK....', '....KKK.........'],
  ],
  side: [
    ['.....KPPPPK.....', '.....KPppPK.....', '.....KBBBBK.....', '.....KKKKKK.....'],
    ['....KPPK.KPK....', '...KBBK..KPK....', '...KKK..KBBK....', '........KKK.....'],
    ['.....KPKKPPK....', '.....KPK.KBBK...', '....KBBK..KKK...', '....KKK.........'],
  ],
};

function shade(hex, k) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Accesorios propios de cada héroe, en coordenadas del sprite.
function accessory(put, kind, dir, X) {
  const f = dir === 'down', s = dir === 'side', u = dir === 'up';
  if (kind === 'cap') {             // gorra con visera
    for (let x = 3; x <= 12; x++) for (let y = 0; y <= 3; y++) put(x, y, y === 0 ? 'K' : 'X');
    put(2, 3, 'K'); put(13, 3, 'K');
    if (f) for (let x = 2; x <= 13; x++) { put(x, 4, 'x'); put(x, 5, x === 2 || x === 13 ? 'K' : 'K'); }
    if (s) for (let x = 9; x <= 14; x++) { put(x, 4, 'x'); put(x, 5, 'K'); }
    if (u) for (let x = 3; x <= 12; x++) put(x, 4, 'x');
  } else if (kind === 'headset') {  // vincha con micrófono
    for (let x = 2; x <= 13; x++) put(x, 2, x < 4 || x > 11 ? 'K' : 'X');
    if (f) { put(1, 6, 'K'); put(1, 7, 'X'); put(1, 8, 'X'); put(2, 9, 'X'); put(3, 10, 'X'); put(4, 10, 'K'); }
    if (s) { put(5, 6, 'K'); put(5, 7, 'X'); put(6, 8, 'X'); put(7, 9, 'X'); put(8, 10, 'X'); }
  } else if (kind === 'goggles') {  // antiparras sobre la frente
    for (let x = 2; x <= 13; x++) put(x, 4, 'K');
    if (!u) { for (const x0 of f ? [4, 9] : [9]) { put(x0, 3, 'K'); put(x0 + 1, 3, 'K'); put(x0 + 2, 3, 'K'); put(x0, 4, 'X'); put(x0 + 1, 4, 'W'); put(x0 + 2, 4, 'X'); } }
  } else if (kind === 'mask') {     // antifaz de héroe
    if (f) for (let x = 2; x <= 13; x++) put(x, 8, x === 4 || x === 10 ? 'W' : x === 5 || x === 11 ? 'E' : 'X');
    if (s) for (let x = 6; x <= 14; x++) put(x, 8, x === 11 ? 'W' : x === 12 ? 'E' : 'X');
    if (u) { put(1, 8, 'X'); put(14, 8, 'X'); }
  } else if (kind === 'beanie') {   // gorro con pompón
    put(7, -2, 'K'); put(8, -2, 'K'); put(6, -1, 'K'); put(7, -1, 'W'); put(8, -1, 'W'); put(9, -1, 'K');
    for (let x = 3; x <= 12; x++) for (let y = 0; y <= 4; y++) put(x, y, y === 0 ? 'K' : y === 4 ? 'x' : 'X');
    put(2, 4, 'K'); put(13, 4, 'K');
  } else if (kind === 'visor') {    // lentes de visor
    if (f) for (let x = 3; x <= 12; x++) put(x, 8, x === 3 || x === 12 ? 'K' : 'X');
    if (s) for (let x = 8; x <= 14; x++) put(x, 8, x === 14 ? 'K' : 'X');
  }
}

function hair(put, kind, dir) {
  if (kind === 'spiky') { put(4, -1, 'K'); put(5, -2, 'K'); put(5, -1, 'H'); put(8, -2, 'K'); put(8, -1, 'H'); put(9, -1, 'K'); put(11, -1, 'K'); put(12, 0, 'K'); }
  if (kind === 'ponytail') {
    const x = dir === 'side' ? 1 : 13;
    if (dir === 'side') { put(0, 5, 'K'); put(0, 6, 'H'); put(0, 7, 'h'); put(0, 8, 'K'); put(1, 9, 'K'); }
    else { put(x + 1, 5, 'K'); put(x + 2, 6, 'K'); put(x + 1, 6, 'H'); put(x + 1, 7, 'h'); put(x + 2, 7, 'K'); put(x + 1, 8, 'K'); }
  }
  if (kind === 'long' && dir !== 'side') for (let y = 9; y <= 12; y++) { put(1, y, 'K'); put(2, y, 'h'); put(13, y, 'h'); put(14, y, 'K'); }
  if (kind === 'long' && dir === 'side') for (let y = 9; y <= 12; y++) { put(1, y, 'K'); put(2, y, 'h'); put(3, y, 'K'); }
}

export function makeSprites(look) {
  const pal = {
    K: '#141218', W: '#ffffff', E: '#1c2240',
    H: look.hair, h: shade(look.hair, -0.3), L: shade(look.hair, 0.35),
    S: look.skin || '#f3c39b', s: shade(look.skin || '#f3c39b', -0.2),
    C: look.clothes, c: shade(look.clothes, -0.3), A: look.accent,
    P: look.pants || '#2b2f45', p: shade(look.pants || '#2b2f45', -0.3), B: look.boots || '#3a2a20',
    X: look.gear || look.accent, x: shade(look.gear || look.accent, -0.3),
  };
  const cache = new Map();
  const build = (dir, frame, blink) => {
    const cv = document.createElement('canvas');
    cv.width = SPRITE_W; cv.height = SPRITE_H + 2;
    const c = cv.getContext('2d');
    const OY = 2; // espacio arriba para pompones y pelos parados
    const grid = {};
    const put = (x, y, ch) => { grid[`${x},${y}`] = ch; };
    const base = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'side';
    HEAD[base].forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && put(x, y, ch)));
    BODY[base].forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && put(x, 12 + y, ch)));
    const legs = LEGS[base === 'side' ? 'side' : 'down'][frame];
    legs.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && put(x, 18 + y, ch)));
    hair(put, look.hairStyle, base);
    if (look.gearKind) accessory(put, look.gearKind, base, look.gear);
    if (blink && base !== 'up') for (const [k, ch] of Object.entries(grid)) if (ch === 'E' || ch === 'W') { const [x, y] = k.split(',').map(Number); if (y < 12) grid[k] = 'K'; }
    if (base === 'up') for (const [k, ch] of Object.entries(grid)) if (ch === 'A') grid[k] = 'C';
    for (const [k, ch] of Object.entries(grid)) {
      const [x, y] = k.split(',').map(Number);
      c.fillStyle = pal[ch] || ch;
      c.fillRect(x, y + OY, 1, 1);
    }
    if (dir === 'left') {
      const m = document.createElement('canvas');
      m.width = cv.width; m.height = cv.height;
      const mc = m.getContext('2d');
      mc.translate(m.width, 0); mc.scale(-1, 1); mc.drawImage(cv, 0, 0);
      return m;
    }
    return cv;
  };
  return {
    get(dir, frame = 0, blink = false) {
      const key = `${dir}|${frame}|${blink ? 1 : 0}`;
      if (!cache.has(key)) cache.set(key, build(dir, frame, blink));
      return cache.get(key);
    },
  };
}
