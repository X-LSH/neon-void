/**
 * 玩家飞船、道具、金币的造型绘制。只读。
 *
 * 敌机与 Boss 的造型在 `enemies-art.js`（那个文件更长，拆开是为了守住
 * 单文件 300 行的硬约束 —— 这条规则由 verify.mjs 的断言看守）。
 */

import {
  strokeGlow, fillCircleGlow, fillPath, polygon, STROKE_4, TAU,
} from './glow.js';
import { PAL, POWER_COLOR, POWER_GLYPH } from './palette.js';

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

/** 引擎尾焰：与敌机同款的相位抖动，保持全站视觉语言一致 */
function thruster(ctx, x, y, r, t, phase, color, power = 1) {
  const f = (0.72 + 0.28 * Math.sin(t * 18 + phase)) * power;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y);
  ctx.lineTo(x, y + r * 1.6 * f);
  ctx.lineTo(x + r * 0.4, y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.34, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawShip(ctx, p, t, x = p.x, y = p.y) {
  const blink = p.invuln > 0 && Math.floor(t * 14) % 2 === 0;
  const alpha = blink ? 0.32 : 1;
  const inv = p.invuln > 0 && p.invuln < 0.5;
  const color = inv ? PAL.warn : PAL.player;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;

  // 尾焰（引擎在船尾）。加速时明显变长变亮 —— 让"速度"这件事看得见。
  thruster(ctx, -5.5, 15, 3.2, t, 0, PAL.playerTrail, p.powers.speed > 0 ? 1.5 : 1);
  thruster(ctx, 5.5, 15, 3.2, t, 1.9, PAL.playerTrail, p.powers.speed > 0 ? 1.5 : 1);

  /**
   * ★ 散射期间挂出两个副炮口。
   * 光靠"子弹从 1 路变 3 路"来体现散射是不够的 —— 弹幕密的时候玩家
   * 分不清是自己的火变宽了还是多了几发敌人的弹。给船加一个**持久的形状变化**，
   * 一眼就能确认"散射还在"。
   */
  if (p.powers.spread > 0) {
    const pod = 0.75 + 0.25 * Math.sin(t * 9);
    for (const s of [-1, 1]) {
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = PAL.danger;
      ctx.beginPath();
      ctx.arc(s * 9.4, -6, 2.6 * pod + 0.6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = PAL.danger;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s * 9.4, -6, 4.6, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
  }

  fillPath(ctx, (c) => shipPath(c, 26, 32), color, 0.16);
  // 玩家是焦点：唯一允许 4 层辉光的元素之一
  strokeGlow(ctx, (c) => shipPath(c, 26, 32), color, STROKE_4);

  // 进气口细节：单次描边，不加辉光（细节不该抢主轮廓的注意力）
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = alpha * 0.7;
  ctx.beginPath();
  ctx.moveTo(-8.6, 2.4);
  ctx.lineTo(-4.4, -3.2);
  ctx.moveTo(8.6, 2.4);
  ctx.lineTo(4.4, -3.2);
  ctx.stroke();
  ctx.globalAlpha = alpha;

  // 判定核心：**必须被画出来**。判定半径（6）远小于视觉体积（26×32），
  // 这是对玩家有利的设计，但只有看得见才谈得上「受伤可归因」。
  if (!blink) {
    fillCircleGlow(ctx, 0, 0, 4.2, PAL.playerCore,
      [{ m: 2.6, a: 0.36 }, { m: 1.3, a: 0.7 }, { m: 1, a: 1 }]);
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
  strokeGlow(ctx, (c) => polygon(c, d.r, 4, spin), color,
    [{ w: 7, a: 0.14 }, { w: 3, a: 0.34 }, { w: 1.2, a: 1 }]);

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
