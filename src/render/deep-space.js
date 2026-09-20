/**
 * 深空远景：星云 → 巨型结构 → 三层视差星点。
 *
 * 从 background.js 拆出来的理由：单文件 300 行是硬约束（由 verify.mjs 看守），
 * 而「背景要有纵深层次」这次新增了星云与巨型结构两层。
 *
 * 三条规则：
 *   1. **重的东西预渲染到离屏图层**。星云是 7 个径向渐变 ——
 *      逐帧生成就是每秒 420 次 createRadialGradient。
 *      霓虹光带的逐帧渐变就是上一轮的真实教训，不要再犯一次。
 *   2. **每一层要有不同的亮度/速度/颜色**，眼睛才能读出"深"。
 *      同一种星点铺满整个屏幕就是"单调"的定义。
 *   3. **全都在低 alpha 区间**，背景永远不许抢弹幕的可读性。
 */

import { PAL } from './palette.js';
import { FIELD_W, FIELD_H } from '../game/config.js';

/** 星点 / 结构的活动范围：比游戏区大一圈，保证宽屏高屏两侧都填得满 */
const BOX = { x0: -700, x1: FIELD_W + 700, y0: -480, y1: FIELD_H + 480 };
/** 星云图层的活动边距（用于缓慢漂移，不需要平铺） */
const DRIFT = 130;
const TAU = Math.PI * 2;

/** 离屏画布工厂：优先 OffscreenCanvas（不占 DOM），退化到普通 canvas */
function createLayer(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 局部确定性 PRNG：避免与游戏随机流互相干扰，也保证重建时样子不变 */
function mulberry(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + next() * (b - a) };
}

/**
 * 天空层：不透明纵向渐变 + 星云斑块，**烘焙成同一张不透明位图**。
 *
 * 为什么必须烘焙（这一条是实测倒逼的）：
 *   分开做时每帧要跑「1.3M 像素的不透明渐变填充 + 1.3M 像素的 alpha 混合星云」，
 *   合计约 3.4M 像素 —— 而屏幕上全部敌机精灵加起来才 0.3M。
 *   背景才是真凶。
 *   烘焙后只剩一次**不透明拷贝**（比 alpha 混合便宜得多）。
 */
