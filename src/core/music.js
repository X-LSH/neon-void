/**
 * 程序化背景音乐：128 BPM 十六分步进音序器。
 *
 * 调度用 lookahead（25ms 定时器 + 0.12s 预排）—— 直接在每个 step 里
 * 用 setTimeout 排音符会被主线程抖动打散，节奏会漂。
 *
 * 走向：Am–F–C–G 四小节循环。底鼓 + 踩镲 + 锯齿贝斯 + 方波琶音 + 失谐铺底。
 */

const BPM = 128;
const STEP = 60 / BPM / 4; // 十六分音符
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

/** 半音 → 频率。基准 A4 = 69 = 440Hz */
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** 每小节一个和弦：根音 + 三和弦（MIDI） */
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 41, chord: [53, 57, 60] }, // F
  { root: 36, chord: [48, 52, 55] }, // C
  { root: 43, chord: [50, 55, 59] }, // G
];

/** 琶音模式：每小节 16 步，取和弦音索引，-1 为休止 */
const ARP = [0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 3, 2, 1, 0, 1];
const KICK_STEPS = [0, 4, 8, 12];

export function createMusic(audio) {
  let timer = 0;
  let step = 0;
  let nextTime = 0;
  let playing = false;

  function note(type, freq, dur, gain, at, opts = {}) {
    const { ctx, musicBus, ready } = audio.buses();
    if (!ready || !ctx) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), at + dur);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + (opts.attack || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      let tail = osc;
      if (opts.filter) {
        const f = ctx.createBiquadFilter();
        f.type = opts.filter;
        f.frequency.setValueAtTime(opts.filterFrom || 800, at);
        if (opts.filterTo) {
          f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterTo), at + dur);
        }
        if (opts.q) f.Q.value = opts.q;
        osc.connect(f);
        tail = f;
      }
      tail.connect(g);
      g.connect(musicBus);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    } catch { /* 忽略 */ }
  }

  function kick(at) {
    const { ctx, musicBus, ready } = audio.buses();
    if (!ready || !ctx) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(155, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.13);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(at);
      osc.stop(at + 0.24);
    } catch { /* 忽略 */ }
  }

  /**
   * ★ 踩镲噪声缓冲只生成一次。
   * 曾经每个音符新建一个 0.05s 的 AudioBuffer + 逐样本填充 ——
   * 128 BPM 下每秒 16 个音符，就是每秒 16 次 2205 样本的循环 + 缓冲分配。
   * 单看不致命，但它是**稳定发生**的成本，而且完全没必要。
   */
  let hatBuf = null;

  function hat(at, gain) {
    const { ctx, musicBus, ready } = audio.buses();
    if (!ready || !ctx) return;
    try {
      if (!hatBuf) {
        const len = Math.floor(ctx.sampleRate * 0.05);
        hatBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = hatBuf.getChannelData(0);
        let s = 0x2545f491;
        for (let i = 0; i < len; i++) {
          s = (s * 1664525 + 1013904223) >>> 0;
          d[i] = ((s / 4294967296) * 2 - 1) * (1 - i / len);
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = hatBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7200;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      f.connect(g);
      g.connect(musicBus);
      src.start(at);
    } catch { /* 忽略 */ }
  }

  function scheduleStep(at) {
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const s = step % 16;
    const { root, chord } = PROGRESSION[bar];

    if (KICK_STEPS.includes(s)) kick(at);
    if (s % 2 === 1) hat(at, s % 4 === 3 ? 0.055 : 0.03);

    // 贝斯：八分音符，每小节末尾加一个八度跳进
    if (s % 2 === 0) {
      const up = s === 14 ? 12 : 0;
      note('sawtooth', hz(root + up), 0.16, 0.085, at, {
        filter: 'lowpass',
        filterFrom: 460,
        filterTo: 200,
        q: 5,
      });
    }

    // 琶音：十六分，高两个八度
    const ai = ARP[s];
    if (ai >= 0) {
      const n = chord[Math.min(ai, chord.length - 1)] + 12;
      note('square', hz(n), 0.1, 0.032, at, {
        filter: 'lowpass',
        filterFrom: 3200,
        filterTo: 1500,
      });
    }

    // 铺底：每小节头两拍各来一次，失谐双锯齿
    if (s === 0 || s === 8) {
      const dur = (STEP * 8) * 0.98;
      for (const det of [-6, 7]) {
        note('sawtooth', hz(chord[0] - 12) * (1 + det / 1000), dur, 0.03, at, {
          filter: 'lowpass',
          filterFrom: 900,
          filterTo: 500,
          attack: 0.25,
        });
      }
    }

    step = (step + 1) % (PROGRESSION.length * 16);
  }

  function tick() {
    const { ctx, ready } = audio.buses();
    if (!playing || !ready || !ctx) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(nextTime);
      nextTime += STEP;
    }
  }

  return {
    start() {
      const { ctx, ready } = audio.buses();
      if (!ready || !ctx || playing) return;
      playing = true;
      nextTime = ctx.currentTime + 0.08;
      step = 0;
      timer = setInterval(tick, TICK_MS);
    },
    stop() {
      playing = false;
      if (timer) clearInterval(timer);
      timer = 0;
    },
    isPlaying: () => playing,
    step: () => step,
  };
}
