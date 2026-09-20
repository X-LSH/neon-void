/**
 * 几何形状绘制。只读，不修改任何游戏状态。
 *
 * 所有路径以 (0,0) 为中心 —— 调用方负责 translate/rotate。
 * 这是「色相即危险等级」的落地点：颜色只从 palette.js 取，此处不出现字面色值。
 */

import { PAL, ENEMY_COLOR, POWER_COLOR, POWER_GLYPH, BOSS_TRIM } from './palette.js';
import {
  strokeGlow, fillCircleGlow, fillPath, polygon, starPath,
  STROKE_3, STROKE_4, CIRCLE_3, CIRCLE_4, TAU,
} from './glow.js';

/** 玩家飞船：朝上的几何箭头 */
export function shipPath(ctx, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  ctx.moveTo(0, -hh);
  ctx.lineTo(hw * 0.44, -hh * 0.2);
  ctx.lineTo(hw, hh * 0.56);
  ctx.lineTo(hw * 0.44, hh * 0.4);
  ctx.lineTo(hw * 0.32, hh);
  ctx.lineTo(0, hh * 0.72);
  ctx.lineTo(-hw * 0.32, hh);
  ctx.lineTo(-hw * 0.44, hh * 0.4);
  ctx.lineTo(-hw, hh * 0.56);
  ctx.lineTo(-hw * 0.44, -hh * 0.2);
  ctx.closePath();
}

export function shapePath(ctx, shape, r, rot = 0) {
  switch (shape) {
    case 'triangle':
      ctx.moveTo(0, r * 1.05);
      ctx.lineTo(-r * 0.94, -r * 0.76);
      ctx.lineTo(r * 0.94, -r * 0.76);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, r * 1.12);
      ctx.lineTo(r * 0.78, 0);
      ctx.lineTo(0, -r * 1.12);
      ctx.lineTo(-r * 0.78, 0);
      ctx.closePath();
      break;
    case 'circle':
      ctx.arc(0, 0, r, 0, TAU);
      break;
    case 'hexagon':
      polygon(ctx, r, 6, Math.PI / 6 + rot);
      break;
    case 'star':
      starPath(ctx, r * 1.15, r * 0.5, 6, rot);
      break;
    case 'boss':
      polygon(ctx, r, 8, Math.PI / 8 + rot);
      break;
    default:
      polygon(ctx, r, 5, rot);
  }
}

/** 精英怪的闪烁：品红 ↔ 白，频率随紧张度提高 */
export function blinkColor(base, t, rate = 6) {
  return Math.sin(t * rate * TAU) > 0 ? base : '#ffffff';
}

