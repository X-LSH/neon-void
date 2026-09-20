/**
 * 碰撞检测。全部是扫掠（线段）检测，不用离散点检测。
 *
 * 为什么必须扫掠（见 SPEC §1.1）：60Hz 下玩家子弹 760 u/s 每步走 12.7 单位，
 * 而「子弹半径 3.2 + 最小敌机半径 11」= 14.2 —— 离散点检测会在临界处漏判。
 * 扫掠的代价是 O(1)，而把步长加倍是全域 2 倍成本。
 */

/** 线段 (x0,y0)→(x1,y1) 上是否有点落在圆 (cx,cy,r) 内 */
export function segCircle(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((cx - x0) * dx + (cy - y0) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const ex = x0 + dx * t - cx;
  const ey = y0 + dy * t - cy;
  return ex * ex + ey * ey <= r * r;
}

/** 圆–圆（用于道具拾取与「敌机撞玩家」这类不高速的相对运动） */
export function circleHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

/**
 * 玩家判定半径与视觉体积的关系必须成立（SPEC §8）：
 * 判定圆不得大于视觉外接圆，否则会出现「看起来没碰到却受伤」。
 * 这条在 verify.mjs 里被断言。
 */
export function visualRadius(bodyW, bodyH) {
  return Math.hypot(bodyW, bodyH) / 2;
}
