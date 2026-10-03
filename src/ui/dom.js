// Tiny DOM helpers.
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) {
    children = attrs;
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function logoHTML() {
  return '<span class="d">Dream</span><span class="c">Car</span><span class="b">Builder</span>';
}

export function fmtTime(t) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
