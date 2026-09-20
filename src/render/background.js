/**
 * 背景合成：底色 → 深空远景（星云/巨构/星点）→ 透视网格 → 霓虹光带。
 *
 * 深空那三层在 `deep-space.js`（拆开是为了守住单文件 300 行的硬约束）。
 *
 * 剩下两条关键点：
 *   · **一切渐变都要缓存**。霓虹光带曾经每帧 createLinearGradient，
 *     那是每秒 120 次对象创建 + 上传 —— 单看不致命，但它是
 *     「稳定发生在 60fps 上」的成本，正是"卡顿"最爱藏的地方。
 *   · 透视用真投影公式 `y = HORIZON + (H − HORIZON) / d`，
 *     竖线全部收敛到消失点 (CX, HORIZON)。手写"近似透视"会在滚动时露馅。
 */

import { PAL } from './palette.js';
import { FIELD_W, FIELD_H } from '../game/config.js';
import { createDeepSpace } from './deep-space.js';

const HORIZON = -52;
const CX = FIELD_W / 2;
const DEPTH_STEP = 0.42;
const COL_SPACING = 46;
const GRID_ROWS = 30;
/**
 * 战场之外保留的背景余量（游戏区坐标单位）。
 *
 * ★ 背景只需要在**看得见的地方**漂亮。1440×900 的屏幕上，480×720 的战场
 *   只占宽度的 42%，剩下 58% 的留边如果也铺满星空 + 星云 + 网格，
 *   每帧要多混合 ~70 万像素 —— 而那些像素最后会被压暗成"画框"。
 *   所以：留边填平色，背景只画战场及其外扩一小圈。
 */
const OUTER_MARGIN = 90;
/** 框内侧渐隐的渐变缓存（按 ctx 分），避免每帧重建 */
const frameGrads = new Map();

