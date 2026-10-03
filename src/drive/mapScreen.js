// Map screen (ESC while driving): left actions, central map with markers, right track info.
import { el, fmtTime } from '../ui/dom.js';
import { TIME_LIST } from '../world/sky.js';
import { trackLength } from './race.js';
import { computeStats, engineLevel } from '../car/design.js';
import { botLineup, BOT_COUNT } from './bots.js';
import { DEFAULT_RESTRICTIONS } from '../world/generate.js';

/** Total race time: m:ss, or h:mm:ss past an hour. */
function fmtDuration(t) {
  const s = Math.floor(t % 60), m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const FLAG = '<svg viewBox="0 0 20 16" width="18" height="14"><rect x="1" y="1" width="2" height="14" fill="#fff"/><g fill="#111"><rect x="3" y="1" width="4" height="3"/><rect x="11" y="1" width="4" height="3"/><rect x="7" y="4" width="4" height="3"/><rect x="15" y="4" width="4" height="3"/><rect x="3" y="7" width="4" height="3"/><rect x="11" y="7" width="4" height="3"/></g><g fill="#fff"><rect x="7" y="1" width="4" height="3"/><rect x="15" y="1" width="4" height="3"/><rect x="3" y="4" width="4" height="3"/><rect x="11" y="4" width="4" height="3"/><rect x="7" y="7" width="4" height="3"/><rect x="15" y="7" width="4" height="3"/></g></svg>';

const RESTRICTION_ROWS = [
  ['Disable slow motion car control', (r) => (r.disableSlowMotion ? 'Yes' : 'No')],
  ['Minimum weight', (r) => `${r.minWeight} kg`, (r, s) => s.mass < r.minWeight],
  ['Maximum size of the car (m)', (r) => r.maxSize, (r, s) => s.size > r.maxSize],
  ['Without hidden parts and decorations', (r) => (r.noHiddenParts ? 'Yes' : 'No')],
  ['Maximum radius of wheels (inch)', (r) => Math.round(r.maxWheelRadius / 0.0254), (r, s) => s.maxWheelRadius > r.maxWheelRadius + 1e-6],
  ['-- Strength --'],
  ['Self-repair', (r) => (r.selfRepair ? 'Yes' : 'No'), null, true],
  ['-- Aerodynamics --'],
  ['Allow spoilers', (r) => (r.allowSpoilers ? 'Yes' : 'No')],
  ['Maximum total lift power', (r) => r.maxLift.toExponential(0).replace('e+', 'E+')],
  ['Maximum lift coefficient', (r) => r.maxLiftCoefficient],
  ['-- Gearbox --'],
  ['Gearbox', (r) => r.gearbox],
  ['-- Parts --'],
  ['Maximum engines', (r) => r.maxEngines, (r, s) => s.counts.engine > r.maxEngines],
  ['Maximum jets', (r) => r.maxJets, (r, s) => s.counts.jet > r.maxJets],
  ['Minimum wheels', (r) => r.minWheels, (r, s) => s.counts.wheel < r.minWheels],
  ['Maximum wheels', (r) => r.maxWheels, (r, s) => s.counts.wheel > r.maxWheels],
  ['Maximum driving wheels:', (r) => r.maxDrivingWheels, (r, s) => s.drivenWheels > r.maxDrivingWheels],
  ['Maximum shocks', (r) => r.maxShocks, (r, s) => s.counts.shock > r.maxShocks],
  ['Maximum rods', (r) => r.maxRods, (r, s) => s.counts.rod > r.maxRods],
  ['Maximum frames', (r) => r.maxFrames, (r, s) => s.counts.frame > r.maxFrames],
  ['Maximum panels', (r) => r.maxPanels, (r, s) => s.counts.panel > r.maxPanels],
  ['Maximum limiters', (r) => r.maxLimiters, (r, s) => s.counts.limiter > r.maxLimiters],
];

export class MapScreen {
  constructor(drive) {
    this.drive = drive;
    this.app = drive.app;
    this.root = null;
    this.selected = null;
    this.editing = null; // new track being drawn
    this.showAll = true;
  }

  get open() {
    return !!this.root;
  }

  tracks() {
    const builtin = this.drive.world.tracks || [];
    const custom = this.app.storage.customTracks(this.drive.world.key).map((t) => ({ ...t, custom: true }));
    return [...builtin, ...custom];
  }

  show() {
    if (this.root) return;
    const d = this.drive;
    this.selected = d.race ? d.race.track : this.selected;
    this.root = el('div', { class: 'mapscreen' });
    this.app.ui.appendChild(this.root);
    this.render();
  }

  hide() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.editing = null;
  }

  /** Single player tracks of this map, and how many the car's engine level opens. */
  careerTracks() {
    const level = engineLevel(this.app.design);
    const sp = this.tracks().filter((t) => t.sp);
    const next = sp.map((t) => t.sp.engineLevel).filter((l) => l > level).sort((a, b) => a - b)[0];
    return { level, opened: sp.filter((t) => t.sp.engineLevel <= level).length, next };
  }

  render() {
    const d = this.drive;
    const app = this.app;
    const career = app.mode === 'career';
    const stats = computeStats(app.design);
    this.root.innerHTML = '';
    const timeSel = el('select', {}, TIME_LIST.map((t) => el('option', { value: t, selected: d.world.scene.timeName === t }, t)));
    timeSel.onchange = () => d.setTime(timeSel.value);
    const coin = () => el('span', { class: 'coin' });
    let kv;
    if (career) {
      const st = app.profile.stats();
      const ct = this.careerTracks();
      kv = [
        el('span', 'Physics:'), el('span', { class: 'y' }, `${d.sim.rate / 1000} kHz`),
        el('span', 'You have:'), el('span', { class: 'g' }, [coin(), `${app.profile.coins(app.design)} c.`]),
        el('span', "Car's price:"), el('span', `${stats.price} c.`),
        el('span', "Your car's weight, kg:"), el('span', Math.round(stats.mass * stats.massScale)),
        el('span', 'New track engine level:'), el('span', { class: 'y' }, ct.next ?? '-'),
        el('span', 'Map size (m):'), el('span', d.world.G.T.size),
        el('span', 'Tracks opened:'), el('span', ct.opened),
        el('span', 'Total finishes:'), el('span', st.finishes),
        el('span', 'Opponents defeated:'), el('span', st.opponents),
        el('span', 'Total race time:'), el('span', fmtDuration(st.raceTime)),
        el('span', 'Mileage, km:'), el('span', ((st.mileage + d.mileage) / 1000).toFixed(1)),
        el('span', 'Fastest track speed:'), el('span', Math.round(st.fastest)),
      ];
    } else {
      kv = [
        el('span', 'Physics:'), el('span', { class: 'y' }, `${d.sim.rate / 1000} kHz`),
        el('span', "Your car's weight, kg:"), el('span', Math.round(stats.mass)),
        el('span', 'Power:'), el('span', Math.round(stats.powerHp)),
        el('span', 'Map size (m):'), el('span', d.world.G.T.size),
      ];
    }
    const left = el('div', { class: 'left' }, [
      el('div', { class: 'title' }, d.race ? (career ? 'Race (paused)' : d.race.track.name) : 'Free ride'),
      el('button', { class: 'btn', onclick: () => d.closeMap() }, 'Resume (ESC)'),
      el('button', { class: 'btn', onclick: () => d.restartRace(), disabled: !d.race }, 'Restart Race (Shift + R)'),
      el('button', { class: `btn ${d.race ? '' : 'dim'}`, onclick: () => d.freeRide() }, 'Free Ride (F)'),
      el('button', { class: 'btn', onclick: () => { d.closeMap(); d.respawn(true); } }, 'Respawn from chosen pos. (R)'),
      timeSel,
      el('div', { class: 'grp' }, career ? [
        el('div', { class: 'gt' }, 'Single player:'),
        el('button', { class: 'btn green', html: `<span class="ico">${FLAG}</span>All competitions...`, onclick: () => this.allCompetitions() }),
      ] : [
        el('div', { class: 'gt' }, 'Sandbox:'),
        el('button', { class: 'btn green', html: `<span class="ico">${FLAG}</span>All competitions...`, onclick: () => this.allCompetitions() }),
        el('button', { class: 'btn green', onclick: () => this.removeCompetitions() }, 'Remove competitions...'),
        el('button', { class: 'btn green', onclick: () => this.startEditing() }, 'Add a new track...'),
      ]),
      el('div', { class: 'grp' }, [
        el('div', { class: 'gt' }, app.mp.room ? `Multiplayer (beta): ${app.mp.room.name}` : 'Multiplayer (beta):'),
        el('button', { class: 'btn', onclick: () => d.mpConnect() }, app.mp.room ? 'Game servers...' : 'Connect...'),
        el('button', { class: 'btn', onclick: () => d.mpLogout(), disabled: !app.mp.connected }, 'Logout...'),
      ]),
      el('button', { class: 'btn red', onclick: () => d.openSettings() }, 'Settings (F1)'),
      el('button', { class: 'btn red', onclick: () => d.exitToGarage() }, 'Exit to Garage (G)'),
      el('div', { class: 'kv' }, kv),
    ]);
    // centre map
    const wrap = el('div', { class: 'mapwrap' });
    const canvas = el('canvas', { width: 1024, height: 1024 });
    wrap.append(canvas);
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', (e) => this.onMapClick(e));
    const center = el('div', { class: 'center' }, [el('div', { class: 'mtitle' }, d.world.G.map.name), wrap]);
    const right = el('div', { class: 'right' });
    this.fillRight(right, stats);
    this.root.append(left, center, right);
    this.drawMap();
  }

  fillRight(right, stats) {
    const d = this.drive;
    const t = this.editing || this.selected;
    if (!t) {
      right.append(el('div', { class: 'tname' }, 'Free ride'), el('p', { style: { color: '#aab2bb', textAlign: 'center' } }, 'Click a white marker to pick a competition, or click anywhere to choose a respawn position.'));
      return;
    }
    if (t.sp && this.app.mode === 'career') {
      this.fillCareer(right, t);
      return;
    }
    const r = { ...DEFAULT_RESTRICTIONS, ...(t.restrictions || {}) };
    const best = this.app.storage.bestTime(d.world.key, t.name);
    const rating = this.app.storage.rating(d.world.key, t.name);
    const stars = el('div', { class: 'stars' }, ['Rate the track: ']);
    for (let i = 1; i <= 5; i++) {
      stars.append(el('span', {
        class: i <= rating ? 'on' : '',
        onclick: () => { this.app.storage.setRating(d.world.key, t.name, i); this.render(); },
      }, '★'));
    }
    const bad = RESTRICTION_ROWS.filter((row) => row[2] && row[2](r, stats)).length;
    const restr = el('div', { class: 'restr' });
    for (const row of RESTRICTION_ROWS) {
      if (row.length === 1) {
        if (this.showAll) restr.append(el('div', { class: 'h' }, row[0]));
        continue;
      }
      const isBad = row[2] ? row[2](r, stats) : false;
      if (!this.showAll && !isBad) continue;
      restr.append(el('div', { class: `r ${isBad ? 'bad' : ''}` }, [el('span', row[0]), el('span', String(row[1](r)))]));
    }
    const showAll = el('input', { type: 'checkbox', checked: this.showAll });
    showAll.onchange = () => { this.showAll = showAll.checked; this.render(); };
    right.append(
      el('div', { class: 'tname' }, `${t.name}${t.author ? ` by ${t.author}` : ''}`),
      el('div', { style: { height: '70px' } }),
      stars,
      el('div', { class: 'tname', style: { fontSize: '14px' } }, t.time || 'Noon'),
      el('div', { class: 'info' }, [
        el('span', "Track's length, m:"), el('span', Math.round(trackLength(t))),
        el('span', 'Checkpoints:'), el('span', t.checkpoints.length),
        el('span', 'Laps:'), el('span', t.laps || 1),
        el('span', 'Penalty time (sec.):'), el('span', `${r.penalty} sec.`),
        el('span', 'Boost:'), el('span', r.boost),
        el('span', 'Best time:'), el('span', fmtTime(best)),
      ]),
      el('div', { class: 'warn', style: { color: bad ? '#f2c04a' : '#7fd17f' } }, bad ? `Your car breaks ${bad} of the track's restrictions.` : "Your car meets the track's restrictions."),
      el('label', { class: 'chk' }, [showAll, 'Show all restrictions']),
      restr,
      el('div', { class: 'bot' }, [
        el('button', { class: 'btn', onclick: () => this.saveTrack(), disabled: !this.editing }, 'Save the track...'),
        el('button', { class: 'btn red', onclick: () => this.deleteTrack(t), disabled: !(t.custom || this.editing) }, 'Delete'),
        el('button', { class: 'btn green', onclick: () => this.race(t), disabled: !!this.editing && this.editing.checkpoints.length < 1 }, 'Race !'),
        // multiplayer: invite the room (each player decides to join)
        this.drive.mps && !this.editing ? el('button', { class: 'btn green together', onclick: () => this.raceTogether(t) }, 'Race together') : null,
      ]),
    );
  }

  /** Right panel for a Single player competition: prize, opponents and their coins. */
  fillCareer(right, t) {
    const d = this.drive;
    const app = this.app;
    const best = app.storage.bestTime(d.world.key, t.name);
    const locked = d.lockedTrack(t);
    const done = new Set(app.profile.defeated(d.trackKey(t)));
    const coin = () => el('span', { class: 'coin' });
    const opps = el('div', { class: 'opps' }, [el('div', { class: 'h' }, 'Opponents (beat their time once to win their coins)')]);
    botLineup(t).forEach((b, i) => {
      opps.append(
        el('span', { class: 'car' }),
        el('span', fmtTime(b.time)),
        el('span', { class: 'v' }, [coin(), String(b.value)]),
        el('span', { class: 'ok' }, done.has(i) ? '✓' : ''),
      );
    });
    right.append(
      el('div', { class: 'tname' }, t.name),
      el('div', { class: 'tname', style: { fontSize: '14px', color: '#aab2bb' } }, t.time || 'Noon'),
      el('div', { class: 'info', style: { marginTop: '12px' } }, [
        el('span', "Track's length, m:"), el('span', Math.round(trackLength(t))),
        el('span', 'Checkpoints:'), el('span', t.checkpoints.length),
        el('span', 'Opens at engine level:'), el('span', t.sp.engineLevel),
        el('span', 'Best time:'), el('span', fmtTime(best)),
        el('span', 'Finish prize:'), el('span', [coin(), `${t.sp.prize} c.`]),
        el('span', 'Opponents defeated:'), el('span', `${done.size} / ${BOT_COUNT}`),
      ]),
      locked ? el('div', { class: 'locked' }, `Upgrade your engine to level ${t.sp.engineLevel} to open this track.`) : el('div', { style: { height: '8px' } }),
      opps,
      el('div', { style: { flex: '1' } }),
      el('div', { class: 'bot' }, [
        el('button', { class: 'btn green', onclick: () => this.race(t), disabled: locked }, 'Race !'),
      ]),
    );
  }

  mapToWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const T = this.drive.world.G.T;
    return { x: u * T.size - T.half, z: v * T.size - T.half };
  }

  onMapClick(e) {
    const p = this.mapToWorld(e);
    if (this.editing) {
      const ed = this.editing;
      if (!ed.start) {
        ed.start = { x: p.x, z: p.z, heading: 0 };
      } else {
        const prev = ed.checkpoints.length ? ed.checkpoints[ed.checkpoints.length - 1] : ed.start;
        const dir = Math.atan2(-(p.z - prev.z), p.x - prev.x);
        ed.checkpoints.push({ x: p.x, z: p.z, dir, w: 18 });
        if (ed.checkpoints.length === 1) ed.start.heading = dir;
      }
      this.render();
      return;
    }
    // pick a track marker?
    const T = this.drive.world.G.T;
    const pxPerM = this.canvas.getBoundingClientRect().width / T.size;
    for (const t of this.tracks()) {
      if (Math.hypot(t.start.x - p.x, t.start.z - p.z) * pxPerM < 10) {
        this.selected = t;
        this.render();
        return;
      }
    }
    this.drive.chosenSpawn = { x: p.x, z: p.z, heading: this.drive.sim.heading() };
    this.selected = null;
    this.render();
  }

  drawMap() {
    const d = this.drive;
    const M = d.mapImage;
    const g = this.canvas.getContext('2d');
    const W = this.canvas.width;
    g.drawImage(M.canvas, 0, 0, W, W);
    const s = W / M.size;
    const P = (x) => M.toPx(x) * s;
    const career = this.app.mode === 'career';
    const drawTrack = (t, hl) => {
      g.strokeStyle = hl ? 'rgba(255,208,64,0.9)' : 'rgba(255,255,255,0.0)';
      g.lineWidth = 3;
      if (hl) {
        g.beginPath();
        if (t.route) {
          g.moveTo(P(t.route[0].x), P(t.route[0].z));
          for (const p of t.route) g.lineTo(P(p.x), P(p.z));
        } else {
          g.moveTo(P(t.start.x), P(t.start.z));
          for (const c of t.checkpoints) g.lineTo(P(c.x), P(c.z));
        }
        g.stroke();
        for (const [i, c] of t.checkpoints.entries()) {
          g.fillStyle = i === t.checkpoints.length - 1 ? '#e6262b' : '#ffd040';
          g.beginPath();
          g.arc(P(c.x), P(c.z), 6, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Single player: grey circles; locked tracks dimmed with the engine level they need
      const locked = career && d.lockedTrack(t);
      g.fillStyle = career && t.sp ? (locked ? 'rgba(150,150,150,0.55)' : hl ? '#f4f4f4' : '#c9ccd0') : '#f4f4f4';
      g.strokeStyle = locked ? 'rgba(60,60,60,0.6)' : '#555';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(P(t.start.x), P(t.start.z), 12, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (locked) {
        g.fillStyle = '#2b2f36';
        g.font = '700 13px "Exo 2", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(t.sp.engineLevel), P(t.start.x), P(t.start.z) + 1);
      }
    };
    for (const t of this.tracks()) drawTrack(t, t === this.selected || (this.selected && t.name === this.selected.name));
    if (this.editing && this.editing.start) drawTrack(this.editing, true);
    // chosen respawn crosshair
    if (d.chosenSpawn) {
      const x = P(d.chosenSpawn.x), y = P(d.chosenSpawn.z);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.moveTo(x, y - 14); g.lineTo(x, y + 14);
      g.stroke();
      g.strokeStyle = '#2d6fe0';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // car marker
    const sim = d.sim;
    const x = P(sim.com.x), y = P(sim.com.z);
    const h = Math.atan2(-sim.fwd.z, sim.fwd.x);
    g.save();
    g.translate(x, y);
    g.rotate(-h);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2d6fe0';
    g.beginPath();
    g.moveTo(12, 0); g.lineTo(-9, 9); g.lineTo(-4, 0); g.lineTo(-9, -9);
    g.closePath();
    g.fill();
    g.restore();
  }

  startEditing() {
    this.editing = { name: 'My track', author: 'You', laps: 1, time: this.drive.world.scene.timeName, start: null, checkpoints: [], restrictions: {}, custom: true };
    this.app.toast('Click the map to place the start, then click to add checkpoints.');
    this.render();
  }

  async saveTrack() {
    const ed = this.editing;
    if (!ed || !ed.start || !ed.checkpoints.length) {
      this.app.toast('Add a start and at least one checkpoint first.');
      return;
    }
    const { promptBox } = await import('../ui/dialogs.js');
    const name = await promptBox(this.app.ui, 'Save the track', 'Track name', ed.name);
    if (!name) return;
    ed.name = name;
    this.app.storage.saveCustomTrack(this.drive.world.key, ed);
    this.selected = { ...ed };
    this.editing = null;
    this.render();
    this.app.toast(`Saved “${name}”`);
  }

  deleteTrack(t) {
    if (this.editing) {
      this.editing = null;
      this.render();
      return;
    }
    if (!t.custom) return;
    this.app.storage.deleteCustomTrack(this.drive.world.key, t.name);
    this.selected = null;
    this.render();
  }

  async allCompetitions() {
    const { listBox } = await import('../ui/dialogs.js');
    const career = this.app.mode === 'career';
    const items = this.tracks().map((t) => ({
      label: `${t.name}${t.author ? ` by ${t.author}` : ''}`,
      meta: career && t.sp
        ? `${Math.round(trackLength(t))} m · prize ${t.sp.prize} c. · ${this.drive.lockedTrack(t) ? `opens at engine level ${t.sp.engineLevel}` : `best ${fmtTime(this.app.storage.bestTime(this.drive.world.key, t.name))}`}`
        : `${Math.round(trackLength(t))} m · ${t.checkpoints.length} checkpoints · best ${fmtTime(this.app.storage.bestTime(this.drive.world.key, t.name))}`,
      value: t,
    }));
    const t = await listBox(this.app.ui, 'All competitions', items);
    if (t) {
      this.selected = t;
      this.render();
    }
  }

  async removeCompetitions() {
    const { listBox } = await import('../ui/dialogs.js');
    const custom = this.tracks().filter((t) => t.custom);
    await listBox(this.app.ui, 'Remove competitions', custom.map((t) => ({ label: t.name, value: t })), {
      empty: 'You have not created any tracks on this map yet.',
      onDelete: (t) => this.app.storage.deleteCustomTrack(this.drive.world.key, t.name),
    });
    this.render();
  }

  /** Multiplayer: start this competition for everyone in the room (they choose to join). */
  raceTogether(t) {
    const mp = this.app.mp;
    if (mp.race) {
      this.app.toast(`${mp.race.hostName}'s race on ${mp.race.track} is still running.`);
      return;
    }
    mp.raceStart(t.name);
    this.drive.closeMap();
  }

  race(t) {
    if (this.editing) {
      const ed = this.editing;
      if (!ed.start || !ed.checkpoints.length) return;
      t = ed;
      this.editing = null;
    }
    this.drive.startRace(t);
  }
}
