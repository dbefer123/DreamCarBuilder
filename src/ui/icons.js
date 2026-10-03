// Inline SVG icons in the original's light wireframe style.
const S = 'stroke="#dfe5ec" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const T = 'stroke="#dfe5ec" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"';

export const TOOL_ICONS = {
  frame: `<svg viewBox="0 0 64 64"><line x1="12" y1="10" x2="52" y2="54" stroke="#9aa3ad" stroke-width="7" stroke-linecap="round"/><line x1="12" y1="10" x2="52" y2="54" stroke="#e8edf2" stroke-width="3.2" stroke-linecap="round"/></svg>`,
  shock: `<svg viewBox="0 0 64 64"><g transform="rotate(-38 32 32)"><line x1="32" y1="2" x2="32" y2="62" ${T}/>${Array.from({ length: 8 }, (_, i) => `<ellipse cx="32" cy="${16 + i * 4.6}" rx="10" ry="3" ${S}/>`).join('')}<rect x="24" y="12" width="16" height="3" ${T}/><rect x="24" y="51" width="16" height="3" ${T}/></g></svg>`,
  rod: `<svg viewBox="0 0 64 64"><g transform="rotate(-38 32 32)"><rect x="27" y="22" width="10" height="34" rx="2" ${S}/><line x1="32" y1="4" x2="32" y2="22" ${S}/><circle cx="32" cy="5" r="3" ${T}/><circle cx="32" cy="59" r="3" ${T}/></g></svg>`,
  limiter: `<svg viewBox="0 0 64 64"><g transform="rotate(-38 32 32)"><line x1="32" y1="8" x2="32" y2="56" ${S} stroke-dasharray="4 4"/><circle cx="32" cy="6" r="4" ${S}/><circle cx="32" cy="58" r="4" ${S}/></g></svg>`,
  wheel: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" ${S}/><circle cx="32" cy="32" r="17" ${T}/><circle cx="32" cy="32" r="5" ${S}/>${Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return `<line x1="${32 + Math.cos(a) * 5}" y1="${32 + Math.sin(a) * 5}" x2="${32 + Math.cos(a) * 16}" y2="${32 + Math.sin(a) * 16}" ${T}/>`; }).join('')}${Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<line x1="${32 + Math.cos(a) * 22}" y1="${32 + Math.sin(a) * 22}" x2="${32 + Math.cos(a) * 26}" y2="${32 + Math.sin(a) * 26}" ${T}/>`; }).join('')}</svg>`,
  engine: `<svg viewBox="0 0 64 64"><path d="M10 36 L10 50 L50 50 L50 36 Z" ${S}/><path d="M10 36 L18 22 L30 22 L30 36" ${S}/><path d="M50 36 L44 22 L32 22" ${T}/><rect x="14" y="14" width="26" height="8" ${S}/>${[17, 22, 27, 32, 37].map((x) => `<line x1="${x}" y1="10" x2="${x}" y2="14" ${T}/>`).join('')}<circle cx="54" cy="44" r="5" ${T}/><line x1="16" y1="50" x2="16" y2="56" ${T}/><line x1="44" y1="50" x2="44" y2="56" ${T}/></svg>`,
  jet: `<svg viewBox="0 0 64 64"><g transform="rotate(-35 32 32)"><path d="M24 8 L40 8 L44 46 L20 46 Z" ${S}/><ellipse cx="32" cy="8" rx="8" ry="3" ${T}/><path d="M22 46 L26 58 L38 58 L42 46" ${S}/></g></svg>`,
  panel: `<svg viewBox="0 0 64 64"><path d="M10 52 L54 46 L40 10 Z" fill="rgba(220,228,236,0.25)" ${S}/></svg>`,
  seat: `<svg viewBox="0 0 64 64"><circle cx="30" cy="12" r="7" ${S}/><path d="M24 22 L20 42 L40 42 L50 56" ${S}/><path d="M26 30 L42 34" ${S}/><path d="M14 22 L14 46 L44 46" ${T}/></svg>`,
  weight: `<svg viewBox="0 0 64 64"><path d="M14 52 L20 22 L44 22 L50 52 Z" ${S}/><circle cx="32" cy="15" r="6" ${S}/><text x="32" y="45" text-anchor="middle" font-size="12" fill="#dfe5ec" font-family="Exo 2">KG</text></svg>`,
  presets: `<svg viewBox="0 0 64 64"><path d="M8 38 L14 26 L40 24 L50 32 L58 34 L58 42 L8 42 Z" ${S}/><circle cx="18" cy="44" r="7" ${S}/><circle cx="48" cy="44" r="7" ${S}/><path d="M22 26 L26 18 L36 18 L40 24" ${T}/></svg>`,
  angleLock: `<svg viewBox="0 0 64 64"><line x1="12" y1="52" x2="32" y2="14" stroke="#9aa3ad" stroke-width="6" stroke-linecap="round"/><line x1="32" y1="14" x2="54" y2="50" stroke="#9aa3ad" stroke-width="6" stroke-linecap="round"/><line x1="12" y1="52" x2="32" y2="14" stroke="#e8edf2" stroke-width="2.6" stroke-linecap="round"/><line x1="32" y1="14" x2="54" y2="50" stroke="#e8edf2" stroke-width="2.6" stroke-linecap="round"/><path d="M25.4 26.4 A14 14 0 0 0 39.3 25.9" stroke="#f2c04a" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="32" cy="14" r="4.5" fill="#dfe5ec"/></svg>`,
  transmission: `<svg viewBox="0 0 64 64"><g transform="rotate(-35 32 32)"><rect x="10" y="29" width="44" height="6" rx="3" ${S}/><circle cx="10" cy="32" r="7" ${S}/><circle cx="54" cy="32" r="7" ${S}/><line x1="10" y1="25" x2="10" y2="39" ${T}/><line x1="54" y1="25" x2="54" y2="39" ${T}/><line x1="6" y1="32" x2="14" y2="32" ${T}/><line x1="50" y1="32" x2="58" y2="32" ${T}/></g></svg>`,
};

