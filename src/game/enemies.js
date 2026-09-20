/**
 * 敌机定义表与行为。
 *
 * 色相即危险等级（SPEC §5）：绿(无害) → 橙(单发) → 紫(散射) → 红(环形) → 品红(精英)。
 * 这里的 fire.type 与 entry 前的静止时长共同定义「玩家有多少时间反应」。
 */

import { FIELD_W, FIELD_H, WAVE } from './config.js';
import { aimed, fan, ring, spiral } from './enemy-fire.js';
import { KIND } from './bullets.js';

const DEG = Math.PI / 180;

/**
 * 敌机定义表。**故意不含颜色** —— 颜色是渲染层的事，
 * game/ 不认识 palette.js（否则 game 层就不再能在 Node 裸跑）。
 * 渲染时用 ENEMY_COLOR[type] 查（见 render/shapes.js）。
 */
export const ENEMY_DEFS = {
  scout: {
    shape: 'triangle', hp: 1, r: 11, speed: 105,
    score: 100, cost: 1, fire: null, drift: 0,
  },
  striker: {
    shape: 'diamond', hp: 2, r: 13, speed: 78,
    score: 180, cost: 2, drift: 0,
    fire: { type: 'aimed', interval: 1.5, speed: 195 },
  },
  seeker: {
    shape: 'circle', hp: 3, r: 14, speed: 52,
    score: 260, cost: 3, drift: 46, homing: 1.6,
    fire: { type: 'fan', interval: 2.2, count: 3, spread: 30 * DEG, speed: 168 },
  },
  tank: {
    shape: 'hexagon', hp: 14, r: 24, speed: 34,
    score: 520, cost: 5, drift: 0, holdY: 132, holdMax: 9,
    fire: { type: 'ring', interval: 3.4, count: 12, speed: 132 },
  },
  elite: {
    shape: 'star', hp: 9, r: 19, speed: 58,
    score: 760, cost: 6, drift: 62, holdY: 158, holdMax: 11, blink: true,
    fire: { type: 'spiral', interval: 0.44, arms: 4, speed: 155, spin: 1.15 },
  },
};

export const ENEMY_TYPES = Object.keys(ENEMY_DEFS);

/** 精英与坦克的视觉签名是「闪烁」，由渲染层读 def.blink 决定，不在这里存颜色。 */

/** 波次难度倍率（SPEC §4） */
export function ramps(wave) {
  const w = Math.max(1, wave);
  return {
    speed: 1 + Math.min(WAVE.speedRampMax, (w - 1) * WAVE.speedRamp),
    hp: 1 + Math.min(WAVE.hpRampMax, (w - 1) * WAVE.hpRamp),
    fire: Math.max(WAVE.fireRampMin, 1 - (w - 1) * WAVE.fireRamp),
  };
}

export function hpFor(type, wave) {
  return Math.max(1, Math.ceil(ENEMY_DEFS[type].hp * ramps(wave).hp));
}

