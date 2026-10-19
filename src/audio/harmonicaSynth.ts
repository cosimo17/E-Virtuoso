/**
 * 零外部音频依赖的本地口琴物理包络合成器 (Web Audio API)
 * 模拟口琴簧片谐波 (锯齿波 + 三角波 + 共振带通滤波 + 呼吸感 ADSR 包络 + 5.5Hz 颤音 LFO)
 * 支持长按持续发声 (startNote) 与松开立即释音 (stopNote)
 */
class HarmonicaSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.65;

  private activeNodes: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    vibratoOsc: OscillatorNode;
    envGain: GainNode;
    relSemitone: number;
  } | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * 相对半音 (0 = C4/低音1 = MIDI 60 或 C3 = MIDI 48) 转频率 (Hz)
   * 这里以低音 1 = C4 (MIDI 60, 261.63Hz) 或 G3 为基准，使得口琴音色清脆自然
   */
  private semitoneToFreq(relSemitone: number): number {
    const midiNote = 48 + relSemitone; // 低音1 = C3(48), 中音1 = C4(60), 高音1 = C5(72), 倍高音1 = C6(84)
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /**
   * 开始吹奏指定音符（长按保持发声，每次新音符到来均重新触发簧片起音包络）
   */
  public startNote(relSemitone: number) {
    this.stopNote();

    const ctx = this.ensureContext();
    if (!this.masterGain) return;

    const now = ctx.currentTime;
    const freq = this.semitoneToFreq(relSemitone);

    // 1. 双振荡器模拟口琴金属簧片泛音
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 1.0015, now); // 微失谐制造复音口琴温暖感

    // 2. 颤音 LFO (Vibrato)
    const vibratoOsc = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibratoOsc.frequency.setValueAtTime(5.5, now);
    vibratoGain.gain.setValueAtTime(freq * 0.006, now);
    vibratoOsc.connect(vibratoGain);
    vibratoGain.connect(osc1.frequency);
    vibratoGain.connect(osc2.frequency);

    // 3. 琴格共鸣滤波 (模拟口琴腔体频响)
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(4800, freq * 5.2), now);
    filter.Q.setValueAtTime(1.8, now);

    // 4. 呼吸感包络 (Attack 22ms -> Sustain)
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(0.45, now + 0.024);
    envGain.gain.exponentialRampToValueAtTime(0.36, now + 0.12);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(envGain);
    envGain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    vibratoOsc.start(now);

    this.activeNodes = {
      osc1,
      osc2,
      vibratoOsc,
      envGain,
      relSemitone,
    };
  }

  /**
   * 停止当前正在发声的音符（释放琴键）
   */
  public stopNote() {
    if (!this.activeNodes || !this.ctx) return;
    const { osc1, osc2, vibratoOsc, envGain } = this.activeNodes;
    this.activeNodes = null;

    const now = this.ctx.currentTime;
    try {
      envGain.gain.cancelScheduledValues(now);
      envGain.gain.setValueAtTime(Math.max(0.0001, envGain.gain.value), now);
      envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

      osc1.stop(now + 0.05);
      osc2.stop(now + 0.05);
      vibratoOsc.stop(now + 0.05);
    } catch {
      // 忽略已停止节点异常
    }
  }
}

export const harmonicaSynth = new HarmonicaSynthesizer();