export const TOOL_LIST = [
  ['frame', 'Frame', 'Click nodes (or empty space) to chain frames'],
  ['shock', 'Shock absorber', 'Click two nodes'],
  ['rod', 'Rod', 'Click two nodes; steering rod or piston, changes length with its keys'],
  ['limiter', 'Limiter', 'Click two nodes; limits how far they move apart'],
  ['angleLock', 'Angle Lock', 'Click end, joint, end; locks the angle between two frames'],
  ['wheel', 'Wheel', 'Click the hub node (wheel centre), then the axle node'],
  ['engine', 'Engine', 'Click the front node, then the back node of the mount'],
  ['transmission', 'Transmission', 'Click two nodes; links the nearest engine to the nearest wheel'],
  ['jet', 'Jet engine', 'Click the nozzle node, then a node in the thrust direction'],
  ['panel', 'Panel', 'Click three nodes'],
  ['seat', 'Driver seat', 'Click a node'],
  ['weight', 'Ballast', 'Click a node'],
  ['presets', 'Preset cars', 'Load a ready-made car'],
];

// Bottom part panel header buttons (22 x 22).
const P = 'stroke="#e9edf1" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"';
export const PANEL_ICONS = {
  selectType: `<svg viewBox="0 0 22 22" width="22" height="22"><rect x="2.5" y="2.5" width="17" height="17" ${P} stroke-dasharray="3 2"/><rect x="6" y="6" width="4" height="4" fill="#e9edf1"/><rect x="12" y="6" width="4" height="4" fill="#e9edf1"/><rect x="6" y="12" width="4" height="4" fill="#e9edf1"/><rect x="12" y="12" width="4" height="4" fill="#e9edf1"/></svg>`,
  deselect: `<svg viewBox="0 0 22 22" width="22" height="22"><rect x="2.5" y="2.5" width="17" height="17" ${P} stroke-dasharray="3 2"/><line x1="6.5" y1="11" x2="15.5" y2="11" ${P} stroke-width="2.4"/></svg>`,
  similar: `<svg viewBox="0 0 22 22" width="22" height="22"><rect x="2" y="5" width="7" height="12" rx="1" ${P}/><rect x="13" y="5" width="7" height="12" rx="1" ${P}/><line x1="9.5" y1="9" x2="12.5" y2="9" ${P}/><line x1="9.5" y1="13" x2="12.5" y2="13" ${P}/></svg>`,
  reset: `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M5 7 A7 7 0 1 1 4 12" ${P} stroke-width="2"/><path d="M2 4 L5 7.5 L8.5 4.5" ${P} stroke-width="2"/></svg>`,
  delete: `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 6 L18 6 M8 6 L8 3.5 L14 3.5 L14 6 M5.5 6 L6.5 19 L15.5 19 L16.5 6" ${P}/><line x1="9.5" y1="9" x2="9.5" y2="16" ${P}/><line x1="12.5" y1="9" x2="12.5" y2="16" ${P}/></svg>`,
  help: `<svg viewBox="0 0 22 22" width="22" height="22"><circle cx="11" cy="11" r="8.5" ${P}/><path d="M8.3 8.6 A2.8 2.8 0 1 1 11.6 11.3 Q11 11.7 11 13" ${P}/><circle cx="11" cy="16" r="1.1" fill="#e9edf1"/></svg>`,
  color: `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M11 2.5 A8.5 8.5 0 1 0 11 19.5 Q13 19.5 12.5 17 Q12 15 14 15 L16.5 15 Q19.5 15 19.5 11 A8.5 8.5 0 0 0 11 2.5 Z" ${P}/><circle cx="7" cy="9" r="1.6" fill="#ff6b6b"/><circle cx="11" cy="6.5" r="1.6" fill="#f2c04a"/><circle cx="15" cy="9" r="1.6" fill="#6ba8ff"/><circle cx="7.5" cy="13.5" r="1.6" fill="#79e07e"/></svg>`,
  midpoint: `<svg viewBox="0 0 22 22" width="22" height="22"><line x1="2" y1="11" x2="20" y2="11" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="11" cy="11" r="4.2" fill="#fff"/></svg>`,
  slider: `<svg viewBox="0 0 22 22" width="22" height="22"><line x1="2" y1="11" x2="20" y2="11" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><rect x="7" y="7" width="8" height="8" fill="#fff"/></svg>`,
};

