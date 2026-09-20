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

/**
 * 计击杀但**不累积连击**（炸弹清屏用）。
 *
 * 击杀总数必须照常累加 —— 结算页要显示它，玩家也确实清了这些敌人。
 * 被排除的只是**连击计数与倍率**：一个炸弹把连击顶到 32 会让每次击杀
 * 都吃到 4.1 倍率，实测单次给 42432 分（约占一局的一半）。
 * 连击奖励的是**瞄准**，不是清屏。
 */
export function addKillFlat(s, base) {
  s.kills += 1;
  s.score += base;
  return base;
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
