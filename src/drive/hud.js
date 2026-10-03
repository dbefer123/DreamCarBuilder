// Driving HUD (bottom-left speed/gear/deformation, circular minimap, hints, race timer).
import { el, fmtTime } from '../ui/dom.js';

export class HUD {
  constructor(ui, handlers) {
    this.root = el('div', { class: 'screen hud' });
    this.spd = el('b', '0');
    this.unit = el('span', { class: 'unit' }, 'mph');
    this.gear = el('b', '1');
    this.def = el('b', '0 %');
    this.rpmBar = el('div');
    this.boostBar = el('div');
    this.mini = el('canvas', { width: 268, height: 268 });
    this.hint = el('div', { class: 'hint' }, 'C or middle click - reset the camera');
    this.raceBox = el('div', { class: 'race hidden' }, [el('div', { class: 't' }, '0:00.00'), el('div', { class: 's' }, '')]);
    // Single player race bar (as in the original): time, checkpoints, distance, finish prize
    this.sp = { time: el('b', '0:00.00'), cps: el('span', '0/0'), dist: el('span', '0/0 m'), prize: el('b', '0') };
    this.spBar = el('div', { class: 'spbar hidden' }, [
      el('div', { class: 'cell' }, [this.sp.time]),
      el('div', { class: 'cell' }, [el('span', { class: 'flagico' }), this.sp.cps]),
      el('div', { class: 'cell' }, [this.sp.dist]),
      el('div', { class: 'cell' }, ['Finish prize: ', el('span', { class: 'coin' }), this.sp.prize]),
    ]);
    this.count = el('div', { class: 'countdown hidden' }, '3');
    this.flash = el('div', { class: 'flash hidden' }, '');
    this.slowmo = el('div', { class: 'slowmo hidden' }, 'Slow motion (T)');
    this.carState = el('div', { class: 'carstate hidden' }, '');
    this.assist = { tc: el('span', 'TC'), esc: el('span', 'ESC'), abs: el('span', 'ABS') };
    this.root.append(
      el('div', { class: 'rpm' }, [this.rpmBar]),
      el('div', { class: 'boost' }, [this.boostBar]),
      el('div', { class: 'speedo' }, [
        el('div', { class: 'spd' }, [this.spd, this.unit]),
        el('div', { class: 'gear' }, [this.gear]),
        el('div', { class: 'def' }, ['Deformations: ', this.def]),
      ]),
      el('div', { class: 'assist' }, [this.assist.tc, this.assist.esc, this.assist.abs]),
      el('div', { class: 'minimap' }, [this.mini]),
      this.hint,
      this.raceBox,
      this.spBar,
      this.count,
      this.flash,
      this.slowmo,
      this.carState,
      el('div', { class: 'corner-btns' }, [
        el('button', { class: 'btn', onclick: handlers.settings }, 'Settings (F1)'),
        el('button', { class: 'btn red', onclick: handlers.map }, 'Map (ESC)'),
      ]),
    );
    ui.appendChild(this.root);
    this.mctx = this.mini.getContext('2d');
    this.hintT = 6;
  }

