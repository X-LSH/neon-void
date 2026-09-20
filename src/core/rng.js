/**
 * 确定性 PRNG（mulberry32）。
 *
 * 全项目禁用 Math.random() —— 弹幕形态、粒子飞散、掉落判定全部走这里。
 * 理由是「同一份输入序列必须逐位重放出同一局」：这是 verify.mjs 能做
 * 确定性断言、balance.mjs 能复现难度曲线的前提。
 *
 * 副作用（可接受）：同一颗种子的开局弹幕完全一致。所以每局开局用
 * Date.now() 取种子，确定性只在「单局之内」成立。
 */

export function createRng(seed = 1) {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;

  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** [min, max) 区间浮点 */
    range: (min, max) => min + next() * (max - min),
    /** [min, max] 闭区间整数 */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** 以概率 p 返回 true */
    chance: (p) => next() < p,
    /** 数组随机取一（确定性） */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** 对称抖动 ±amount */
    jitter: (amount) => (next() * 2 - 1) * amount,
    /** 当前内部状态（用于断言与快照） */
    state: () => s,
  };
}