// Menu icons (main menu, right side)
export const MENU_ICONS = {
  sandbox: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="5" r="2.3" fill="#fff"/><path d="M11 8 L10 14 L5 20 M10 14 L15 20 M3 21 L21 21 M7 11 L16 9" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M16 9 L19 4" stroke="#fff" stroke-width="1.6"/></svg>',
  multiplayer: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="8" cy="5" r="2.6" fill="#fff"/><circle cx="16" cy="5" r="2.6" fill="#fff"/><rect x="5" y="9" width="6" height="12" rx="1.5" fill="#fff"/><rect x="13" y="9" width="6" height="12" rx="1.5" fill="#fff"/></svg>',
  single: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 4 L20 12 L6 20 Z" fill="#fff"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="5" width="18" height="14" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M4 18 L10 11 L14 15 L16 13 L20 18 Z" fill="#fff"/><circle cx="16" cy="9" r="1.6" fill="#fff"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.6 4.6-1.9 1.1.2 2.2-2 1.2-1.8-1.3-2 .9-.6 2.1h-2.4l-.6-2.1-2-.9-1.8 1.3-2-1.2.2-2.2-1.9-1.1v-2.2l1.9-1.1-.2-2.2 2-1.2 1.8 1.3 2-.9.6-2.1h2.4l.6 2.1 2 .9 1.8-1.3 2 1.2-.2 2.2 1.9 1.1z"/></svg>',
};

