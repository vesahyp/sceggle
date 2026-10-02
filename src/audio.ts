/**
 * All sound is synthesized with Web Audio: no files, the same approach as
 * Räkkä. The sim pushes names onto `state.sounds`; the game loop drains
 * them into `play()`. Music is a steam-engine loop: a piston beat, a bass
 * line in D minor and a music-box melody on top.
 */
const MUTE_KEY = 'hoyry.muted';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private musicTimer = 0;
  private musicStep = 0;
  private musicOn = false;
  /** 0 calm, 1 a boss: the music gets busier */
  intensity = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* fine */
    }
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.6;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.26;
    this.music.connect(this.master);
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* fine */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, dur: number, o: { type?: OscillatorType; gain?: number; attack?: number; slide?: number; out?: GainNode | null; delay?: number } = {}): void {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.out ?? this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, o: { gain?: number; hp?: number; lp?: number; delay?: number; out?: GainNode | null } = {}): void {
    if (!this.ctx || !this.sfx || !this.noise) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.hp ?? 400;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp ?? 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(o.out ?? this.sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  private allow(name: string, gapMs: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -1e9) < gapMs) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  play(name: string): void {
    if (!this.ctx || this.muted) return;
    const r = Math.random;
    switch (name) {
      case 'shot_revolver':
        if (!this.allow(name, 40)) return;
        this.burst(0.09, { gain: 0.22, hp: 600, lp: 5000 });
        this.tone(180, 0.08, { type: 'square', gain: 0.08, slide: 0.4 });
        break;
      case 'shot_scatter':
        if (!this.allow(name, 60)) return;
        this.burst(0.18, { gain: 0.3, hp: 200, lp: 3500 });
        this.tone(90, 0.14, { type: 'square', gain: 0.1, slide: 0.5 });
        break;
      case 'shot_rifle':
        if (!this.allow(name, 60)) return;
        this.burst(0.14, { gain: 0.28, hp: 900, lp: 8000 });
        this.tone(1200, 0.12, { type: 'sawtooth', gain: 0.04, slide: 0.2 });
        break;
      case 'shot_mortar':
        this.tone(90, 0.25, { type: 'sine', gain: 0.25, slide: 0.5 });
        this.burst(0.12, { gain: 0.12, hp: 100, lp: 900 });
        break;
      case 'shot_lance':
        if (!this.allow(name, 80)) return;
        this.burst(0.3, { gain: 0.18, hp: 1500, lp: 9000 });
        break;
      case 'shot_saw':
        if (!this.allow(name, 60)) return;
        this.tone(900, 0.2, { type: 'sawtooth', gain: 0.05, slide: 1.6 });
        this.burst(0.06, { gain: 0.1, hp: 1500 });
        break;
      case 'hit':
        if (!this.allow(name, 35)) return;
        this.tone(400 + r() * 300, 0.04, { type: 'square', gain: 0.04 });
        break;
      case 'kill':
        if (!this.allow(name, 50)) return;
        this.tone(260 + r() * 120, 0.12, { type: 'square', gain: 0.06, slide: 0.4 });
        this.burst(0.1, { gain: 0.08, hp: 400, lp: 3000 });
        this.tone(1400 + r() * 300, 0.06, { type: 'triangle', gain: 0.04, delay: 0.03 });
        break;
      case 'boom':
        if (!this.allow(name, 60)) return;
        this.tone(70, 0.4, { type: 'sine', gain: 0.35, slide: 0.4 });
        this.burst(0.45, { gain: 0.3, hp: 50, lp: 1400 });
        break;
      case 'crate':
        this.burst(0.15, { gain: 0.15, hp: 300, lp: 2000 });
        this.tone(160, 0.1, { type: 'triangle', gain: 0.1, slide: 0.6 });
        break;
      case 'hurt':
        if (!this.allow(name, 110)) return;
        this.tone(150, 0.18, { type: 'square', gain: 0.12, slide: 0.55 });
        this.burst(0.1, { gain: 0.1, hp: 100, lp: 1500 });
        break;
      case 'death':
        [0, -3, -7, -12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.5, { type: 'sawtooth', gain: 0.1, delay: i * 0.2 }));
        this.burst(1.0, { gain: 0.14, hp: 60, lp: 800, delay: 0.2 });
        break;
      case 'coin': {
        if (!this.allow(name, 45)) return;
        const n = Math.floor(performance.now() / 45) % 5;
        this.tone(1320 * Math.pow(2, n / 12), 0.08, { type: 'square', gain: 0.03 });
        this.tone(2640, 0.05, { type: 'sine', gain: 0.03, delay: 0.03 });
        break;
      }
      case 'steam':
        this.burst(0.35, { gain: 0.1, hp: 2500 });
        [0, 4, 7].forEach((s, i) => this.tone(660 * Math.pow(2, s / 12), 0.15, { type: 'sine', gain: 0.08, delay: i * 0.05 }));
        break;
      case 'take':
        this.tone(300, 0.06, { type: 'square', gain: 0.08 });
        this.tone(200, 0.08, { type: 'square', gain: 0.08, delay: 0.07 });
        this.burst(0.05, { gain: 0.1, hp: 2000, delay: 0.12 });
        break;
      case 'swap':
        this.burst(0.05, { gain: 0.1, hp: 2000 });
        this.tone(500, 0.04, { type: 'square', gain: 0.05, delay: 0.05 });
        break;
      case 'super':
        this.tone(220, 0.4, { type: 'sawtooth', gain: 0.12, slide: 3 });
        this.burst(0.4, { gain: 0.15, hp: 800 });
        break;
      case 'stomp':
        this.tone(60, 0.5, { type: 'sine', gain: 0.4, slide: 0.5 });
        this.burst(0.4, { gain: 0.3, hp: 40, lp: 900 });
        break;
      case 'zap':
        if (!this.allow(name, 70)) return;
        this.tone(1800, 0.1, { type: 'sawtooth', gain: 0.05, slide: 0.3 });
        this.burst(0.08, { gain: 0.08, hp: 3000 });
        break;
      case 'ricochet':
        if (!this.allow(name, 60)) return;
        this.tone(2400 + r() * 800, 0.12, { type: 'sine', gain: 0.05, slide: 0.6 });
        break;
      case 'block':
        this.tone(900, 0.08, { type: 'square', gain: 0.06, slide: 0.5 });
        break;
      case 'throw':
        this.tone(500, 0.3, { type: 'triangle', gain: 0.08, slide: 0.4 });
        break;
      case 'cuckoo':
        this.tone(784, 0.16, { type: 'sine', gain: 0.18 });
        this.tone(622, 0.24, { type: 'sine', gain: 0.18, delay: 0.18 });
        break;
      case 'fuse':
        this.burst(0.6, { gain: 0.08, hp: 4000 });
        break;
      case 'charge':
        this.tone(110, 0.5, { type: 'sawtooth', gain: 0.1, slide: 1.8 });
        break;
      case 'vent':
        if (!this.allow(name, 300)) return;
        this.burst(0.9, { gain: 0.06, hp: 2500, lp: 9000 });
        break;
      case 'bossshot':
        if (!this.allow(name, 150)) return;
        this.tone(140, 0.25, { type: 'square', gain: 0.08, slide: 0.6 });
        break;
      case 'boss':
        this.tone(55, 1.6, { type: 'sawtooth', gain: 0.22, attack: 0.05, slide: 0.7 });
        this.tone(73, 1.6, { type: 'sawtooth', gain: 0.12, attack: 0.05, slide: 0.7 });
        this.burst(1.2, { gain: 0.15, hp: 60, lp: 500 });
        break;
      case 'bosskill':
        this.burst(1.0, { gain: 0.3, hp: 60, lp: 1200 });
        [0, 4, 7, 12, 16].forEach((s, i) => this.tone(262 * Math.pow(2, s / 12), 0.6, { type: 'triangle', gain: 0.14, delay: 0.3 + i * 0.1 }));
        break;
      case 'floor':
        // the lift bell
        this.tone(1047, 0.8, { type: 'sine', gain: 0.12 });
        this.tone(1568, 0.6, { type: 'sine', gain: 0.06 });
        break;
      case 'clear':
        [0, 4, 7, 12].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.25, { type: 'triangle', gain: 0.14, delay: i * 0.07 }));
        this.burst(0.8, { gain: 0.06, hp: 3000, delay: 0.2 });
        break;
      case 'lift':
        this.tone(80, 1.2, { type: 'sawtooth', gain: 0.08, slide: 2 });
        this.burst(1.0, { gain: 0.08, hp: 300, lp: 1500 });
        break;
      case 'epic':
        [0, 7, 12].forEach((s, i) => this.tone(587 * Math.pow(2, s / 12), 0.4, { type: 'triangle', gain: 0.12, delay: i * 0.08 }));
        break;
      case 'legend':
        [0, 4, 7, 11, 14, 19].forEach((s, i) => {
          this.tone(392 * Math.pow(2, s / 12), 0.7, { type: 'triangle', gain: 0.12, delay: i * 0.07 });
          this.tone(392 * Math.pow(2, s / 12) * 1.004, 0.7, { type: 'sine', gain: 0.08, delay: i * 0.07 });
        });
        break;
      case 'cog':
        this.tone(660, 0.08, { type: 'square', gain: 0.06 });
        this.tone(990, 0.12, { type: 'triangle', gain: 0.1, delay: 0.06 });
        break;
      case 'tap':
        this.tone(700, 0.04, { type: 'square', gain: 0.04 });
        break;
    }
  }

  // ---------------------------------------------------------------- music
  // Sixteenth steps at 132 bpm. A piston (noise) on the beat, a bass in D
  // minor that walks the same four chords, a music-box melody when it is calm,
  // a busier hi-hat when it is not.
  private static CHORDS = [
    [0, 3, 7],
    [-4, 0, 3],
    [-2, 2, 5],
    [-5, -2, 2],
  ];
  private static MELODY = [12, -1, 15, 14, 12, -1, 10, -1, 7, -1, 10, 12, 15, -1, 14, -1];

  startMusic(): void {
    this.musicOn = true;
    if (this.musicTimer) return;
    this.musicStep = 0;
    const tick = () => {
      if (!this.musicOn) {
        this.musicTimer = 0;
        return;
      }
      this.musicTimer = window.setTimeout(tick, 114);
      if (!this.ctx || this.muted) return;
      const step = this.musicStep++;
      const i = step % 16;
      const bar = Math.floor(step / 16) % 4;
      const chord = Audio.CHORDS[bar];
      const root = 73.4; // D2
      const out = this.music;
      if (i % 4 === 0) this.burst(0.08, { gain: 0.14, hp: 60, lp: 400, out });
      if (i % 4 === 2) this.burst(0.06, { gain: 0.06 + this.intensity * 0.06, hp: 3000, out });
      if (this.intensity > 0.5 && i % 2 === 1) this.burst(0.03, { gain: 0.04, hp: 6000, out });
      if (i % 2 === 0) {
        const note = chord[(i / 2) % 3];
        this.tone(root * Math.pow(2, note / 12), 0.2, { type: 'sawtooth', gain: 0.07, out });
      }
      const m = Audio.MELODY[(i + bar * 4) % 16];
      if (m >= 0 && (step >> 6) % 2 === 1) this.tone(root * 4 * Math.pow(2, (m + chord[0]) / 12), 0.35, { type: 'sine', gain: 0.05, out });
    };
    tick();
  }

  stopMusic(): void {
    this.musicOn = false;
  }
}

export const audio = new Audio();
