/**
 * 程序化音效。零外部音频文件、零版权风险、部署体积零增长。
 *
 * 硬约束（见 SPEC §11）：
 *   · AudioContext 必须挂在首次用户手势上创建/恢复；
 *   · 环境不支持或初始化失败时，全部调用降级为 no-op 并且**绝不抛异常**
 *     —— 音频永远不该是「游戏打不开」的原因。
 */

const NOISE_SECONDS = 2;

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noise = null;
  let ready = false;
  let failed = false;
  let voices = 0;

  const settings = { sound: true, music: true };
  let musicHandle = null;

  function build() {
    if (ready || failed) return ready;
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) {
        failed = true;
        return false;
      }
      ctx = new AC();

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.22;

      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.75;
      sfxBus.connect(master);

      musicBus = ctx.createGain();
      musicBus.gain.value = 0.5;
      musicBus.connect(master);

      // 一次性噪声缓冲，所有爆裂/踩镲共用
      const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      let s = 0x1f2e3d4c;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = (s / 4294967296) * 2 - 1;
      }

      ready = true;
      applyGains();
    } catch {
      failed = true;
      ready = false;
    }
    return ready;
  }

  function applyGains() {
    if (!ready) return;
    try {
      sfxBus.gain.value = settings.sound ? 0.75 : 0;
      musicBus.gain.value = settings.music ? 0.5 : 0;
    } catch { /* 忽略 */ }
  }

  /** 是否处于「能发声」的可用态（供自检断言 no-op 降级） */
  const usable = () => ready && !failed && ctx !== null;

  function spawnVoice() {
    if (!usable() || voices > 26) return false;
    voices += 1;
    return true;
  }

  function tone(type, freq, dur, gain, opts = {}) {
    if (!spawnVoice()) return;
    const t = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (opts.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.filterFrom || freq * 2, t);
      if (opts.filterTo) {
        f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterTo), t + dur);
      }
      if (opts.q) f.Q.value = opts.q;
      node.connect(f);
      f.connect(g);
    } else {
      node.connect(g);
    }
    g.connect(opts.bus === 'music' ? musicBus : sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => { voices -= 1; };
  }

  function noiseBurst(dur, gain, opts = {}) {
    if (!spawnVoice()) return;
    const t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.from || 1400, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to || 180), t + dur);
    if (opts.q) f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => { voices -= 1; };
  }

  // ── 音效表 ─────────────────────────────────────────────────
  const SFX = {
    shoot: () => tone('square', 900, 0.055, 0.045, { to: 300, filter: 'lowpass', filterFrom: 2600, filterTo: 700 }),
    hit: () => noiseBurst(0.05, 0.07, { filter: 'highpass', from: 3200, to: 2600 }),
    enemyDie: () => {
      noiseBurst(0.24, 0.13, { from: 1500, to: 160, q: 1.1 });
      tone('sine', 190, 0.22, 0.09, { to: 48 });
    },
    bigDie: () => {
      noiseBurst(0.85, 0.2, { from: 2200, to: 90, q: 0.8 });
      tone('sine', 120, 0.9, 0.18, { to: 28 });
      tone('sawtooth', 300, 0.4, 0.07, { to: 60, filter: 'lowpass', filterFrom: 1400, filterTo: 200 });
    },
    coin: () => tone('triangle', 1568, 0.045, 0.05, { to: 2093 }),
    pickup: () => {
      [660, 988, 1319].forEach((f, i) => tone('triangle', f, 0.07, 0.07, { delay: i * 0.045 }));
    },
    playerHit: () => {
      tone('sawtooth', 430, 0.34, 0.13, { to: 62, filter: 'lowpass', filterFrom: 2200, filterTo: 260 });
      noiseBurst(0.3, 0.12, { from: 900, to: 120 });
    },
    shieldBreak: () => {
      tone('square', 1200, 0.24, 0.08, { to: 300, filter: 'bandpass', filterFrom: 2400, filterTo: 700, q: 6 });
    },
    uiClick: () => tone('triangle', 520, 0.05, 0.06, { to: 700 }),
    uiMove: () => tone('triangle', 380, 0.04, 0.035),
    waveBanner: () => {
      tone('triangle', 523, 0.14, 0.07);
      tone('triangle', 784, 0.2, 0.07, { delay: 0.13 });
    },
    bossPhase: () => {
      tone('sawtooth', 160, 0.6, 0.12, { to: 420, filter: 'lowpass', filterFrom: 500, filterTo: 2400 });
    },
  };

  return {
    /** 必须在用户手势里调用 */
    async unlock() {
      if (!build()) return false;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch { /* 忽略 */ }
      return ctx.state === 'running';
    },
    play(name) {
      if (!settings.sound) return;
      if (!usable()) return;
      const fn = SFX[name];
      if (fn) {
        try { fn(); } catch { /* 单次音效失败不该影响游戏 */ }
      }
    },
    setSetting(key, value) {
      if (!(key in settings)) return;
      settings[key] = Boolean(value);
      applyGains();
    },
    getSettings: () => ({ ...settings }),
    /** 暴露给 music.js 的总线 */
    buses: () => ({ ctx, musicBus, ready: usable(), master }),
    isUsable: usable,
    /** 音频不可用的原因（自检用） */
    failureReason: () => (failed ? 'no-web-audio-or-init-failed' : ready ? null : 'not-initialised'),
    setMusicHandle: (h) => { musicHandle = h; },
    stopMusic() {
      if (musicHandle) {
        try { musicHandle.stop(); } catch { /* 忽略 */ }
        musicHandle = null;
      }
    },
  };
}