export function createBackground(seedRng) {
  const deep = createDeepSpace(seedRng);

  // 霓虹光带：固定两条，交替出现（随机生成会让画面忽明忽暗）
  const bands = [
    { w: 1.0, phase: 0, speed: 118, alpha: 0.16 },
    { w: 0.6, phase: 1.7, speed: 74, alpha: 0.11 },
  ];

  const bandGrads = new Map();

  function bandGradient(ctx, b) {
    const key = `${b.w}|${b.alpha}`;
    const hit = bandGrads.get(key);
    if (hit && hit.ctx === ctx) return hit.grad;
    const g = ctx.createLinearGradient(0, -26 * b.w, 0, 26 * b.w);
    g.addColorStop(0, 'rgba(0,255,245,0)');
    g.addColorStop(0.5, `rgba(0,255,245,${b.alpha})`);
    g.addColorStop(1, 'rgba(0,255,245,0)');
    bandGrads.set(key, { ctx, grad: g });
    return g;
  }

  return {
    /** rect = 可见的游戏区坐标范围（由 viewport 反算） */
    draw(ctx, rect, t) {
      // ── 整屏先铺平色（留边最终是画框，不需要星空）──────────
      ctx.fillStyle = PAL.void;
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);

      // 背景只画战场 + 外扩一圈
      const clip = {
        x0: Math.max(rect.x0, -OUTER_MARGIN),
        y0: Math.max(rect.y0, -OUTER_MARGIN),
        x1: Math.min(rect.x1, FIELD_W + OUTER_MARGIN),
        y1: Math.min(rect.y1, FIELD_H + OUTER_MARGIN),
      };
      if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0) return;
      const rw = clip.x1 - clip.x0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x0, clip.y0, rw, clip.y1 - clip.y0);
      ctx.clip();

      // ── 天空 + 星云（烘焙成一层，一次不透明 blit）───────────
      deep.drawSky(ctx, clip, t);
      // ── 远景巨型结构与近景星点 ──────────────────────────────
      deep.drawStructures(ctx, clip, t);

      // ── 透视网格 ────────────────────────────────────────────
      // 横线：沿深度滚动。地平线聚集光是 synthwave 的签名 —— 越远越亮越密。
      const phase = (t * 0.55) % 1;
      ctx.lineWidth = 1;
      for (let k = 0; k <= GRID_ROWS; k++) {
        const d = (k - phase) * DEPTH_STEP;
        if (d < 0.17) continue;
        const y = HORIZON + (FIELD_H - HORIZON) / d;
        if (y < clip.y0 - 4 || y > clip.y1 + 4) continue;
        const near = Math.min(1, Math.max(0, (y - HORIZON) / (FIELD_H - HORIZON)));
        ctx.globalAlpha = 0.07 + (1 - near) * 0.3;
        ctx.strokeStyle = near < 0.3 ? PAL.gridHot : PAL.grid;
        ctx.beginPath();
        ctx.moveTo(clip.x0, y);
        ctx.lineTo(clip.x1, y);
        ctx.stroke();
      }

      // 竖线：从底部向消失点收敛。一次 path 画完全部 —— 逐条 stroke 是白花的开销。
      const cols = Math.ceil(rw / COL_SPACING) + 4;
      const startI = Math.floor(-cols / 2);
      ctx.strokeStyle = PAL.grid;
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      for (let i = startI; i <= startI + cols; i++) {
        const xb = CX + i * COL_SPACING;
        if (xb < clip.x0 - 80 || xb > clip.x1 + 80) continue;
        ctx.moveTo(xb, Math.max(FIELD_H, clip.y1));
        ctx.lineTo(CX, HORIZON);
      }
      ctx.stroke();

      // ── 霓虹光带 ────────────────────────────────────────────
      for (const b of bands) {
        const y = HORIZON + ((t * b.speed + b.phase * 900) % (deep.spanY + 900)) - 200;
        if (y < clip.y0 - 40 || y > clip.y1 + 40) continue;
        ctx.save();
        ctx.translate(0, y);
        ctx.fillStyle = bandGradient(ctx, b);
        ctx.fillRect(clip.x0, -26 * b.w, rw, 52 * b.w);
        ctx.restore();
      }

      // ── 星点（最前景的背景层，画在网格之上）─────────────────
      deep.drawStars(ctx, clip, t);

      ctx.restore();
    },
  };
}

/**
 * 游戏区边框。
 *
 * 留边在 draw() 里已经是平色了，所以这里**不再需要 4 次半透明压暗** ——
 * 那是每帧 ~76 万像素的混合，只为了让"已经画好的星空"变暗；
 * 直接从源头不画星空更便宜也更干净。
 * 现在只画一圈发丝边框 + 一道内侧渐隐（制造"框住战场"的收束感）。
 */
export function drawFieldFrame(ctx, rect) {
  // 内侧渐隐：只画战场内一圈很窄的边。**渐变必须缓存** ——
  // 每帧 createLinearGradient 正是本项目反复踩到的反模式（光带、星云都栽过）。
  let g = frameGrads.get(ctx);
  if (!g) {
    const top = ctx.createLinearGradient(0, 0, 0, 26);
    top.addColorStop(0, 'rgba(5,6,12,0.55)');
    top.addColorStop(1, 'rgba(5,6,12,0)');
    const bot = ctx.createLinearGradient(0, FIELD_H, 0, FIELD_H - 26);
    bot.addColorStop(0, 'rgba(5,6,12,0.55)');
    bot.addColorStop(1, 'rgba(5,6,12,0)');
    g = { top, bot };
    frameGrads.set(ctx, g);
  }
  ctx.fillStyle = g.top;
  ctx.fillRect(0, 0, FIELD_W, 26);
  ctx.fillStyle = g.bot;
  ctx.fillRect(0, FIELD_H - 26, FIELD_W, 26);

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PAL.player;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0, 0, FIELD_W, FIELD_H);
  ctx.globalAlpha = 1;
}
