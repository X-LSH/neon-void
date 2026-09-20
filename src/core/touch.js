/**
 * 触屏拖拽几何 —— 全部是纯函数，可在 Node 逐条断言。
 *
 * 为什么抽出来：手指落点、纵向偏移、边缘裁剪这些东西在真机上要靠
 * 「恰好停在边界」才复现，属于偶发、难拍、说不清的 bug。抽成纯函数后
 * 可以逐条断言四角可达、边缘不越界、偏移量恒定。
 *
 * 见 SPEC §3.1：用绝对定位 + 纵向偏移，不用摇杆。
 */

/**
 * 飞船浮在手指上方，避免被拇指完全盖住。
 * 单位是逻辑游戏区单位（游戏区高 720）。
 */
export const TOUCH_OFFSET_Y = -38;

/** 把触屏坐标换算成飞船目标位置，并裁进游戏区（考虑飞船判定半径） */
export function applyTouch(fx, fy, fieldW, fieldH, radius) {
  const m = radius + 2;
  return {
    x: clamp(fx, m, fieldW - m),
    y: clamp(fy + TOUCH_OFFSET_Y, m, fieldH - m),
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** CSS 客户端坐标 → 游戏区坐标。vp 为 viewport 的描述对象。 */
export function clientToField(clientX, clientY, rect, vp) {
  return {
    x: (clientX - rect.left - vp.ox) / vp.scale,
    y: (clientY - rect.top - vp.oy) / vp.scale,
  };
}

/** 点是否落在游戏区内（决定这次触摸该不该接管飞船） */
export function insideField(x, y, fieldW, fieldH, pad = 0) {
  return x >= -pad && x <= fieldW + pad && y >= -pad && y <= fieldH + pad;
}

/**
 * 一维指数逼近（键盘方向 → 速度用）。
 * 用 exp 而不是固定系数，保证不同帧率下的观感一致。
 */
export function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
