/**
 * 掉落物：金币碎片 + 道具。
 *
 * 道具画成「旋转菱形 + 白色内部图标」，敌机从不带白色图标 ——
 * 这是 PRD 里 🔴散射 与「坦克·霓虹红」撞色后的消解办法（SPEC §0.2）：
 * 形状=类别，颜色=类型，白色=可拾取。
 */

import { FIELD_W, FIELD_H, SCORE, POWER } from './config.js';

export const POWER_TYPES = Object.keys(POWER); // spread / shield / magnet / bomb / speed

export const DROP = { COIN: 0, POWER: 1 };

const coinValues = SCORE.coinValues;

export function createDropPool(cap = 64) {
  const items = [];
  for (let i = 0; i < cap; i++) {
    items.push({
      alive: false, kind: DROP.COIN, ptype: 'spread',
      x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
      value: 10, life: 0, t: 0, pulled: false, r: 9,
    });
  }
  let count = 0;

  return {
    items,
    cap,
    get count() { return count; },
    get full() { return count >= cap; },

    spawnCoin(x, y, rng) {
      if (count >= cap) return null;
      const d = take(items);
      if (!d) return null;
      d.kind = DROP.COIN;
      d.x = x;
      d.y = y;
      d.px = x;
      d.py = y;
      d.vx = rng.jitter(34);
      d.vy = rng.range(48, 86);
      d.value = coinValues[rng.int(0, coinValues.length - 1)];
      d.r = 9;
      d.life = 8;
      d.t = 0;
      d.pulled = false;
      d.alive = true;
      count += 1;
      return d;
    },

    spawnPower(x, y, ptype, rng) {
      if (count >= cap) return null;
      const d = take(items);
      if (!d) return null;
      d.kind = DROP.POWER;
      d.ptype = ptype;
      d.x = x;
      d.y = y;
      d.px = x;
      d.py = y;
      d.vx = rng.jitter(16);
      d.vy = rng.range(34, 54);
      d.value = 0;
      d.r = 13;
      d.life = 14;
      d.t = 0;
      d.pulled = false;
      d.alive = true;
      count += 1;
      return d;
    },

    kill(d) {
      if (!d.alive) return;
      d.alive = false;
      count -= 1;
    },

    clear() {
      for (const d of items) d.alive = false;
      count = 0;
    },
  };
}

function take(items) {
  for (const d of items) if (!d.alive) return d;
  return null;
}

/**
 * 掉落编排。集中在一处，方便自检断言概率与种类覆盖。
 * 返回本步产生的掉落数量。
 */
export function rollLoot(pool, x, y, rng, forcePower = false) {
  let n = 0;
  if (forcePower) {
    const d = pool.spawnPower(x, y, rng.pick(POWER_TYPES), rng);
    if (d) n += 1;
  } else {
    if (rng.chance(SCORE.powerDropChance)) {
      const d = pool.spawnPower(x, y, rng.pick(POWER_TYPES), rng);
      if (d) n += 1;
    }
    if (rng.chance(SCORE.coinDropChance)) {
      const d = pool.spawnCoin(x, y, rng);
      if (d) n += 1;
    }
  }
  return n;
}

export function stepDrops(pool, dt, ctx) {
  const p = ctx.player;
  const magnetOn = p.powers.magnet > 0;
  const attractR = magnetOn ? 2400 : SCORE.coinAttractRadius;

  for (const d of pool.items) {
    if (!d.alive) continue;
    d.px = d.x;
    d.py = d.y;
    d.t += dt;
    d.life -= dt;

    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 < attractR * attractR && p.alive) {
      // 磁吸：越近吸得越快，避免在玩家身边打转
      const dist = Math.sqrt(dist2) || 1;
      const pull = magnetOn ? 1500 : 900;
      d.vx += (dx / dist) * pull * dt;
      d.vy += (dy / dist) * pull * dt;
      d.pulled = true;
    } else {
      d.vx *= 1 - Math.min(1, 1.6 * dt);
      d.vy += 78 * dt; // 缓慢下坠，让玩家有拾取窗口
    }

    const maxV = SCORE.coinAttractSpeed * (magnetOn ? 2.4 : 1);
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > maxV) {
      d.vx = (d.vx / sp) * maxV;
      d.vy = (d.vy / sp) * maxV;
    }

    d.x += d.vx * dt;
    d.y += d.vy * dt;

    if (d.x < d.r) { d.x = d.r; d.vx = Math.abs(d.vx); }
    else if (d.x > FIELD_W - d.r) { d.x = FIELD_W - d.r; d.vx = -Math.abs(d.vx); }

    // 拾取半径用玩家的判定半径（必须存在且有限，见 player.js 的注释）
    const grab = d.r + ctx.player.radius + 10;
    if (p.alive && dist2 <= grab * grab) {
      pool.kill(d);
      ctx.onPickup(d);
      continue;
    }

    if (d.life <= 0 || d.y > FIELD_H + 30) pool.kill(d);
  }
}
