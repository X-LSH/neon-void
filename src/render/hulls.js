/**
 * 五种敌机的机身轮廓。纯几何，零依赖。
 *
 * 单独成文件的两个理由：
 *   1. 单文件 300 行是硬约束（verify.mjs 看守），而轮廓占了大头；
 *   2. 轮廓是**要进精灵缓存的静态数据**，与"怎么画细节"是两件事，
 *      分开放才不会有人往这里加随时间变化的东西（那会让精灵缓存失效）。
 *
 * 约定：全部以 (0,0) 为中心，机头朝 **+y**（敌机向下飞）。
 * 玩家要能凭轮廓在 0.2 秒内判断"这是什么、危不危险" —— 这是射击游戏的命门，
 * 所以五型的剪影刻意做得互不相似：后掠三角 / 双炮舱菱形 / 圆盘 / 六边装甲 / 六角星。
 */

const TAU = Math.PI * 2;

/** 侦察机：轻型后掠截击机，最薄最快 */
export function hullScout(ctx, r) {
  ctx.moveTo(0, r * 1.15);
  ctx.lineTo(r * 0.42, r * 0.15);
  ctx.lineTo(r * 1.0, -r * 0.3);
  ctx.lineTo(r * 0.86, -r * 0.62);
  ctx.lineTo(r * 0.3, -r * 0.48);
  ctx.lineTo(0, -r * 0.9);
  ctx.lineTo(-r * 0.3, -r * 0.48);
  ctx.lineTo(-r * 0.86, -r * 0.62);
  ctx.lineTo(-r * 1.0, -r * 0.3);
  ctx.lineTo(-r * 0.42, r * 0.15);
  ctx.closePath();
}

/** 突击机：菱形机身 + 侧挂炮舱，比侦察机宽、更能打 */
export function hullStriker(ctx, r) {
  ctx.moveTo(0, r * 1.2);
  ctx.lineTo(r * 0.46, r * 0.12);
  ctx.lineTo(r * 0.5, -r * 0.3);
  ctx.lineTo(r * 1.06, -r * 0.5);
  ctx.lineTo(r * 1.06, -r * 0.96);
  ctx.lineTo(r * 0.4, -r * 0.78);
  ctx.lineTo(0, -r * 1.06);
  ctx.lineTo(-r * 0.4, -r * 0.78);
  ctx.lineTo(-r * 1.06, -r * 0.96);
  ctx.lineTo(-r * 1.06, -r * 0.5);
  ctx.lineTo(-r * 0.5, -r * 0.3);
  ctx.lineTo(-r * 0.46, r * 0.12);
  ctx.closePath();
}

/** 追踪者：圆盘。它不靠速度，靠"盯着你" */
export function hullSeeker(ctx, r) {
  ctx.ellipse(0, 0, r * 1.12, r * 0.74, 0, 0, TAU);
}

/** 坦克：六边装甲，最厚最慢 */
export function hullTank(ctx, r) {
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (TAU * i) / 6;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 精英：六角星，剪影最"扎手"，一眼就知道它不一样 */
export function hullElite(ctx, r) {
  for (let i = 0; i < 12; i++) {
    const rr = i % 2 === 0 ? r * 1.12 : r * 0.5;
    const a = (Math.PI * i) / 6;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export const HULLS = {
  scout: hullScout,
  striker: hullStriker,
  seeker: hullSeeker,
  tank: hullTank,
  elite: hullElite,
};
