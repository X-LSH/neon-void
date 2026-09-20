/**
 * 敌机与 Boss 的造型绘制。只读，不修改任何游戏状态。
 *
 * 设计原则（对「形状太简单、没有代入感」的正面回应）：
 *   1. **每型一个专属剪影**，不是"同一个多边形换个边数"。玩家要能凭轮廓在 0.2 秒内
 *      判断"这是什么、危不危险" —— 这是射击游戏的命门。
 *   2. **多部件**：机身 + 翼/炮舱/装甲环 + 座舱/眼 + 尾焰。单一路径永远像图标。
 *   3. **朝向即意图**：座舱、炮口、眼珠一律朝玩家（`aim`）。玩家能"看见它盯着我"。
 *   4. **受伤可见**：血量下降时出现焦痕、装甲缺口、闪烁加剧 ——
 *      既提升代入感，也回答"我打中了没有"。攻击反馈不能只靠数字。
 *   5. 辉光只给**主轮廓**（3 层），细节一律单次描边 ——
 *      45 只敌机 × 每个细节都描 3 层 = 上千次 stroke/帧，那才是"卡顿"的来源。
 */

import {
  strokeGlow, fillCircleGlow, fillPath, polygon, starPath,
  STROKE_2, STROKE_3, STROKE_4, TAU,
} from './glow.js';
import { ENEMY_COLOR, PAL, BOSS_TRIM } from './palette.js';
import { createSpriteCache } from './sprite.js';
import { HULLS } from './hulls.js';

/** 精英的闪烁：品红 ↔ 白 */
export function blinkColor(base, t, rate = 2.4) {
  return Math.sin(t * rate * TAU) > 0 ? base : '#ffffff';
}

const cos = Math.cos;
const sin = Math.sin;
/** 机身是静态的，只建一次 */
const SPRITES = createSpriteCache();

/** 尾焰：朝上（敌机朝下飞，引擎在后方），带相位抖动 */
function thruster(ctx, x, y, r, t, phase, color, power = 1) {
  const f = (0.72 + 0.28 * sin(t * 18 + phase)) * power;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.34, y);
  ctx.lineTo(x, y - r * 1.5 * f);
  ctx.lineTo(x + r * 0.34, y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * 座舱 / 眼珠：始终朝向玩家（aim 弧度），是"它盯着我"的视觉来源。
 * 手工做旋转而不是 ctx.rotate —— 每只敌机一次 save/rotate/restore
 * 在 45 只的规模下就是 45 次状态切换，而这里只是一次二维旋转乘法。
 */
export function eye(ctx, x, y, r, aim, iris, pupil) {
  const a = aim - Math.PI / 2;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const px = (lx, ly) => x + lx * c - ly * sn;
  const py = (lx, ly) => x + lx * sn + ly * c;
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.moveTo(px(0, r), py(0, r));
  ctx.lineTo(px(r * 0.8, -r * 0.55), py(r * 0.8, -r * 0.55));
  ctx.lineTo(px(-r * 0.8, -r * 0.55), py(-r * 0.8, -r * 0.55));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pupil;
  ctx.beginPath();
  ctx.arc(px(0, r * 0.12), py(0, r * 0.12), r * 0.34, 0, TAU);
  ctx.fill();
}

/** 焦痕：血量越低越明显（确定性摆放，不用随机数） */
export function scorch(ctx, r, hp, color) {
  if (hp > 0.6) return;
  const n = hp > 0.3 ? 2 : 4;
  ctx.globalAlpha = (0.6 - hp) * 1.6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n + 0.7;
    const x0 = cos(a) * r * 0.25;
    const y0 = sin(a) * r * 0.25;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + cos(a + 1.1) * r * 0.42, y0 + sin(a + 1.1) * r * 0.42);
    ctx.lineTo(x0 + cos(a + 0.4) * r * 0.66, y0 + sin(a + 0.4) * r * 0.66);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── 各型细节 ─────────────────────────────────────────────────

function detailsScout(ctx, def, t, e, aim, color) {
  eye(ctx, 0, def.r * 0.22, def.r * 0.2, aim, color, '#ffffff');
  thruster(ctx, 0, -def.r * 0.62, def.r * 0.42, t, e.phase, color);
}

function detailsStriker(ctx, def, t, e, aim, color) {
  const r = def.r;
  // 炮舱口
  ctx.fillStyle = color;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * r * 0.86, r * 0.42, r * 0.16, 0, TAU);
    ctx.fill();
  }
  eye(ctx, 0, r * 0.3, r * 0.26, aim, color, '#ffffff');
  thruster(ctx, -r * 0.42, -r * 0.72, r * 0.3, t, e.phase, color);
  thruster(ctx, r * 0.42, -r * 0.72, r * 0.3, t, e.phase + 1.7, color);
}

