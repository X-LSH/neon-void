/**
 * Boss：要塞。装甲环随阶段脱落、露出核心 —— 阶段推进是**看得见**的。
 *
 * 从 enemies-art.js 拆出来是为了守住单文件 300 行的硬约束（verify.mjs 看守）。
 * 复用了那边的 eye / scorch：跨文件共用的视觉语言必须只有一份实现，
 * 否则"眼珠朝向玩家"这类细节迟早会在两处走样。
 */

import {
  strokeGlow, fillCircleGlow, fillPath, polygon, STROKE_4, TAU,
} from './glow.js';
import { PAL, BOSS_TRIM } from './palette.js';
import { eye, scorch } from './enemies-art.js';

const cos = Math.cos;
const sin = Math.sin;

/** Boss：要塞。装甲环随阶段脱落，露出核心 */
export function drawBoss(ctx, b, t, x = b.x, y = b.y, aim = Math.PI / 2) {
  const dying = b.dying;
  const k = dying ? Math.min(1, b.deathT / 1.2) : 0;
  const r = b.r;
  const hp = b.maxHp > 0 ? Math.max(0, b.hp / b.maxHp) : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = dying ? 1 - k * k : 1;
  ctx.scale(1 + k * 0.5, 1 + k * 0.5);

  // 装甲环：三圈，随阶段一层层崩掉
  const rings = [
    { rr: 1.0, arms: 8, rot: Math.sin(t * 0.5) * 0.06, alive: true },
    { rr: 0.78, arms: 8, rot: -t * 0.28, alive: b.phase <= 2 },
    { rr: 0.56, arms: 6, rot: t * 0.4, alive: b.phase <= 1 },
  ];
  for (const ring of rings) {
    if (!ring.alive) continue;
    fillPath(ctx, (c) => polygon(c, r * ring.rr, ring.arms, ring.rot), PAL.danger, 0.1);
    strokeGlow(ctx, (c) => polygon(c, r * ring.rr, ring.arms, ring.rot), PAL.danger,
      ring.rr === 1 ? STROKE_4 : [{ w: 5, a: 0.16 }, { w: 1.4, a: 0.9 }]);
  }

  // 深青装饰描边（纯青是"我"的语义，这里用它的深色变体）
  strokeGlow(ctx, (c) => polygon(c, r * 0.9, 8, -Math.sin(t * 0.5) * 0.06), BOSS_TRIM,
    [{ w: 4, a: 0.16 }, { w: 1.3, a: 0.8 }]);

  // 四座炮塔，炮口朝玩家
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (TAU * i) / 4;
    const bx = cos(a) * r * 0.74;
    const by = sin(a) * r * 0.74;
    ctx.fillStyle = PAL.danger;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.09, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + cos(aim) * r * 0.3, by + sin(aim) * r * 0.3);
    ctx.lineTo(bx + cos(aim + 2.6) * r * 0.1, by + sin(aim + 2.6) * r * 0.1);
    ctx.lineTo(bx + cos(aim - 2.6) * r * 0.1, by + sin(aim - 2.6) * r * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  // 主眼：血量越低越红、越亮（还能当血条用）
  const core = 0.52 + 0.14 * Math.sin(t * 3) + (1 - hp) * 0.22;
  fillCircleGlow(ctx, 0, 0, r * 0.3 * core, PAL.danger,
    [{ m: 2.4, a: 0.24 }, { m: 1.4, a: 0.5 }, { m: 1, a: 0.95 }]);
  eye(ctx, 0, 0, r * 0.2, aim, '#ffffff', PAL.eyePit);
  scorch(ctx, r, hp, '#ffffff');

  // 阶段灯：亮起的数量 = 当前阶段
  for (let i = 0; i < 3; i++) {
    const on = i < b.phase;
    ctx.globalAlpha = dying ? 1 - k : 1;
    fillCircleGlow(ctx, -18 + i * 18, r * 0.62, 3.4,
      on ? PAL.danger : PAL.faint, on ? [{ m: 2, a: 0.4 }, { m: 1, a: 1 }] : [{ m: 1, a: 1 }]);
  }

  if (b.flash > 0) {
    strokeGlow(ctx, (c) => polygon(c, r, 8, 0), '#ffffff',
      [{ w: 8, a: 0.4 * b.flash }, { w: 2, a: b.flash }]);
  }

  // P3 环形爆发前的收缩预警环：无预告的危险 = 不可归因的死亡
  if (b.warnT > 0) {
    const prog = b.warnT / 0.5;
    ctx.globalAlpha = 0.35 + (1 - prog) * 0.5;
    strokeGlow(ctx, (c) => c.arc(0, 0, r * (1.5 + prog * 2.2), 0, TAU), PAL.danger,
      [{ w: 7, a: 0.2 }, { w: 1.8, a: 0.9 }]);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