/** Faint engineering line drawing for the main menu background. */
export function blueprintSVG() {
  const s = 'stroke="#ffffff" stroke-width="1.6" fill="none"';
  const circles = [[300, 170, 110], [300, 170, 80], [300, 170, 30], [470, 210, 95], [470, 210, 60], [470, 210, 18], [610, 120, 70], [610, 120, 40], [200, 330, 55], [200, 330, 22], [660, 300, 45]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${s}/>`).join('');
  const teeth = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return `<line x1="${470 + Math.cos(a) * 95}" y1="${210 + Math.sin(a) * 95}" x2="${470 + Math.cos(a) * 104}" y2="${210 + Math.sin(a) * 104}" ${s}/>`;
  }).join('');
  const lines = [[120, 40, 700, 380], [180, 20, 520, 420], [380, 60, 760, 160], [90, 260, 760, 300], [520, 320, 740, 420], [240, 80, 640, 40], [430, 340, 230, 430]]
    .map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" ${s}/>`).join('');
  const spring = Array.from({ length: 14 }, (_, i) => `<ellipse cx="${150 + i * 9}" cy="${120 + i * 11}" rx="16" ry="6" transform="rotate(30 ${150 + i * 9} ${120 + i * 11})" ${s}/>`).join('');
  const piston = '<path d="M560 40 L640 70 L620 120 L540 90 Z M600 100 L560 220 M520 230 L600 230 L600 260 L520 260 Z" stroke="#fff" stroke-width="1.6" fill="none"/>';
  return `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">${circles}${teeth}${lines}${spring}${piston}</svg>`;
}

/** View preset icons for the garage top bar (car silhouettes from different sides). */
export function viewIcon(kind) {
  const st = 'stroke="#fff" stroke-width="1.6" fill="none" stroke-linejoin="round"';
  switch (kind) {
    case 'persp': return `<svg viewBox="0 0 40 22" width="40" height="22"><path d="M4 14 L10 8 L22 4 L34 8 L37 14 L30 18 L10 18 Z" ${st}/><path d="M12 9 L20 6 L28 9" ${st}/></svg>`;
    case 'front': return `<svg viewBox="0 0 40 22" width="34" height="22"><path d="M6 16 L8 9 L14 5 L26 5 L32 9 L34 16 Z" ${st}/><rect x="8" y="16" width="5" height="4" fill="#fff"/><rect x="27" y="16" width="5" height="4" fill="#fff"/></svg>`;
    case 'back': return `<svg viewBox="0 0 40 22" width="34" height="22"><path d="M6 16 L8 9 L14 5 L26 5 L32 9 L34 16 Z" ${st}/><line x1="10" y1="12" x2="30" y2="12" ${st}/><rect x="8" y="16" width="5" height="4" fill="#fff"/><rect x="27" y="16" width="5" height="4" fill="#fff"/></svg>`;
    case 'left': return `<svg viewBox="0 0 44 22" width="40" height="22"><path d="M3 15 L6 10 L14 9 L19 4 L30 4 L36 9 L41 11 L41 15 Z" ${st}/><circle cx="11" cy="16" r="3" fill="#fff"/><circle cx="33" cy="16" r="3" fill="#fff"/></svg>`;
    case 'right': return `<svg viewBox="0 0 44 22" width="40" height="22"><g transform="translate(44 0) scale(-1 1)"><path d="M3 15 L6 10 L14 9 L19 4 L30 4 L36 9 L41 11 L41 15 Z" ${st}/><circle cx="11" cy="16" r="3" fill="#fff"/><circle cx="33" cy="16" r="3" fill="#fff"/></g></svg>`;
    case 'top': return `<svg viewBox="0 0 44 22" width="40" height="22"><rect x="4" y="5" width="36" height="12" rx="5" ${st}/><rect x="15" y="7" width="12" height="8" rx="2" ${st}/></svg>`;
    case 'bottom': return `<svg viewBox="0 0 44 22" width="40" height="22"><rect x="4" y="5" width="36" height="12" rx="5" ${st}/><line x1="10" y1="11" x2="34" y2="11" ${st}/><rect x="6" y="3" width="6" height="3" fill="#fff"/><rect x="32" y="3" width="6" height="3" fill="#fff"/><rect x="6" y="16" width="6" height="3" fill="#fff"/><rect x="32" y="16" width="6" height="3" fill="#fff"/></svg>`;
    case 'layout': return `<svg viewBox="0 0 30 22" width="28" height="22"><rect x="2" y="4" width="16" height="14" ${st}/><line x1="21" y1="6" x2="28" y2="6" ${st}/><line x1="21" y1="11" x2="28" y2="11" ${st}/><line x1="21" y1="16" x2="28" y2="16" ${st}/></svg>`;
    default: return '';
  }
}

