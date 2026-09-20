/**
 * 背景：三层视差星点 + 透视网格 + 偶发霓虹光带。
 *
 * 关键点（SPEC §9）：
 *   · 网格用**预计算的段列表**，不逐帧生成坐标 —— 每帧 `Math.cos` 几十次
 *     看起来不多，但它是恒定发生在 60fps 上的成本。
 *   · 背景铺满**整个视口**（不止游戏区），游戏区外由 scene 加暗。
 *     画布只有 2:3 的时候，两侧留白如果纯黑会像「页面没加载完」。
 *   · 透视用真投影公式：`y = HORIZON + (H − HORIZON) / d`，
 *     竖线全部收敛到消失点 (CX, HORIZON)。手写「近似透视」会在平移时露馅。
 */

import { PAL } from './palette.js';
import { FIELD_W, FIELD_H } from '../game/config.js';

const HORIZON = -52;
const CX = FIELD_W / 2;
const DEPTH_STEP = 0.42;
const COL_SPACING = 46;
const GRID_ROWS = 30;

export function createBackground(seedRng) {
  // 星点覆盖范围比游戏区大一圈，保证宽屏/高屏两侧都填得满
  const BOX = { x0: -620, x1: FIELD_W + 620, y0: -460, y1: FIELD_H + 460 };
  const layers = [];

  const spec = [
    { n: 96, speed: 20, size: 1.0, color: PAL.starFar, alpha: 0.5 },
    { n: 52, speed: 52, size: 1.6, color: PAL.starMid, alpha: 0.72 },
    { n: 26, speed: 96, size: 2.4, color: PAL.starNear, alpha: 0.95 },
  ];

  for (const s of spec) {
    const xs = new Float32Array(s.n);
    const ys = new Float32Array(s.n);
    const tw = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      xs[i] = seedRng.range(BOX.x0, BOX.x1);
      ys[i] = seedRng.range(BOX.y0, BOX.y1);
      tw[i] = seedRng.range(0, Math.PI * 2);
    }
    layers.push({ ...s, xs, ys, tw });
  }

  // 霓虹光带：固定两条，交替出现，不做随机生成（随机生成会让画面忽明忽暗）
  const bands = [
    { y: 0, w: 1.0, phase: 0, speed: 118, alpha: 0.16 },
    { y: 0, w: 0.6, phase: 1.7, speed: 74, alpha: 0.11 },
  ];

  const spanY = BOX.y1 - BOX.y0;
  let grad = null;
  let gradKey = '';

  function ensureGradient(ctx, rect) {
    const key = `${rect.y0.toFixed(0)}|${rect.y1.toFixed(0)}|${rect.x0.toFixed(0)}|${rect.x1.toFixed(0)}`;
    if (grad && gradKey === key) return grad;
    const g = ctx.createLinearGradient(0, rect.y0, 0, rect.y1);
    g.addColorStop(0, PAL.void);
    g.addColorStop(0.42, PAL.bgMid);
    g.addColorStop(1, PAL.deep);
    grad = g;
    gradKey = key;
    return grad;
  }

  return {
    /** rect 是「可见的游戏区坐标范围」（viewport 反算得来） */
    draw(ctx, rect, t) {
      // ── 底色 ────────────────────────────────────────────────
      ctx.fillStyle = ensureGradient(ctx, rect);
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);

      // ── 透视网格 ────────────────────────────────────────────
      // 横线：沿深度滚动。**地平线聚集光**是 synthwave 的签名 ——
      // 越远越亮越密。曾经把「亮色」判据写成 near > 0.72（屏幕底部），
      // 结果最亮最饱和的颜色落在最不该发光的地方，而真正的地平线一片死黑。
      const phase = (t * 0.55) % 1;
      ctx.lineWidth = 1;
      for (let k = 0; k <= GRID_ROWS; k++) {
        const d = (k - phase) * DEPTH_STEP;
        if (d < 0.17) continue;
        const y = HORIZON + (FIELD_H - HORIZON) / d;
        if (y < rect.y0 - 4 || y > rect.y1 + 4) continue;
        const near = Math.min(1, Math.max(0, (y - HORIZON) / (FIELD_H - HORIZON)));
        ctx.globalAlpha = 0.07 + (1 - near) * 0.3;
        ctx.strokeStyle = near < 0.3 ? PAL.gridHot : PAL.grid;
        ctx.beginPath();
        ctx.moveTo(rect.x0, y);
        ctx.lineTo(rect.x1, y);
        ctx.stroke();
      }

      // 竖线：从底部向消失点收敛（世界里没有「垂直的网格线在滚动」）
      const cols = Math.ceil((rect.x1 - rect.x0) / COL_SPACING) + 4;
      const startI = Math.floor(-cols / 2);
      for (let i = startI; i <= startI + cols; i++) {
        const xb = CX + i * COL_SPACING;
        if (xb < rect.x0 - 80 || xb > rect.x1 + 80) continue;
        ctx.globalAlpha = 0.1;
        ctx.strokeStyle = PAL.grid;
        ctx.beginPath();
        // 从可见范围底部（可低于 FIELD_H）直线收敛到消失点
        const yb = Math.max(FIELD_H, rect.y1);
        ctx.moveTo(xb, yb);
        ctx.lineTo(CX, HORIZON);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ── 霓虹光带 ────────────────────────────────────────────
      for (const b of bands) {
        const y = HORIZON + ((t * b.speed + b.phase * 900) % (spanY + 900)) - 200;
        if (y < rect.y0 - 40 || y > rect.y1 + 40) continue;
        const g = ctx.createLinearGradient(0, y - 26 * b.w, 0, y + 26 * b.w);
        g.addColorStop(0, 'rgba(0,255,245,0)');
        g.addColorStop(0.5, `rgba(0,255,245,${b.alpha})`);
        g.addColorStop(1, 'rgba(0,255,245,0)');
        ctx.fillStyle = g;
        ctx.fillRect(rect.x0, y - 26 * b.w, rect.x1 - rect.x0, 52 * b.w);
      }

      // ── 星点 ────────────────────────────────────────────────
      for (const L of layers) {
        ctx.fillStyle = L.color;
        ctx.globalAlpha = L.alpha;
        const scroll = t * L.speed;
        for (let i = 0; i < L.n; i++) {
          let y = L.ys[i] + scroll;
          // 环回：用取模而不是 if，避免长时间运行后累积漂移
          y = BOX.y0 + (((y - BOX.y0) % spanY) + spanY) % spanY;
          if (y < rect.y0 - 4 || y > rect.y1 + 4) continue;
          const x = L.xs[i];
          if (x < rect.x0 - 4 || x > rect.x1 + 4) continue;
          const tw = 0.72 + 0.28 * Math.sin(t * 2.2 + L.tw[i]);
          const s = L.size * tw;
          ctx.globalAlpha = L.alpha * tw;
          ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

/** 游戏区边框 + 区外压暗。让 960×1440 的画布上，480×720 的战场仍然是唯一焦点。 */
export function drawFieldFrame(ctx, rect) {
  ctx.fillStyle = 'rgba(5,6,12,0.62)';
  if (rect.x0 < 0) ctx.fillRect(rect.x0, rect.y0, -rect.x0, rect.y1 - rect.y0);
  if (rect.x1 > FIELD_W) ctx.fillRect(FIELD_W, rect.y0, rect.x1 - FIELD_W, rect.y1 - rect.y0);
  if (rect.y0 < 0) ctx.fillRect(0, rect.y0, FIELD_W, -rect.y0);
  if (rect.y1 > FIELD_H) ctx.fillRect(0, FIELD_H, FIELD_W, rect.y1 - FIELD_H);

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PAL.player;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0, 0, FIELD_W, FIELD_H);
  ctx.globalAlpha = 1;
}