/** x/y 允许传入插值后的位置（渲染在物理步之间插值，见 SPEC §1.1） */
export function drawEnemy(ctx, e, def, t, x = e.x, y = e.y) {
  const color = def.blink ? blinkColor(ENEMY_COLOR[e.type], t, 2.4) : ENEMY_COLOR[e.type];
  ctx.save();
  ctx.translate(x, y);

  const rot = def.shape === 'star' || def.shape === 'hexagon' ? t * 0.8 : 0;
  // 本体：暗底填充，让敌机在密集弹幕里仍有实体感
  fillPath(ctx, (c) => shapePath(c, def.shape, def.r, rot), color, 0.14);
  strokeGlow(ctx, (c) => shapePath(c, def.shape, def.r, rot), color, STROKE_3);

  // 受击闪白
  if (e.flash > 0) {
    strokeGlow(ctx, (c) => shapePath(c, def.shape, def.r, rot), '#ffffff',
      [{ w: 5, a: 0.5 * e.flash }, { w: 1.6, a: e.flash }]);
  }

  // 血条弧：只有坦克/精英有，且两者都是「需要被集火」的目标。
  // 没有它，玩家会在血厚的敌机上白白浪费输出而不知道为什么打不死。
  if (def.cost >= 5) {
    const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    const rr = def.r + 7;
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 内核点：让「打哪里有效」一眼可见
  fillCircleGlow(ctx, 0, 0, def.r * 0.22, color, [{ m: 2.2, a: 0.3 }, { m: 1, a: 0.9 }]);
  ctx.restore();
}

export function drawShip(ctx, p, t, x = p.x, y = p.y) {
  const blink = p.invuln > 0 && Math.floor(t * 14) % 2 === 0;
  const alpha = blink ? 0.32 : 1;
  const inv = p.invuln > 0 && p.invuln < 0.5;
  const color = inv ? PAL.warn : PAL.player;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;

  fillPath(ctx, (c) => shipPath(c, 26, 32), color, 0.16);
  // 玩家是焦点：唯一允许 4 层辉光的元素之一
  strokeGlow(ctx, (c) => shipPath(c, 26, 32), color, STROKE_4);

  // 判定核心：**必须被画出来**。判定半径（6）远小于视觉体积（26×32），
  // 这是对玩家有利的设计，但只有看得见才谈得上「受伤可归因」。
  if (!blink) {
    fillCircleGlow(ctx, 0, 0, 4.2, PAL.playerCore, [{ m: 2.6, a: 0.36 }, { m: 1.3, a: 0.7 }, { m: 1, a: 1 }]);
  }

  if (p.shield) {
    const pulse = 1 + Math.sin(t * 5.5) * 0.06;
    ctx.globalAlpha = alpha * 0.85;
    strokeGlow(ctx, (c) => c.arc(0, 0, 24 * pulse, 0, TAU), PAL.shield,
      [{ w: 6, a: 0.16 }, { w: 2.6, a: 0.4 }, { w: 1.2, a: 0.95 }]);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawBoss(ctx, b, t, x = b.x, y = b.y) {
  const dying = b.dying;
  const k = dying ? Math.min(1, b.deathT / 1.2) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = dying ? 1 - k * k : 1;
  ctx.scale(1 + k * 0.5, 1 + k * 0.5);

  const rot = Math.sin(t * 0.5) * 0.06;
  fillPath(ctx, (c) => shapePath(c, 'boss', b.r, rot), PAL.danger, 0.12);
  strokeGlow(ctx, (c) => shapePath(c, 'boss', b.r, rot), PAL.danger, STROKE_4);

  // 青色只做装饰描边（纯青是"我"的语义，这里用它的深色变体 BOSS_TRIM）
  strokeGlow(ctx, (c) => shapePath(c, 'boss', b.r * 0.68, -rot), BOSS_TRIM,
    [{ w: 4, a: 0.16 }, { w: 1.3, a: 0.8 }]);

  const core = 0.5 + Math.sin(t * 3) * 0.1;
  fillCircleGlow(ctx, 0, 0, b.r * 0.3 * core, PAL.danger,
    [{ m: 2.4, a: 0.24 }, { m: 1.4, a: 0.5 }, { m: 1, a: 0.95 }]);

  // 阶段灯：三颗，亮起的数量 = 当前阶段（玩家能预判还剩几段）
  for (let i = 0; i < 3; i++) {
    const on = i < b.phase;
    ctx.globalAlpha *= 1;
    ctx.globalAlpha = dying ? 1 - k : 1;
    fillCircleGlow(ctx, -18 + i * 18, b.r * 0.62, 3.4,
      on ? PAL.danger : PAL.faint, on ? [{ m: 2, a: 0.4 }, { m: 1, a: 1 }] : [{ m: 1, a: 1 }]);
  }

  if (b.flash > 0) {
    strokeGlow(ctx, (c) => shapePath(c, 'boss', b.r, rot), '#ffffff',
      [{ w: 8, a: 0.4 * b.flash }, { w: 2, a: b.flash }]);
  }

  // P3 环形爆发前的预警环：收缩到 0 就是爆发时刻。
  // 无预告的危险 = 不可归因的死亡（SPEC §5.2）。
  if (b.warnT > 0) {
    const prog = b.warnT / 0.5;
    ctx.globalAlpha = 0.35 + (1 - prog) * 0.5;
    strokeGlow(ctx, (c) => c.arc(0, 0, b.r * (1.5 + prog * 2.2), 0, TAU), PAL.danger,
      [{ w: 7, a: 0.2 }, { w: 1.8, a: 0.9 }]);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 道具内部图标 —— 恒定白色，这是「可拾取」的视觉签名（SPEC §0.2） */
function powerGlyph(ctx, ptype) {
  const s = 5.2;
  switch (ptype) {
    case 'spread':
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s * 0.7);
      ctx.moveTo(0, 0);
      ctx.lineTo(-s * 0.85, s * 0.75);
      ctx.moveTo(0, 0);
      ctx.lineTo(s * 0.85, s * 0.75);
      break;
    case 'shield':
      ctx.arc(0, 0, s * 0.82, 0, TAU);
      break;
    case 'magnet':
      ctx.moveTo(-s * 0.8, -s * 0.5);
      ctx.lineTo(-s * 0.8, s * 0.35);
      ctx.arc(0, s * 0.35, s * 0.8, Math.PI, 0, true);
      ctx.lineTo(s * 0.8, -s * 0.5);
      break;
    case 'bomb':
      for (let i = 0; i < 4; i++) {
        const a = (TAU * i) / 4 + Math.PI / 4;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      break;
    case 'speed':
      ctx.moveTo(-s * 0.15, -s);
      ctx.lineTo(s * 0.85, 0);
      ctx.lineTo(-s * 0.15, s);
      break;
    default:
      ctx.arc(0, 0, s * 0.6, 0, TAU);
  }
}

export function drawPowerup(ctx, d, t, x, y) {
  const color = POWER_COLOR[d.ptype] || '#ffffff';
  const spin = t * 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 + Math.sin(t * 6) * 0.07, 1 + Math.sin(t * 6) * 0.07);

  // 旋转菱形外框：形状=类别（道具），与敌机的几何形状区分开
  fillPath(ctx, (c) => polygon(c, d.r, 4, spin), color, 0.2);
  strokeGlow(ctx, (c) => polygon(c, d.r, 4, spin), color, STROKE_3);

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = POWER_GLYPH;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  powerGlyph(ctx, d.ptype);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawCoin(ctx, d, t, x, y) {
  const r = d.r * 0.62;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 2.2);
  fillPath(ctx, (c) => polygon(c, r, 4, 0), PAL.coin, 0.85);
  ctx.restore();
  fillCircleGlow(ctx, x, y, r * 0.5, PAL.coin, [{ m: 2.4, a: 0.16 }, { m: 1, a: 0.5 }]);
}

export { CIRCLE_3, CIRCLE_4 };
