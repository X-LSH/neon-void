/**
 * 伪辉光：同一形状描 N 遍。
 *
 * **禁止 `ctx.shadowBlur` 进渲染循环** —— 它是 Canvas 2D 里最贵的一个参数。
 * 替代方案的成本只剩 N 次 stroke，而这个游戏里每帧要做上千次。
 *
 * 层级分配（SPEC §9）：普通元素 3 层，**只有玩家与 Boss 允许 4 层** ——
 * 到处发光等于没有焦点。
 */

const TAU = Math.PI * 2;

/** 线宽分层：外晕（粗、极淡）→ 中晕 → 核心（细、实色） */
export const STROKE_3 = [
  { w: 5.5, a: 0.13 },
  { w: 2.8, a: 0.3 },
  { w: 1.15, a: 1 },
];

/**
 * 小型敌机（r < 13）用两层就够了。
 * 它们的视觉面积只有坦克的 1/5，第三层外晕几乎看不见，
 * 但**每次 stroke 的成本是一样的** —— 45 只小飞机各多描一遍，就是白花的钱。
 */
export const STROKE_2 = [
  { w: 5.5, a: 0.16 },
  { w: 1.2, a: 1 },
];

export const STROKE_4 = [
  { w: 13, a: 0.08 },
  { w: 7.5, a: 0.14 },
  { w: 3.4, a: 0.32 },
  { w: 1.4, a: 1 },
];

/** 半径分层：按半径倍数放大 */
export const CIRCLE_3 = [
  { m: 2.4, a: 0.09 },
  { m: 1.55, a: 0.2 },
  { m: 1.0, a: 1 },
];

export const CIRCLE_4 = [
  { m: 3.6, a: 0.06 },
  { m: 2.4, a: 0.1 },
  { m: 1.55, a: 0.22 },
  { m: 1.0, a: 1 },
];

/** 描边辉光。build 只被调用一次 —— Canvas 的当前路径可以重复 stroke。 */
export function strokeGlow(ctx, build, color, layers = STROKE_3) {
  /**
   * ★ 接合用 miter 而不是 round。
   * 两个理由，成本和观感一致：
   *   1. 厚描边（外晕 5.5~13 单位）配圆角接合，每个拐点都要生成一段圆弧几何，
   *      是 Canvas 2D 里最贵的描边组合之一。敌机形体从 3~5 个顶点涨到 10~12 个之后，
   *      这笔开销被放大了三倍。
   *   2. 几何机体本来就是**有棱角**的，圆角接合反而把锐角磨圆了。
   * miterLimit=2 是为了把过锐的角自动削成斜切，避免长出长尖刺。
   */
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.beginPath();
  build(ctx);
  const prev = ctx.globalAlpha;
  for (let i = 0; i < layers.length; i++) {
    ctx.globalAlpha = prev * layers[i].a;
    ctx.lineWidth = layers[i].w;
    ctx.stroke();
  }
  ctx.globalAlpha = prev;
}

/** 实心圆辉光（子弹 / 粒子 / 内核点） */
export function fillCircleGlow(ctx, x, y, r, color, layers = CIRCLE_3) {
  ctx.fillStyle = color;
  const prev = ctx.globalAlpha;
  for (let i = 0; i < layers.length; i++) {
    ctx.globalAlpha = prev * layers[i].a;
    ctx.beginPath();
    ctx.arc(x, y, r * layers[i].m, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = prev;
}

/** 不描边、直接填充的辉光路径（用于几何体本体） */
export function fillPath(ctx, build, color, alpha = 1) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  build(ctx);
  ctx.fill();
  ctx.globalAlpha = prev;
}

/** 正多边形路径（外接圆半径 r，旋转 rot） */
export function polygon(ctx, r, sides, rot = 0) {
  for (let i = 0; i < sides; i++) {
    const a = rot + (TAU * i) / sides;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 星形（外/内半径交替） */
export function starPath(ctx, outer, inner, points, rot = 0) {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (Math.PI * i) / points;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export { TAU };
