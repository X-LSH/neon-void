/**
 * 敌机精灵缓存。
 *
 * 为什么需要它：新造型把每只敌机的机身从「3~5 顶点 + 3 层辉光」
 * 变成「10~12 顶点 + 2~3 层辉光」，而这是**唯一随敌机数量线性增长**的开销。
 * 45 只敌机 = 每帧 ~200 次路径描边。实测就是它把 fps 从 60 拉到 37。
 *
 * 机身是**静态的**（不随血量/受击/时间变化），所以完全可以预渲染成一张位图，
 * 每帧只做一次 blit。会动的部件（眼珠朝向、尾焰、受击闪白、焦痕）留在外面现画 ——
 * 这样既拿回性能，又不牺牲"活物感"。
 *
 * 超采样 2×：精灵要在 field transform 里再被 scale 放大（最高 ~1.5×），
 * 1× 的源图放大后边缘会糊。2× 只多 4 倍显存（几十 KB），但边缘是干净的。
 *
 * 与 enemies-art.js 的关系：这里**不认识**任何机体形状 —— 形状由调用方通过
 * `draw(ctx, r)` 回调传进来。这样就不会出现「精灵模块 import 形状模块、
 * 形状模块 import 精灵模块」的循环依赖。
 */

/** 外晕余量（世界单位）：外晕线宽 / 2 + 一点安全边 */
const PAD = 10;
const SUPERSAMPLE = 2;

function makeLayer(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createSpriteCache() {
  const cache = new Map();
  let created = 0;

  return {
    /**
     * @param key  唯一标识（类型 + 颜色 + 半径）
     * @param r    机体半径（世界单位）
     * @param draw (g, r) => void，在**局部坐标原点**绘制机体
     * @returns { cv, box } —— box 是世界单位下的边长，blit 时用 -box/2 定位
     */
    get(key, r, draw) {
      const hit = cache.get(key);
      if (hit) return hit;
      const box = (r + PAD) * 2;
      const px = Math.ceil(box * SUPERSAMPLE);
      const cv = makeLayer(px, px);
      const g = cv.getContext('2d');
      g.scale(SUPERSAMPLE, SUPERSAMPLE);
      g.translate(box / 2, box / 2);
      draw(g, r);
      const entry = { cv, box };
      cache.set(key, entry);
      created += 1;
      return entry;
    },
    /** 预热：把首帧的一次性开销挪到加载时，避免"刚进游戏第一帧卡一下" */
    size: () => cache.size,
    stats: () => ({ created, cached: cache.size }),
  };
}
