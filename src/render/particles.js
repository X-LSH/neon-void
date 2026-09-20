/**
 * 粒子池：TypedArray（SoA）+ 环形覆盖。
 *
 * 两条硬约束（SPEC §9）：
 *   1. **容量固定，溢出时覆盖最旧的**，绝不让池子增长 ——
 *      一次容量泄漏就是永久性的帧率下跌。用环形头指针天然保证这一点。
 *   2. **热路径零对象分配** —— V8 里一个小对象 40+ 字节，
 *      每帧 spawn 20 个就是 48KB/秒的垃圾；GC 抖动是低端设备掉帧的头号杀手，
 *      而且只会间歇性发作、极难定位。
 *
 * 只有 color 存字符串引用（赋值不产生垃圾）。半径上限 MAX_SIZE 防止
 * 单个粒子铺满屏幕 —— 那看起来不像特效，像渲染 bug。
 */

const TAU = Math.PI * 2;

export const KIND = {
  /** fillRect：最便宜的图元，用于绝大多数粒子 */
  SPARK: 0,
  /** 沿速度方向的短线（碎片） */
  SHARD: 1,
  /** 扩散圆环（拾取 / 冲击波），alpha 给足否则深色底上像一块黑影 */
  RING: 2,
  /** 实心圆点（引擎尾焰） */
  DOT: 3,
};

export function createParticles(cap, maxSize = 9) {
  const x = new Float32Array(cap);
  const y = new Float32Array(cap);
  const vx = new Float32Array(cap);
  const vy = new Float32Array(cap);
  const life = new Float32Array(cap);
  const maxLife = new Float32Array(cap);
  const size = new Float32Array(cap);
  const drag = new Float32Array(cap);
  const grav = new Float32Array(cap);
  const kind = new Uint8Array(cap);
  const color = new Array(cap).fill('#ffffff');
  let head = 0;
  let spawned = 0;

  /** 直接写入（内部用） */
  function put(px, py, pvx, pvy, plife, psize, pkind, pcolor, pgrav, pdrag) {
    const i = head;
    head = (head + 1) % cap;
    x[i] = px;
    y[i] = py;
    vx[i] = pvx;
    vy[i] = pvy;
    life[i] = plife;
    maxLife[i] = plife;
    size[i] = psize > maxSize ? maxSize : psize;
    kind[i] = pkind;
    color[i] = pcolor;
    grav[i] = pgrav;
    drag[i] = pdrag;
    spawned += 1;
  }

  const pool = {
    cap,
    maxSize,
    x, y, vx, vy, life, maxLife, size, drag, grav, kind, color,
    get spawned() { return spawned; },

    /** 一次写入一批同参数粒子（爆炸 / 拾取的主力入口） */
    burst(px, py, count, opts = {}) {
      const speed = opts.speed ?? 90;
      const spread = opts.spread ?? Math.PI * 2;
      const base = opts.dir ?? 0;
      const jitter = opts.jitter ?? 0;
      const rng = opts.rng;
      for (let k = 0; k < count; k++) {
        // 角度均匀分布 + 抖动：纯随机角度会产生难看的聚簇
        const t = count > 1 ? k / count : 0;
        const a = base + (t - 0.5) * spread + (rng ? rng.jitter(0.5) : 0);
        const sp = speed * (1 + (rng ? rng.range(-jitter, jitter) : 0));
        put(
          px, py,
          Math.cos(a) * sp, Math.sin(a) * sp,
          (opts.life ?? 0.5) * (rng ? rng.range(0.7, 1.3) : 1),
          (opts.size ?? 2.4) * (rng ? rng.range(0.7, 1.3) : 1),
          opts.kind ?? KIND.SPARK,
          opts.color ?? '#ffffff',
          opts.grav ?? 0,
          opts.drag ?? 1.6,
        );
      }
    },

    /** 单个粒子 */
    one(px, py, pvx, pvy, plife, psize, pkind, pcolor, pgrav = 0, pdrag = 1.6) {
      put(px, py, pvx, pvy, plife, psize, pkind, pcolor, pgrav, pdrag);
    },

    step(dt) {
      for (let i = 0; i < cap; i++) {
        const l = life[i];
        if (l <= 0) continue;
        life[i] = l - dt;
        const d = 1 - Math.min(1, drag[i] * dt);
        vx[i] *= d;
        vy[i] *= d;
        vy[i] += grav[i] * dt;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
      }
    },

    clear() {
      for (let i = 0; i < cap; i++) life[i] = 0;
    },

    /** 自检用：存活数（只在断言里扫描，不进热路径） */
    liveCount() {
      let n = 0;
      for (let i = 0; i < cap; i++) if (life[i] > 0) n += 1;
      return n;
    },
  };

  return pool;
}

/**
 * 绘制。分两趟：先路径类（环/碎片），再方点。
 *
 * 顺序有讲究：底下的方点用 `lighter` 叠加，如果把环也混在同一趟里，
 * 环会被后面的方点反复覆盖成一条糊掉的光带。
 */
export function drawParticles(ctx, pool, outOfBoundsCull = true) {
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  const W = 480;
  const H = 720;
  const M = 90;

  // 第一趟：环与碎片（需要路径）
  for (let i = 0; i < pool.cap; i++) {
    const l = pool.life[i];
    if (l <= 0) continue;
    const k = pool.kind[i];
    if (k !== KIND.RING && k !== KIND.SHARD) continue;
    const px = pool.x[i];
    const py = pool.y[i];
    if (outOfBoundsCull && (px < -M || px > W + M || py < -M || py > H + M)) continue;
    const t = l / pool.maxLife[i];
    const a = t > 1 ? 1 : t;
    ctx.globalAlpha = k === KIND.RING ? a * a * 0.9 : a;
    ctx.strokeStyle = pool.color[i];
    if (k === KIND.RING) {
      const r = (1 - t) * pool.size[i] + 1;
      ctx.lineWidth = Math.max(0.8, 2.6 * t);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.stroke();
    } else {
      const sp = Math.hypot(pool.vx[i], pool.vy[i]) || 1;
      const len = Math.min(14, pool.size[i] * 3.2);
      ctx.lineWidth = Math.max(0.8, pool.size[i] * 0.55);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - (pool.vx[i] / sp) * len, py - (pool.vy[i] / sp) * len);
      ctx.stroke();
    }
  }

  // 第二趟：方点与圆点（fillRect 是 Canvas 2D 最便宜的图元，不要为了"统一"换成路径）
  for (let i = 0; i < pool.cap; i++) {
    const l = pool.life[i];
    if (l <= 0) continue;
    const k = pool.kind[i];
    if (k === KIND.RING || k === KIND.SHARD) continue;
    const px = pool.x[i];
    const py = pool.y[i];
    if (outOfBoundsCull && (px < -M || px > W + M || py < -M || py > H + M)) continue;
    const t = l / pool.maxLife[i];
    ctx.globalAlpha = t > 1 ? 1 : t;
    ctx.fillStyle = pool.color[i];
    const s = pool.size[i] * (0.4 + 0.6 * t);
    if (k === KIND.DOT) {
      ctx.beginPath();
      ctx.arc(px, py, s * 0.6, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(px - s * 0.5, py - s * 0.5, s, s);
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prevOp;
}