/** 敌机池：容量固定，溢出时拒绝生成（同子弹场的取向） */
export function createEnemyPool(cap = 72) {
  const items = [];
  for (let i = 0; i < cap; i++) {
    items.push({
      type: 'scout', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
      hp: 1, maxHp: 1, r: 11, t: 0, fireT: 0, volley: 0,
      flash: 0, phase: 0, holdT: 0, alive: false, held: false, holding: false, leaving: false,
    });
  }
  let count = 0;

  return {
    cap,
    items,
    get count() { return count; },
    get full() { return count >= cap; },

    spawn(type, x, y, wave, seedPhase = 0) {
      if (count >= cap) return null;
      for (let i = 0; i < cap; i++) {
        const e = items[i];
        if (e.alive) continue;
        const def = ENEMY_DEFS[type];
        const rm = ramps(wave);
        e.type = type;
        e.x = x;
        e.y = y;
        e.px = x;
        e.py = y;
        e.vx = 0;
        e.vy = def.speed * rm.speed;
        e.maxHp = hpFor(type, wave);
        e.hp = e.maxHp;
        e.r = def.r;
        e.t = 0;
        e.fireT = def.fire ? def.fire.interval * rm.fire * 0.85 : 0;
        e.volley = 0;
        e.flash = 0;
        e.phase = seedPhase;
        e.holdT = 0;
        e.holding = false;
        e.leaving = false;
        e.held = false;
        e.alive = true;
        count += 1;
        return e;
      }
      return null;
    },

    kill(e) {
      if (!e.alive) return;
      e.alive = false;
      count -= 1;
    },

    clear() {
      for (const e of items) e.alive = false;
      count = 0;
    },

    /** 炸弹道具：清掉小型敌机（坦克/精英/Boss 只受伤，不被秒） */
    clearSmall(damage = 3) {
      let removed = 0;
      for (const e of items) {
        if (!e.alive) continue;
        if (e.type === 'tank' || e.type === 'elite') {
          e.hp -= damage;
          e.flash = 1;
        } else {
          e.alive = false;
          count -= 1;
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * 单个敌机的一个物理步。
 * 所有行为都在这里 —— enemies.js 是「怎么动」的唯一来源。
 */
export function stepEnemy(e, pool, dt, ctx) {
  const def = ENEMY_DEFS[e.type];
  const rm = ramps(ctx.wave);
  e.px = e.x;
  e.py = e.y;
  e.t += dt;
  if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 5);

  // 驻留型（坦克/精英）：到达 holdY 后开火一段时间，然后脱离飞出。
  // 「脱离」是必需的，不是点缀 —— 没有它，一只被无视的坦克会永久占位，
  // 敌机池迟早被这类僵尸填满，晚期波次会静默地生成不出任何东西。
  if (def.holdY !== undefined) {
    if (!e.holding && !e.leaving && e.y >= def.holdY) e.holding = true;
    if (e.holding && !e.leaving) {
      e.holdT += dt;
      if (e.holdT >= (def.holdMax || 10)) {
        e.holding = false;
        e.leaving = true;
      }
    }
  }

  if (e.leaving) {
    e.vy = def.speed * rm.speed;
    e.y += e.vy * dt;
    if (def.drift) e.x += Math.cos(e.t * 0.9 + e.phase) * def.drift * dt;
  } else if (e.holding) {
    e.vy = 0;
    const drift = def.drift || 0;
    e.x += Math.cos(e.t * 0.9 + e.phase) * drift * dt;
    e.y += Math.sin(e.t * 1.3 + e.phase) * 14 * dt;
  } else {
    e.vy = def.speed * rm.speed;
    e.y += e.vy * dt;
    if (def.drift) {
      if (def.homing) {
        // 追踪者：横向缓慢贴向玩家，速度上限由 drift 决定
        const dir = Math.sign(ctx.player.x - e.x);
        const want = dir * def.drift * rm.speed;
        e.vx += (want - e.vx) * (1 - Math.exp(-def.homing * dt));
      } else {
        e.vx = Math.cos(e.t * 1.1 + e.phase) * def.drift;
      }
      e.x += e.vx * dt;
    }
  }

  // 水平边界：不越界（越界的敌机玩家永远打不到，等于漏怪）
  const m = e.r + 4;
  if (e.x < m) { e.x = m; e.vx = Math.abs(e.vx); }
  else if (e.x > FIELD_W - m) { e.x = FIELD_W - m; e.vx = -Math.abs(e.vx); }

  // 开火
  if (def.fire) {
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT += def.fire.interval * rm.fire;
      e.volley += 1;
      const f = def.fire;
      const toPlayer = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
      const speed = f.speed || 170;
      const k = e.type === 'tank' ? KIND.HEAVY : KIND.ENEMY;
      if (f.type === 'aimed') aimed(ctx.eb, e.x, e.y, toPlayer, speed, 3.6, k);
      else if (f.type === 'fan') fan(ctx.eb, e.x, e.y, toPlayer, f.count, f.spread, speed, 3.6, KIND.ENEMY);
      else if (f.type === 'ring') ring(ctx.eb, e.x, e.y, f.count, speed, 4.2, KIND.HEAVY, e.volley);
      else if (f.type === 'spiral') {
        spiral(ctx.eb, e.x, e.y, f.arms, e.t * f.spin, speed, 3.8, KIND.ENEMY);
      }
      ctx.onEnemyFire(e);
    }
  }

  // 飞出下边界：放过它（不惩罚）。弹幕压力本身就是惩罚。
  if (e.y > FIELD_H + 70) {
    pool.kill(e);
    ctx.onEscape(e);
  }
}
