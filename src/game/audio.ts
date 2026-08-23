export class EngineAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sawtooth";
    osc.frequency.value = 48;
    filter.type = "lowpass";
    filter.frequency.value = 380;
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    this.ctx = ctx;
    this.osc = osc;
    this.gain = gain;
    this.filter = filter;
  }

  update(speed: number, throttle: number) {
    if (!this.osc || !this.gain || !this.filter || !this.ctx) return;
    if (this.ctx.state === "suspended") return;
    const abs = Math.abs(speed);
    const target = abs > 0.4 ? 0.028 + Math.min(0.045, abs / 280) : 0;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.osc.frequency.setTargetAtTime(46 + abs * 6.2 + Math.max(0, throttle) * 8, this.ctx.currentTime, 0.05);
    this.filter.frequency.setTargetAtTime(320 + abs * 18, this.ctx.currentTime, 0.08);
  }

  dispose() {
    try {
      this.osc?.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
