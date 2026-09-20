/**
 * 战斗场景绘制。只读 —— 不得修改任何游戏状态。
 *
 * 两个结构决策：
 *   1. **背景与边框不参与震动**，只有游戏区内的内容震动，并且裁剪在边框内。
 *      否则震一下就会露出留白、边框跟着抖 —— 那是"渲染出错了"的观感，
 *      而不是"打击感"。震动的东西应该是画面里的世界，而不是相框。
 *   2. **子弹按 kind 批量成一次 path**：900 发子弹逐个 stroke/fill 是 2700 次
 *      状态切换，批量之后是固定 6 次。这是子弹能撑到 900 发的唯一原因。
 */

import { FIELD_W, FIELD_H } from '../game/config.js';
import { ENEMY_DEFS } from '../game/enemies.js';
import { KIND } from '../game/bullets.js';
import { PAL } from './palette.js';
import { drawEnemy, drawShip, drawBoss, drawPowerup, drawCoin } from './shapes.js';
import { drawParticles } from './particles.js';
import { createBackground, drawFieldFrame } from './background.js';

const lerp = (a, b, t) => a + (b - a) * t;

/** 可见的游戏区坐标范围（把画布四角反算回游戏区坐标） */
export function visibleRect(vp) {
  return {
    x0: -vp.ox / vp.scale,
    y0: -vp.oy / vp.scale,
    x1: (vp.cssW - vp.ox) / vp.scale,
    y1: (vp.cssH - vp.oy) / vp.scale,
  };
}

function drawDrops(ctx, w, alpha, t) {
  for (const d of w.drops.items) {
    if (!d.alive) continue;
    const x = lerp(d.px, d.x, alpha);
    const y = lerp(d.py, d.y, alpha);
    if (d.kind === 1) drawPowerup(ctx, d, t, x, y);
    else drawCoin(ctx, d, t, x, y);
  }
}

function drawEnemies(ctx, w, alpha, t) {
  for (const e of w.enemies.items) {
    if (!e.alive) continue;
    drawEnemy(ctx, e, ENEMY_DEFS[e.type], t, lerp(e.px, e.x, alpha), lerp(e.py, e.y, alpha));
  }
}

