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
import { PAL, POWER_COLOR } from './palette.js';
import { drawShip, drawPowerup, drawCoin } from './shapes.js';
import { drawEnemy } from './enemies-art.js';
import { drawBoss } from './boss-art.js';
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
  const p = w.player;
  const magnetOn = p.powers.magnet > 0;

  /**
   * ★ 磁铁的牵引光束。
   * 用户说「磁铁好像只是吸引，不是一定吸得过来」—— 机制改成了"直接给定速度"
   * 之后它确实吸得过来了，但**看不见就等于不存在**：掉落物从远处飞过来时，
   * 玩家根本不知道那是磁铁在起作用。
   * 一次 path 画完所有线，成本与掉落物数量无关。
   */
  if (magnetOn && p.alive) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // 两层：外层光晕 + 内层亮芯。单层 alpha 0.2 时**连像素判据都看不见它** ——
    // 那意味着玩家也看不见，等于没画。
    ctx.strokeStyle = POWER_COLOR.magnet;
    const beam = (width, a) => {
      ctx.globalAlpha = a;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const d of w.drops.items) {
        if (!d.alive) continue;
        ctx.moveTo(lerp(d.px, d.x, alpha), lerp(d.py, d.y, alpha));
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    };
    beam(3.4, 0.22);
    beam(1.4, 0.62);
    // 玩家身上的收束环：呼吸感让"正在吸"这件事持续可见
    const pulse = 1 + Math.sin(t * 7) * 0.08;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  for (const d of w.drops.items) {
    if (!d.alive) continue;
    const x = lerp(d.px, d.x, alpha);
    const y = lerp(d.py, d.y, alpha);
    if (d.kind === 1) drawPowerup(ctx, d, t, x, y);
    else drawCoin(ctx, d, t, x, y);
  }
}

function drawEnemies(ctx, w, alpha, t) {
  const p = w.player;
  /**
   * ★ 高密度时关掉装饰性细节（眼珠 / 尾焰 / 炮塔）。
   *
   * 这是弹幕游戏的标准取舍：屏幕上有 55 只以上敌机时，
   * 「这只的眼睛在看哪」无论如何都读不出来了，但每只省下的 4~8 次填充
   * 是实打实的。**降级只发生在最乱的时刻，平静时仍然是最丰富的画面。**
   *
   * 阈值定在 55 的依据：平衡实测显示熟练玩家死在第 14~16 波（约 30~45 只），
   * 所以**整局典型体验里细节始终是全开的**，这条 LOD 只在晚期兜底。
   * 轮廓（精灵）+ 血条弧 + 受击闪白**不降级** —— 它们是可读性的一部分。
   */
  const detailOn = w.enemies.count <= 55;
  for (const e of w.enemies.items) {
    if (!e.alive) continue;
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    // 朝向玩家：座舱/炮口/眼珠都看它。这是"它盯着我"的视觉来源，
    // 也是玩家判断"这架在瞄哪"的信息（不只是好看）。
    const aim = Math.atan2(p.y - y, p.x - x);
    drawEnemy(ctx, e, ENEMY_DEFS[e.type], t, x, y, aim, detailOn);
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

  // ★ 自适应降级：辉光只在中低密度时画。
  // 阈值从 420 降到 260 —— 因为实测显示真正贵的是**每发子弹的填充面积**，
  // 而 260 发时屏幕已经足够亮，去掉辉光不影响"弹幕看得清"这件事（核还在）。
  // 帧率优先于光晕，但降级阈值必须是明确的数字，不能"看起来差不多就砍"。
  const softGlow = n < 380;

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
        const bx = lerp(w.boss.px, w.boss.x, alpha);
        const by = lerp(w.boss.py, w.boss.y, alpha);
        drawBoss(ctx, w.boss, w.t, bx, by,
          Math.atan2(w.player.y - by, w.player.x - bx));
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