function detailsSeeker(ctx, def, t, e, aim, color) {
  const r = def.r;
  // 反向自转的传感环
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a0 = -t * 1.6 + (TAU * i) / 4;
    ctx.moveTo(cos(a0) * r * 0.72, sin(a0) * r * 0.72);
    ctx.arc(0, 0, r * 0.72, a0, a0 + 0.85);
  }
  ctx.stroke();
  // 边缘探针
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const a = (TAU * i) / 3 + 0.5;
    ctx.beginPath();
    ctx.arc(cos(a) * r * 1.0, sin(a) * r * 0.66, r * 0.13, 0, TAU);
    ctx.fill();
  }
  // 大眼：它真的在看你
  fillCircleGlow(ctx, 0, 0, r * 0.34, color, [{ m: 1.9, a: 0.25 }, { m: 1, a: 0.9 }]);
  eye(ctx, 0, 0, r * 0.3, aim, '#ffffff', PAL.eyePit);
}

function detailsTank(ctx, def, t, e, aim, color, hp) {
  const r = def.r;
  // 反向自转的装甲环
  ctx.globalAlpha = 0.6;
  strokeGlow(ctx, (c) => polygon(c, r * 0.62, 6, -Math.PI / 6 - t * 0.5), color,
    [{ w: 4, a: 0.2 }, { w: 1.2, a: 0.9 }]);
  // 四角炮塔，炮口朝玩家
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (TAU * i) / 4;
    const bx = cos(a) * r * 0.72;
    const by = sin(a) * r * 0.72;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.17, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + cos(aim) * r * 0.42, by + sin(aim) * r * 0.42);
    ctx.lineTo(bx + cos(aim + 2.5) * r * 0.16, by + sin(aim + 2.5) * r * 0.16);
    ctx.lineTo(bx + cos(aim - 2.5) * r * 0.16, by + sin(aim - 2.5) * r * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  // 暴露的核心（弱点）
  const pulse = 0.82 + 0.18 * sin(t * 5 + e.phase);
  fillCircleGlow(ctx, 0, 0, r * 0.26 * pulse, '#ffffff',
    [{ m: 2.6, a: 0.22 }, { m: 1.5, a: 0.5 }, { m: 1, a: 1 }]);
  scorch(ctx, r, hp, '#ffffff');
}

function detailsElite(ctx, def, t, e, aim, color, hp) {
  const r = def.r;
  // 反向自转的外刃环
  ctx.globalAlpha = 0.55;
  strokeGlow(ctx, (c) => starPath(c, r * 1.42, r * 0.82, 6, -t * 1.1), color,
    [{ w: 5, a: 0.18 }, { w: 1.3, a: 0.85 }]);
  // 4 个环绕光点
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const a = t * 2.2 + (TAU * i) / 4;
    ctx.beginPath();
    ctx.arc(cos(a) * r * 1.16, sin(a) * r * 1.16, 1.7, 0, TAU);
    ctx.fill();
  }
  fillCircleGlow(ctx, 0, 0, r * 0.3, color, [{ m: 2.2, a: 0.3 }, { m: 1, a: 0.95 }]);
  eye(ctx, 0, 0, r * 0.26, aim, '#ffffff', PAL.eyePit);
  scorch(ctx, r, hp, '#ffffff');
}

const DRAW = {
  scout: detailsScout,
  striker: detailsStriker,
  seeker: detailsSeeker,
  tank: detailsTank,
  elite: detailsElite,
};

/**
 * @param aim 从敌机指向玩家的弧度 —— 座舱/炮口/眼珠朝它
 */
export function drawEnemy(ctx, e, def, t, x = e.x, y = e.y, aim = Math.PI / 2, detailOn = true) {
  const rot = 0;
  const color = def.blink ? blinkColor(ENEMY_COLOR[e.type], t) : ENEMY_COLOR[e.type];
  const hp = e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 1;
  const hull = HULLS[e.type] || HULLS.scout;
  const detail = DRAW[e.type] || detailsScout;

  ctx.save();
  ctx.translate(x, y);

  // ★ 静态机身走精灵：1 次 blit 取代「1 次填充 + 2~3 次描边」，
  //   而这是唯一随敌机数量线性增长的开销。
  const spr = SPRITES.get(`${e.type}|${color}|${def.r}`, def.r, (g, r) => {
    fillPath(g, (c) => hull(c, r, rot), color, 0.13);
    strokeGlow(g, (c) => hull(c, r, rot), color, r < 13 ? STROKE_2 : STROKE_3);
  });
  ctx.drawImage(spr.cv, -spr.box / 2, -spr.box / 2, spr.box, spr.box);
  if (detailOn) detail(ctx, def, t, e, aim, color, hp);

  if (e.flash > 0) {
    // 闪白也走精灵：否则它又变回"每帧对 12 顶点路径描两遍"
    const fs = SPRITES.get(`flash|${e.type}|${def.r}`, def.r, (g, r) => {
      strokeGlow(g, (c) => hull(c, r, rot), '#ffffff',
        [{ w: 6, a: 0.5 }, { w: 1.8, a: 1 }]);
    });
    ctx.globalAlpha = e.flash;
    ctx.drawImage(fs.cv, -fs.box / 2, -fs.box / 2, fs.box, fs.box);
    ctx.globalAlpha = 1;
  }

  // 血条弧：只有坦克/精英有。没有它，玩家会在血厚的敌机上白白浪费输出
  // 而不知道为什么打不死。
  if (def.cost >= 5) {
    const rr = def.r + 7;
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
