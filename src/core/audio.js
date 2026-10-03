// Procedural WebAudio: engine (rpm/load driven), tire squeal, wind, impacts and horn.
// Settings > Sounds sets a volume per channel (the original's defaults keep the base mix).
const CHANNELS = { engine: ['volEngine', 75], wheels: ['volWheels', 50], wind: ['volWind', 50], impacts: ['volImpacts', 50], effects: ['volEffects', 50] };

export class CarAudio {
  constructor(volume = 0.6) {
    this.volume = volume;
    this.ch = { engine: 1, wheels: 1, wind: 1, impacts: 1, effects: 1 };
    this.ctx = null;
    this.ready = false;
    this._resume = () => this.init();
    window.addEventListener('keydown', this._resume);
    window.addEventListener('pointerdown', this._resume);
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // engine: two detuned saws + sub square through distortion + low-pass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    this.osc = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    this.osc[0].type = 'sawtooth';
    this.osc[1].type = 'sawtooth';
    this.osc[2].type = 'square';
    const og = [0.5, 0.35, 0.3].map((v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    });
    this.osc.forEach((o, i) => {
      o.connect(og[i]);
      og[i].connect(shaper);
      o.start();
    });
    // rumble noise
    const rumble = ctx.createBufferSource();
    rumble.buffer = buf;
    rumble.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 180;
    rf.Q.value = 0.8;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.15;
    rumble.connect(rf);
    rf.connect(this.rumbleGain);
    this.rumbleGain.connect(shaper);
    rumble.start();
    shaper.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    // tire squeal
    const sq = ctx.createBufferSource();
    sq.buffer = buf;
    sq.loop = true;
    this.sqFilter = ctx.createBiquadFilter();
    this.sqFilter.type = 'bandpass';
    this.sqFilter.frequency.value = 900;
    this.sqFilter.Q.value = 6;
    this.sqGain = ctx.createGain();
    this.sqGain.gain.value = 0;
    sq.connect(this.sqFilter);
    this.sqFilter.connect(this.sqGain);
    this.sqGain.connect(this.master);
    sq.start();
    // gravel / dirt roll noise
    const gr = ctx.createBufferSource();
    gr.buffer = buf;
    gr.loop = true;
    this.grFilter = ctx.createBiquadFilter();
    this.grFilter.type = 'lowpass';
    this.grFilter.frequency.value = 700;
    this.grGain = ctx.createGain();
    this.grGain.gain.value = 0;
    gr.connect(this.grFilter);
    this.grFilter.connect(this.grGain);
    this.grGain.connect(this.master);
    gr.start();
    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    wind.start();
    // horn: two detuned squares through a low-pass
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 2400;
    for (const fr of [405, 508]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.connect(hf);
      o.start();
    }
    hf.connect(this.hornGain);
    this.hornGain.connect(this.master);
    this.ready = true;
  }

  /** Per-channel volumes from the settings (0..100 each). */
  setChannels(s) {
    for (const [ch, [key, def]] of Object.entries(CHANNELS)) this.ch[ch] = (s[key] ?? def) / def;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  impact(strength) {
    if (!this.ready || strength < 0.05) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + 1500 * Math.min(1, strength);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1.2, strength) * this.ch.impacts + 1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + strength * 0.3);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1);
  }

  update(state) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = 0.05;
    const hasEngine = state.power > 0;
    const rpm = state.rpm;
    const f = (rpm / 60) * 4; // V8: 4 firing pulses per revolution
    this.osc[0].frequency.setTargetAtTime(f, t, 0.02);
    this.osc[1].frequency.setTargetAtTime(f * 1.006, t, 0.02);
    this.osc[2].frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.engFilter.frequency.setTargetAtTime(250 + f * (2 + state.load * 4), t, k);
    const eg = hasEngine ? (0.08 + 0.18 * state.load + 0.05 * Math.min(1, rpm / 7000)) * (state.paused ? 0 : 1) * this.ch.engine : 0;
    this.engGain.gain.setTargetAtTime(eg, t, k);
    this.rumbleGain.gain.setTargetAtTime(0.1 + state.load * 0.25, t, k);
    this.sqGain.gain.setTargetAtTime(state.paused ? 0 : Math.min(0.35, state.squeal * 0.025) * this.ch.wheels, t, 0.04);
    this.sqFilter.frequency.setTargetAtTime(700 + Math.min(800, state.squeal * 40), t, 0.05);
    this.grGain.gain.setTargetAtTime(state.paused ? 0 : Math.min(0.25, state.gravel * 0.012) * this.ch.wheels, t, 0.05);
    const ws = state.speed;
    this.windGain.gain.setTargetAtTime(state.paused ? 0 : Math.min(0.35, (ws * ws) / 9000) * this.ch.wind, t, 0.1);
    this.hornGain.gain.setTargetAtTime(state.horn && !state.paused ? 0.16 * this.ch.effects : 0, t, 0.02);
    this.windFilter.frequency.setTargetAtTime(300 + ws * 15, t, 0.1);
  }

  silence() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const g of [this.engGain, this.sqGain, this.grGain, this.windGain, this.hornGain]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