/** 玩家子弹：整批一次描边 + 一次填充 */
function drawPlayerBullets(ctx, w, alpha) {
  const f = w.pBullets;
  if (f.count === 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // 拖尾（外层光晕）
  ctx.beginPath();
  for (let i = 0; i < f.cap; i++) {
    if (!f.alive[i]) continue;
    const x = lerp(f.px[i], f.x[i], alpha);
    const y = lerp(f.py[i], f.y[i], alpha);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
  }
  ctx.strokeStyle = PAL.pBullet;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3.4;
  ctx.stroke();

  // 核心
  ctx.beginPath();
  for (let i = 0; i < f.cap; i++) {
    if (!f.alive[i]) continue;
    const x = lerp(f.px[i], f.x[i], alpha);
    const y = lerp(f.py[i], f.y[i], alpha);
    ctx.moveTo(x + 1.5, y - 5);
    ctx.arc(x, y - 5, 1.5, 0, Math.PI * 2);
  }
  ctx.fillStyle = PAL.pBulletCore;
  ctx.globalAlpha = 0.95;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * 敌方子弹：拖尾 + 亮核，按 kind 分两组各批处理。
 * 密集弹幕必须「读得清」——核心用接近白的暖色，否则一片红糊在一起，
 * 玩家分不清哪里有缝。
 */
function drawEnemyBullets(ctx, w, alpha) {
  const f = w.eBullets;
  const n = f.count;
  if (n === 0) return;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // 密集时降级：只画核，不画辉光 —— 帧率优先于光晕（SPEC §9）
  const softGlow = n < 420;

  if (softGlow) {
    for (const k of [KIND.ENEMY, KIND.HEAVY]) {
      ctx.beginPath();
      for (let i = 0; i < f.cap; i++) {
        if (!f.alive[i] || f.kind[i] !== k) continue;
        const x = lerp(f.px[i], f.x[i], alpha);
        const y = lerp(f.py[i], f.y[i], alpha);
        const sp = Math.hypot(f.vx[i], f.vy[i]) || 1;
        const L = Math.min(15, sp * 0.03);
        ctx.moveTo(x, y);
        ctx.lineTo(x - (f.vx[i] / sp) * L, y - (f.vy[i] / sp) * L);
      }
      ctx.strokeStyle = PAL.eBullet;
      ctx.globalAlpha = k === KIND.HEAVY ? 0.3 : 0.24;
      ctx.lineWidth = k === KIND.HEAVY ? 10 : 7.5;
      ctx.stroke();
    }
  }

  // 亮核（一次 path 画完所有子弹）
  ctx.beginPath();
  for (let i = 0; i < f.cap; i++) {
    if (!f.alive[i]) continue;
    const x = lerp(f.px[i], f.x[i], alpha);
    const y = lerp(f.py[i], f.y[i], alpha);
    ctx.moveTo(x + f.rad[i], y);
    ctx.arc(x, y, f.rad[i], 0, Math.PI * 2);
  }
  ctx.fillStyle = PAL.eBulletCore;
  ctx.globalAlpha = 0.92;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function createWorldRenderer(vp, particles, bgRng) {
  const bg = createBackground(bgRng);

  /** 只画背景与边框 —— 菜单 / 排行榜 / 说明页背后的活动星空 */
  function backdrop(t) {
    const ctx = vp.ctx;
    const rect = visibleRect(vp);
    vp.begin();
    ctx.save();
    ctx.translate(vp.ox, vp.oy);
    ctx.scale(vp.scale, vp.scale);
    bg.draw(ctx, rect, t);
    drawFieldFrame(ctx, rect);
    ctx.restore();
  }

  return {
    backdrop,
    /**
     * @param bgTime 背景自己的时钟。与 world.t 分开，这样暂停时世界冻结、
     *               而星空继续漂 —— 全静止会让"暂停"看起来像"页面崩了"。
     */
    draw(w, alpha, bgTime = w.t) {
      const ctx = vp.ctx;
      const rect = visibleRect(vp);

      // ── 第一趟：背景 + 边框（不参与震动，避免露出留白）────────
      vp.begin();
      ctx.save();
      ctx.translate(vp.ox, vp.oy);
      ctx.scale(vp.scale, vp.scale);
      bg.draw(ctx, rect, bgTime);
      drawFieldFrame(ctx, rect);
      ctx.restore();

      // ── 第二趟：游戏内容（震动 + 裁剪在边框内）───────────────
      vp.begin();
      ctx.save();
      ctx.beginPath();
      ctx.rect(vp.ox, vp.oy, FIELD_W * vp.scale, FIELD_H * vp.scale);
      ctx.clip();
      ctx.translate(vp.ox + w.fx.shakeX * vp.scale, vp.oy + w.fx.shakeY * vp.scale);
      ctx.scale(vp.scale, vp.scale);

      drawDrops(ctx, w, alpha, w.t);
      drawEnemies(ctx, w, alpha, w.t);
      if (w.boss) {
        drawBoss(ctx, w.boss, w.t, lerp(w.boss.px, w.boss.x, alpha), lerp(w.boss.py, w.boss.y, alpha));
      }
      if (w.player.alive) {
        drawShip(ctx, w.player, w.t,
          lerp(w.player.px, w.player.x, alpha), lerp(w.player.py, w.player.y, alpha));
      }
      // 粒子在角色之上、子弹之下：子弹必须永远可读
      drawParticles(ctx, particles);
      drawPlayerBullets(ctx, w, alpha);
      drawEnemyBullets(ctx, w, alpha);

      ctx.restore();

      // ── 第三趟：全屏闪光（屏幕空间，覆盖留白才够"震"）────────
      if (w.fx.flash > 0.01) {
        vp.begin();
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, w.fx.flash * 0.5)})`;
        ctx.fillRect(0, 0, vp.cssW, vp.cssH);
      }
    },
  };
}