function paintNebula(canvas, rng) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, PAL.void);
  sky.addColorStop(0.42, PAL.bgMid);
  sky.addColorStop(1, PAL.deep);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // 星云用 lighter 堆在底色上：它是"发光云"，不是"盖上去的色块"
  g.globalCompositeOperation = 'lighter';
  const tints = [PAL.nebulaA, PAL.nebulaB, PAL.nebulaC];
  const span = Math.max(w, h);
  for (let i = 0; i < 7; i++) {
    const cx = rng.range(-0.08, 1.08) * w;
    const cy = rng.range(-0.08, 1.08) * h;
    const r = rng.range(0.24, 0.54) * span;
    const tint = tints[i % tints.length];
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, tint);
    grad.addColorStop(0.4, tint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = rng.range(0.1, 0.2);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/** 远景巨型结构：明确处于"很远"的层次，慢速下移 + 自转 */
function structurePath(ctx, kind, s, rot) {
  if (kind === 0) {
    // 环站：双环 + 辐条
    ctx.arc(0, 0, s, 0, TAU);
    ctx.moveTo(s * 1.3, 0);
    ctx.arc(0, 0, s * 1.3, 0, TAU);
    for (let i = 0; i < 6; i++) {
      const a = rot + (TAU * i) / 6;
      ctx.moveTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.lineTo(Math.cos(a) * s * 1.3, Math.sin(a) * s * 1.3);
    }
  } else if (kind === 1) {
    // 尖塔：细长四边 + 横向支撑
    ctx.moveTo(0, -s * 1.7);
    ctx.lineTo(s * 0.4, s * 1.2);
    ctx.lineTo(-s * 0.4, s * 1.2);
    ctx.closePath();
    for (const y of [-s * 0.7, 0, s * 0.7]) {
      const half = s * 0.34 * (1 - y / (s * 2.4));
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
    }
  } else {
    // 残骸：翻滚的拉长多边形 + 两块外伸面板
    ctx.moveTo(-s * 1.5, -s * 0.36);
    ctx.lineTo(s * 0.9, -s * 0.62);
    ctx.lineTo(s * 1.4, s * 0.18);
    ctx.lineTo(-s * 0.5, s * 0.56);
    ctx.closePath();
    ctx.moveTo(-s * 1.1, -s * 0.5);
    ctx.lineTo(-s * 1.9, s * 0.1);
    ctx.moveTo(s * 0.5, -s * 0.6);
    ctx.lineTo(s * 1.1, -s * 1.2);
  }
}

export function createDeepSpace(seedRng) {
  const spec = [
    { n: 104, speed: 22, size: 1.0, alpha: 0.5, colors: [PAL.starFar, PAL.starFar, PAL.starWarm] },
    { n: 56, speed: 54, size: 1.6, alpha: 0.72, colors: [PAL.starMid, PAL.starMid, PAL.starFar] },
    { n: 26, speed: 98, size: 2.4, alpha: 0.95, colors: [PAL.starNear, PAL.starNear, PAL.starWarm] },
  ];

  const layers = [];
  for (const s of spec) {
    const xs = new Float32Array(s.n);
    const ys = new Float32Array(s.n);
    const tw = new Float32Array(s.n);
    const tint = new Uint8Array(s.n);
    const flare = new Uint8Array(s.n);
    for (let i = 0; i < s.n; i++) {
      xs[i] = seedRng.range(BOX.x0, BOX.x1);
      ys[i] = seedRng.range(BOX.y0, BOX.y1);
      tw[i] = seedRng.range(0, TAU);
      tint[i] = seedRng.int(0, s.colors.length - 1);
      flare[i] = seedRng.chance(0.12) ? 1 : 0;
    }
    layers.push({ ...s, xs, ys, tw, tint, flare });
  }

  const structures = [];
  for (let i = 0; i < 4; i++) {
    structures.push({
      kind: i % 3,
      x: seedRng.range(-180, FIELD_W + 180),
      y: seedRng.range(BOX.y0, BOX.y1),
      s: seedRng.range(58, 132),
      speed: seedRng.range(9, 22),
      rot: seedRng.range(0, TAU),
      rotSpeed: seedRng.range(-0.13, 0.13),
      alpha: seedRng.range(0.07, 0.14),
    });
  }

  const spanY = BOX.y1 - BOX.y0;
  let neb = null;
  let nebKey = '';

  /** 星云图层：只在可见区域尺寸变化时重建（resize 才发生，不是每帧） */
  function nebula(rect) {
    const w = Math.ceil(rect.x1 - rect.x0) + DRIFT * 2;
    const h = Math.ceil(rect.y1 - rect.y0) + DRIFT * 2;
    const key = `${w}x${h}`;
    if (neb && nebKey === key) return neb;
    const cv = createLayer(w, h);
    paintNebula(cv, mulberry(0x51ed270b ^ (w * 31 + h)));
    neb = cv;
    nebKey = key;
    return neb;
  }

  return {
    spanY,
    BOX,

    /** 天空层：一次不透明 blit（不含混合），带极缓慢漂移 */
    drawSky(ctx, rect, t) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(nebula(rect),
        rect.x0 - DRIFT + Math.sin(t * 0.037) * DRIFT,
        rect.y0 - DRIFT + Math.cos(t * 0.029) * DRIFT);
    },

    drawStructures(ctx, rect, t) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = PAL.structure;
      for (const st of structures) {
        let y = st.y + t * st.speed;
        y = BOX.y0 + (((y - BOX.y0) % spanY) + spanY) % spanY;
        if (y < rect.y0 - 240 || y > rect.y1 + 240) continue;
        if (st.x < rect.x0 - 240 || st.x > rect.x1 + 240) continue;
        ctx.globalAlpha = st.alpha;
        ctx.beginPath();
        structurePath(ctx, st.kind, st.s, st.rot + t * st.rotSpeed);
        ctx.stroke();
      }
    },

    drawStars(ctx, rect, t) {
      for (const L of layers) {
        const scroll = t * L.speed;
        for (let i = 0; i < L.n; i++) {
          let y = L.ys[i] + scroll;
          y = BOX.y0 + (((y - BOX.y0) % spanY) + spanY) % spanY;
          if (y < rect.y0 - 4 || y > rect.y1 + 4) continue;
          const x = L.xs[i];
          if (x < rect.x0 - 4 || x > rect.x1 + 4) continue;
          const tw = 0.72 + 0.28 * Math.sin(t * 2.2 + L.tw[i]);
          const col = L.colors[L.tint[i]];
          const s = L.size * tw;
          ctx.globalAlpha = L.alpha * tw;
          ctx.fillStyle = col;
          ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
          // 耀斑（十字星芒）：只给近景层、只在最亮时出现。多了就不是"星"而是"噪点"
          if (L.flare[i] && L.size > 1.4 && tw > 0.86) {
            ctx.globalAlpha = L.alpha * (tw - 0.86) * 3.4;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - s * 3.4, y);
            ctx.lineTo(x + s * 3.4, y);
            ctx.moveTo(x, y - s * 3.4);
            ctx.lineTo(x, y + s * 3.4);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
