/**
 * Boss：每 10 波出现一次，三阶段弹幕。
 *
 * P3 的环形爆发前有 0.5s 收缩预警环 —— 不存在无预告的危险（SPEC §5.2）。
 * Boss 判定半径取外接圆的 0.87（外接圆 62 → 六边形内切圆 53.7），
 * 保证判定框 ≤ 视觉体积：玩家贴着棱角飞过去不该死。
 */

import { FIELD_W, WAVE } from './config.js';
import { fan, ring, spiral } from './enemy-fire.js';
import { KIND } from './bullets.js';
import { ramps } from './enemies.js';

const DEG = Math.PI / 180;

export const BOSS_R = 62;
export const BOSS_HOLD_Y = 108;
/** 判定半径 / 外接圆 —— 六边形内切圆与外接圆之比 */
export const BOSS_HIT_RATIO = 0.87;
/** P3 环形爆发前的预警时长（秒） */
export const BOSS_WARN = 0.5;

/**
 * Boss 血量。
 * 实测校准入参（balance.mjs）：参考玩家在 Boss 横移时的命中率约 50–70%
 * （子弹飞行 0.66s，Boss 横移速度峰值 77 u/s ≈ 51 单位的提前量），
 * 所以 170 HP 的实际耗时约 30s —— 这是「一场 Boss 该有的长度」，
 * 而不是按 100% 命中率倒推出来的 20s。
 */
export function bossHp(wave) {
  return 120 + Math.floor(wave / WAVE.bossEvery) * 50;
}

export function createBoss(wave) {
  const hp = bossHp(wave);
  return {
    wave,
    hp,
    maxHp: hp,
    x: FIELD_W / 2,
    y: -110,
    px: FIELD_W / 2,
    py: -110,
    r: BOSS_R,
    t: 0,
    entering: true,
    dying: false,
    deathT: 0,
    flash: 0,
    phase: 1,
    fireT: 1.2,
    volley: 0,
    summonT: 6,
    ringNext: true,
    warnT: 0,
  };
}

export function stepBoss(b, dt, ctx) {
  b.px = b.x;
  b.py = b.y;
  b.t += dt;
  if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 4);

  if (b.dying) {
    b.deathT += dt;
    return;
  }

  if (b.entering) {
    b.y += (BOSS_HOLD_Y - b.y) * (1 - Math.exp(-2.4 * dt));
    b.x = FIELD_W / 2;
    if (b.y > BOSS_HOLD_Y - 6) {
      b.entering = false;
      b.fireT = 1.2;
    }
    return;
  }

  b.x = FIELD_W / 2 + Math.sin(b.t * 0.6) * 128;
  b.y = BOSS_HOLD_Y + Math.sin(b.t * 0.9) * 14;

  const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 0;
  const want = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  if (want !== b.phase) {
    b.phase = want;
    b.fireT = 0.6;
    b.warnT = 0;
    ctx.onBossPhase(b);
  }

  if (b.warnT > 0) b.warnT = Math.max(0, b.warnT - dt);

  const fMul = ramps(b.wave).fire;
  const toPlayer = Math.atan2(ctx.player.y - b.y, ctx.player.x - b.x);
  b.fireT -= dt;

  if (b.fireT <= 0) {
    if (b.phase === 1) {
      b.fireT += 1.6 * fMul;
      fan(ctx.eb, b.x, b.y + 26, toPlayer, 5, 44 * DEG, 190, 4.4, KIND.HEAVY);
      b.volley += 1;
      ctx.onBossFire(b);
    } else if (b.phase === 2) {
      b.fireT += Math.max(0.11, 0.18 * fMul);
      spiral(ctx.eb, b.x, b.y + 18, 2, b.t * 1.7, 152, 3.9, KIND.ENEMY);
      b.volley += 1;
      ctx.onBossFire(b);
    } else {
      // P3：环形爆发与密集扇形交替，环形前必然预警
      const haste = 0.8;
      if (b.ringNext) {
        b.fireT += 1.5 * fMul * haste;
        ring(ctx.eb, b.x, b.y + 10, 16, 168, 4.6, KIND.HEAVY, b.volley);
        b.warnT = 0;
        b.ringNext = false;
      } else {
        b.fireT += 0.95 * fMul * haste;
        fan(ctx.eb, b.x, b.y + 26, toPlayer, 7, 62 * DEG, 205, 4.2, KIND.HEAVY);
        b.warnT = BOSS_WARN; // 预告下一次环形
        b.ringNext = true;
      }
      b.volley += 1;
      ctx.onBossFire(b);
    }
  }

  if (b.phase === 2) {
    b.summonT -= dt;
    if (b.summonT <= 0) {
      b.summonT = 6;
      ctx.summonScouts(2);
    }
  }
}