export const SMALL_ICONS = {
  snap: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 3 L6 12 A6 6 0 0 0 18 12 L18 3 L14 3 L14 12 A2 2 0 0 1 10 12 L10 3 Z" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="6" y="3" width="4" height="3" fill="#fff"/><rect x="14" y="3" width="4" height="3" fill="#fff"/></svg>',
  ground: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 3 L12 17 M7 12 L12 17 L17 12 M4 21 L20 21" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  center: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2 L12 22 M2 12 L22 12" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2"/></svg>',
};

// Selection actions in the row above the parts bar (original game): [key, tooltip, svg, needs selection]
const CAR = 'M3 15 L6 10 L14 9 L19 4 L30 4 L36 9 L41 11 L41 15 Z';
const carIcon = (extra, fill = 'none') => `<svg viewBox="0 0 44 22" width="40" height="22"><path d="${CAR}" stroke="#fff" stroke-width="1.5" fill="${fill}" stroke-linejoin="round"/><circle cx="11" cy="16" r="3" fill="#fff"/><circle cx="33" cy="16" r="3" fill="#fff"/>${extra}</svg>`;
export const SELECT_ACTIONS = [
  ['oneType', 'Select parts of one type from the selection', carIcon('<path d="M20 6 L30 6 L26.5 10 L26.5 14 L23.5 14 L23.5 10 Z" fill="#fff"/>'), true],
  ['same', 'Select the same parts', carIcon('<rect x="17" y="6.5" width="4" height="4" fill="#fff"/><rect x="25" y="6.5" width="4" height="4" fill="#fff"/><line x1="21" y1="8.5" x2="25" y2="8.5" stroke="#fff" stroke-width="1.2"/>'), true],
  ['invert', 'Invert selection', `<svg viewBox="0 0 44 22" width="40" height="22"><defs><clipPath id="ci"><rect x="0" y="0" width="22" height="22"/></clipPath></defs><path d="${CAR}" fill="rgba(255,255,255,0.85)" clip-path="url(#ci)"/><path d="${CAR}" stroke="#fff" stroke-width="1.5" fill="none" stroke-linejoin="round"/><circle cx="11" cy="16" r="3" fill="#fff"/><circle cx="33" cy="16" r="3" fill="#fff"/></svg>`, false],
  ['engines', 'Select engines', carIcon('<rect x="27" y="6.5" width="8" height="5" fill="#fff"/><rect x="28" y="4.5" width="6" height="2" fill="#fff"/><rect x="35" y="8" width="2" height="2" fill="#fff"/>'), false],
  ['seat', 'Select the seat', carIcon('<path d="M18 13 L18 5.5 L20.5 5.5 L21.5 11 L27 11 L27 13 Z" fill="#fff"/>'), false],
];
