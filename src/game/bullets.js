/**
 * 子弹场：SoA（Structure of Arrays）+ 空闲索引栈。
 *
 * 为什么不用对象数组：热路径每帧要遍历数百发子弹，
 * 对象数组会持续产生垃圾（V8 里一个小对象 40+ 字节），GC 抖动是低端设备掉帧的头号杀手。
 *
 * 行不通时的行为：**容量满 → 直接丢弃新子弹**，绝不扩容。
 * 宁可少一发子弹，也不要一次容量泄漏带来的永久性帧率下跌。
 */

import { FIELD_W, FIELD_H } from './config.js';

/** 出屏边距：留出余量，避免「在屏幕边缘可见处被回收」 */
const MARGIN_X = 70;
const MARGIN_Y = 80;

export const KIND = { PLAYER: 0, ENEMY: 1, HEAVY: 2 };

export function createBulletField(cap) {
  const x = new Float32Array(cap);
  const y = new Float32Array(cap);
  const px = new Float32Array(cap);
  const py = new Float32Array(cap);
  const vx = new Float32Array(cap);
  const vy = new Float32Array(cap);
  const rad = new Float32Array(cap);
  const life = new Float32Array(cap);
  const kind = new Uint8Array(cap);
  const alive = new Uint8Array(cap);

  const free = new Int32Array(cap);
  let freeTop = cap;
  for (let i = 0; i < cap; i++) free[i] = cap - 1 - i;

  let count = 0;

  const field = {
    cap,
    x, y, px, py, vx, vy, rad, life, kind, alive,

    get count() { return count; },
    get full() { return freeTop === 0; },

    /** 返回是否成功（容量满时为 false —— 调用方不需要为此做任何事） */
    spawn(x0, y0, velX, velY, r, lifeSec, k) {
      if (freeTop === 0) return false;
      const i = free[--freeTop];
      x[i] = x0;
      y[i] = y0;
      px[i] = x0;
      py[i] = y0;
      vx[i] = velX;
      vy[i] = velY;
      rad[i] = r;
      life[i] = lifeSec;
      kind[i] = k;
      alive[i] = 1;
      count += 1;
      return true;
    },

    kill(i) {
      if (!alive[i]) return;
      alive[i] = 0;
      free[freeTop++] = i;
      count -= 1;
    },

    step(dt) {
      for (let i = 0; i < cap; i++) {
        if (!alive[i]) continue;
        px[i] = x[i];
        py[i] = y[i];
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        life[i] -= dt;
        if (
          life[i] <= 0 ||
          x[i] < -MARGIN_X || x[i] > FIELD_W + MARGIN_X ||
          y[i] < -MARGIN_Y || y[i] > FIELD_H + MARGIN_Y
        ) {
          field.kill(i);
        }
      }
    },

    clear() {
      for (let i = 0; i < cap; i++) {
        if (alive[i]) {
          alive[i] = 0;
          free[freeTop++] = i;
        }
      }
      count = 0;
    },

    /** 只回收敌方子弹（炸弹道具用；玩家子弹要留下） */
    clearEnemy() {
      let n = 0;
      for (let i = 0; i < cap; i++) {
        if (alive[i] && kind[i] !== KIND.PLAYER) {
          field.kill(i);
          n += 1;
        }
      }
      return n;
    },

    /** 便捷读取（会创建对象，只用于自检与非热路径） */
    pick(i) {
      return {
        x: x[i], y: y[i], px: px[i], py: py[i],
        vx: vx[i], vy: vy[i], r: rad[i],
        life: life[i], kind: kind[i], alive: alive[i],
      };
    },

    /** 自检用：空闲栈与存活计数必须自洽（不该出现脏数据） */
    audit() {
      let live = 0;
      for (let i = 0; i < cap; i++) if (alive[i]) live += 1;
      return { live, count, freeTop, expectedFree: cap - live, consistent: live === count && freeTop === cap - live };
    },
  };

  return field;
}