  setMapImage(img) {
    this.mapImg = img;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  update(dt, sim, units, race, slow, singlePlayer = false) {
    const kmh = units === 'kmh';
    const v = Math.abs(sim.speed) * (kmh ? 3.6 : 2.23694);
    this.spd.textContent = Math.round(v);
    this.unit.textContent = kmh ? 'km/h' : 'mph';
    this.gear.textContent = sim.gearLabel;
    this.def.textContent = `${Math.round(sim.deformation * 100)} %`;
    const dt_ = sim.drivetrain;
    this.rpmBar.style.width = `${Math.min(100, (sim.rpm / 7200) * 100)}%`;
    this.boostBar.style.width = `${(sim.boostLevel / sim.boostCapacity) * 100}%`;
    this.assist.tc.classList.toggle('on', dt_.tc < 0.95);
    this.assist.esc.classList.toggle('on', dt_.escActive > 0.05);
    this.assist.abs.classList.toggle('on', sim.controls.brake > 0.5 && Math.abs(sim.speed) > 2 && sim.abs);
    if (this.hintT > 0) {
      this.hintT -= dt;
      this.hint.style.opacity = this.hintT > 1 ? '1' : String(Math.max(0, this.hintT));
    }
    this.slowmo.classList.toggle('hidden', !slow);
    // part damage (elastic limits)
    let state = '';
    if (sim.knockedOut) state = 'Driver knocked out - press R to respawn';
    else if (sim.powerHealth < 0.97) state = `Engine damaged: ${Math.round(sim.powerHealth * 100)} % power`;
    else if (sim.wheels.some((w) => w.health < 0.97)) state = 'Wheel damaged: less grip';
    if (state !== this._state) {
      this._state = state;
      this.carState.textContent = state;
      this.carState.classList.toggle('hidden', !state);
    }
    // race
    this.spBar.classList.toggle('hidden', !(race && singlePlayer));
    if (race && singlePlayer) {
      const t = race.state === 'finished' ? race.final : race.time + race.penaltyTime;
      const m = Math.floor(t / 60);
      this.sp.time.textContent = `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
      this.sp.cps.textContent = `${race.next}/${race.track.checkpoints.length}`;
      this.sp.dist.textContent = `${Math.round(race.distance)}/${Math.round(race.length)} m`;
      this.sp.prize.textContent = race.track.sp.prize;
    }
    if (race) {
      this.raceBox.classList.toggle('hidden', singlePlayer);
      const t = race.state === 'finished' ? race.final : race.time + race.penaltyTime;
      this.raceBox.children[0].textContent = fmtTime(t);
      const parts = [race.track.name];
      if (race.laps > 1) parts.push(`Lap ${Math.min(race.lap, race.laps)}/${race.laps}`);
      parts.push(`CP ${race.next}/${race.track.checkpoints.length}`);
      if (race.penalties) parts.push(`+${race.penaltyTime}s penalty`);
      if (race.best !== null) parts.push(`Best ${fmtTime(race.best)}`);
      this.raceBox.children[1].textContent = parts.join('  ·  ');
      if (race.state === 'countdown') {
        this.count.classList.remove('hidden');
        this.count.textContent = race.countdown > 0.2 ? String(Math.ceil(race.countdown - 0.2)) : 'GO!';
      } else if (race.state === 'running' && race.time < 0.8) {
        this.count.textContent = 'GO!';
        this.count.classList.remove('hidden');
      } else this.count.classList.add('hidden');
      if (race.flashT > 0 && race.flash) {
        this.flash.classList.remove('hidden');
        this.flash.textContent = race.flash;
      } else this.flash.classList.add('hidden');
    } else {
      this.raceBox.classList.add('hidden');
      this.count.classList.add('hidden');
      this.flash.classList.add('hidden');
    }
    this.drawMinimap(sim, race);
  }

  drawMinimap(sim, race) {
    const g = this.mctx, W = this.mini.width;
    g.fillStyle = '#5b6a52';
    g.fillRect(0, 0, W, W);
    if (!this.mapImg) return;
    const M = this.mapImg;
    const range = 320; // metres across
    const s = W / range;
    const heading = Math.atan2(-sim.fwd.z, sim.fwd.x);
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(heading - Math.PI / 2);
    const k = M.size / M.worldSize; // px per metre in the map image
    const sx = M.toPx(sim.com.x), sz = M.toPx(sim.com.z);
    g.scale(s / k, s / k);
    g.drawImage(M.canvas, -sx, -sz);
    if (race) {
      race.track.checkpoints.forEach((cp, i) => {
        if (i < race.next) return;
        g.fillStyle = i === race.next ? '#ffd040' : 'rgba(120,170,255,0.9)';
        g.beginPath();
        g.arc(M.toPx(cp.x) - sx, M.toPx(cp.z) - sz, (i === race.next ? 7 : 4) * (k / s), 0, Math.PI * 2);
        g.fill();
      });
    }
    // multiplayer: the other players
    for (const o of this.others || []) {
      g.fillStyle = '#ff7a3d';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 * (k / s);
      g.beginPath();
      g.arc(M.toPx(o.x) - sx, M.toPx(o.z) - sz, 5 * (k / s), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();
    // car arrow
    g.fillStyle = '#2d6fe0';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 12);
    g.lineTo(W / 2 + 8, W / 2 + 9);
    g.lineTo(W / 2, W / 2 + 4);
    g.lineTo(W / 2 - 8, W / 2 + 9);
    g.closePath();
    g.fill();
    g.stroke();
  }

  dispose() {
    this.root.remove();
  }
}
