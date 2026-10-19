/**
 * Tiny synthesized sound kit for the lab. Audio feedback matters for judging
 * feel (you hear a flipper hit before you see it), so even the debug build
 * clicks and thunks. Real audio is a Phase 1 question.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private lastHit = 0;

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType = 'square', sweep = 0.5): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, hp = 800): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(c.destination);
    s.start();
  }

  hit(speed: number, partId: string): void {
    const now = performance.now();
    if (now - this.lastHit < 25 || speed < 0.25) return;
    this.lastHit = now;
    const v = Math.min(1, speed / 4);
    if (partId.startsWith('flipper')) this.blip(140, 0.05, 0.12 * v, 'triangle', 0.6);
    else if (partId === 'ball') this.blip(1800, 0.03, 0.08 * v, 'sine', 0.9);
    else this.noise(0.04, 0.25 * v, 1200);
  }

  kick(kind: 'bumper' | 'sling'): void {
    if (kind === 'bumper') {
      this.blip(220, 0.09, 0.18, 'square', 0.4);
      this.noise(0.05, 0.15, 400);
    } else {
      this.blip(160, 0.07, 0.15, 'square', 0.5);
      this.noise(0.04, 0.12, 600);
    }
  }

  flipper(): void {
    this.noise(0.05, 0.18, 300);
  }

  /** The wire flap of a one-way gate clacking shut behind the ball. */
  gate(): void {
    this.noise(0.025, 0.14, 2500);
    this.blip(2400, 0.04, 0.03, 'triangle', 0.7);
  }

  ding(): void {
    this.blip(1320, 0.18, 0.08, 'sine', 0.98);
  }

  buzz(): void {
    this.blip(90, 0.4, 0.15, 'sawtooth', 0.9);
  }
}
