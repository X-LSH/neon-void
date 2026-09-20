/**
 * 计分与连击。纯数据，不依赖世界与渲染。
 *
 * 倍率口径见 SPEC §7：multiplier = min(5.0, 1 + (combo−1) × 0.1)
 * 首杀（combo=1）倍率为 1.0 —— 连击是奖励「连得住」，不是奖励「开了第一枪」。
 */

import { SCORE } from './config.js';

export function createScore() {
  return {
    score: 0,
    combo: 0,
    comboT: 0,
    kills: 0,
    maxCombo: 0,
    t: 0,
    _survivalAcc: 0,
  };
}

export function multiplier(combo) {
  const c = Math.max(1, combo);
  return Math.min(SCORE.comboMax, 1 + (c - 1) * SCORE.comboStep);
}

/** 返回本次击杀的实际得分（供连击数字弹出显示） */
export function addKill(s, base) {
  s.combo += 1;
  s.kills += 1;
  s.comboT = SCORE.comboWindow;
  if (s.combo > s.maxCombo) s.maxCombo = s.combo;
  const gain = Math.round(base * multiplier(s.combo));
  s.score += gain;
  return gain;
}

export function addRaw(s, value) {
  const v = Math.max(0, Math.round(value));
  s.score += v;
  return v;
}

export function breakCombo(s) {
  s.combo = 0;
  s.comboT = 0;
}

export function stepScore(s, dt) {
  s.t += dt;

  // 存活加分按整数累加，避免每帧 +0.2 这种永远不落地的浮点
  s._survivalAcc += dt * SCORE.survivalPerSec;
  const whole = Math.floor(s._survivalAcc);
  if (whole > 0) {
    s.score += whole;
    s._survivalAcc -= whole;
  }

  if (s.comboT > 0) {
    s.comboT -= dt;
    if (s.comboT <= 0) breakCombo(s);
  }
}
