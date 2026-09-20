/**
 * 波次导演：时间驱动、无波间停顿。
 *
 * 关键决策：**事件间距由「剩余时间 ÷ 剩余事件数」推导**，不用固定区间。
 * 固定区间 + 固定事件数会让早期波次（事件少、时长长）出现十几秒空场，
 * 新手面对空屏的体感是「这游戏卡住了」，而不是「轻松」。
 */

import { FIELD_W, WAVE } from './config.js';
import { ENEMY_DEFS } from './enemies.js';

export function waveDuration(wave) {
  return Math.max(WAVE.minDuration, WAVE.baseDuration - (wave - 1) * WAVE.durationDecay);
}

export function waveEvents(wave) {
  return Math.min(WAVE.maxEvents, WAVE.baseEvents + wave * WAVE.eventsPerWave);
}

export function isBossWave(wave) {
  return wave % WAVE.bossEvery === 0;
}

const GROUP = {
  scout: [2, 4],
  striker: [2, 3],
  seeker: [1, 2],
  tank: [1, 1],
  elite: [1, 1],
};

/**
 * 类型权重。重的敌机 cost 高，而每波事件数固定，
 * 所以「单位事件的威胁」自然随波次上升 —— 不需要额外调数量。
 */
export function typeWeights(wave) {
  const u = WAVE.unlock;
  const tilt = WAVE.weightTilt;
  const w = Math.max(1, wave);
  const out = { scout: Math.max(0.45, 3.0 - w * 0.055) };
  if (w >= u.striker) out.striker = 1.1 + (w - u.striker) * tilt * 1.4;
  if (w >= u.seeker) out.seeker = 0.85 + (w - u.seeker) * tilt * 1.2;
  if (w >= u.tank) out.tank = 0.4 + (w - u.tank) * tilt * 0.7;
  if (w >= u.elite) out.elite = 0.14 + (w - u.elite) * tilt * 0.35;
  return out;
}

export function pickType(wave, rng) {
  const weights = typeWeights(wave);
  const keys = Object.keys(weights);
  let total = 0;
  for (const k of keys) total += weights[k];
  let r = rng.next() * total;
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

/** 编队位置。所有 x 都裁进游戏区 —— 队长站在屏幕外的编队等于漏怪。 */
export function formation(type, count, rng) {
  const def = ENEMY_DEFS[type];
  const margin = def.r + 10;
  const out = [];

  if (type === 'scout' && count > 1 && rng.chance(0.6)) {
    const gap = Math.min(44, (FIELD_W - margin * 2) / Math.max(1, count - 1));
    const total = gap * (count - 1);
    const x0 = rng.range(margin, Math.max(margin, FIELD_W - margin - total));
    const y0 = rng.range(-70, -30);
    for (let i = 0; i < count; i++) out.push({ x: x0 + i * gap, y: y0 });
  } else if (type === 'striker' && count > 1) {
    const x0 = rng.range(margin + 34, Math.max(margin + 34, FIELD_W - margin - 34));
    for (let i = 0; i < count; i++) {
      const o = i - (count - 1) / 2;
      out.push({ x: x0 + o * 40, y: -34 - Math.abs(o) * 28 });
    }
  } else if (count > 1) {
    const x = rng.range(margin, FIELD_W - margin);
    for (let i = 0; i < count; i++) out.push({ x, y: -44 - i * 46 });
  } else {
    out.push({ x: rng.range(margin, FIELD_W - margin), y: -50 });
  }

  return out.map((p) => ({
    x: Math.max(margin, Math.min(FIELD_W - margin, p.x)),
    y: p.y,
  }));
}

export function createDirector() {
  return {
    wave: 1,
    t: 0,
    banner: 0,
    eventsLeft: 0,
    spawnT: 0.8,
    bossSpawned: false,
    bossScoutT: 1.2,
    pendingAdvance: 0,
    phaseSeed: 0,
    eventsDone: 0,
    spawned: 0,
  };
}

export function beginWave(d, wave) {
  d.wave = wave;
  d.t = 0;
  d.banner = WAVE.bannerTime;
  d.eventsLeft = waveEvents(wave);
  d.spawnT = 0.8;
  d.bossSpawned = false;
  d.bossScoutT = 1.2;
  d.pendingAdvance = 0;
}

export function advanceWave(d, ctx) {
  ctx.onWaveClear(d.wave);
  beginWave(d, d.wave + 1);
  ctx.onWave(d.wave);
}

function emit(d, ctx) {
  const type = pickType(d.wave, ctx.rng);
  const g = GROUP[type];
  const cap = Math.min(5, g[1] + Math.floor(d.wave / 8));
  const count = ctx.rng.int(g[0], Math.max(g[0], cap));
  const spots = formation(type, count, ctx.rng);
  d.phaseSeed += 0.83; // 同编队同相位（看起来是有意为之），不同编队错开
  for (const s of spots) ctx.onSpawn(type, s.x, s.y, d.phaseSeed);
  d.eventsLeft -= 1;
  d.eventsDone += 1;
  d.spawned += spots.length;
}

export function stepDirector(d, dt, ctx) {
  d.t += dt;
  if (d.banner > 0) d.banner = Math.max(0, d.banner - dt);

  if (d.pendingAdvance > 0) {
    d.pendingAdvance -= dt;
    if (d.pendingAdvance <= 0) advanceWave(d, ctx);
    return;
  }

  // Boss 阶段：只零星补侦察机，主压力来自 Boss
  if (ctx.bossAlive) {
    d.bossScoutT -= dt;
    if (d.bossScoutT <= 0) {
      d.bossScoutT = WAVE.bossScoutInterval;
      const spots = formation('scout', 2, ctx.rng);
      d.phaseSeed += 0.83;
      for (const s of spots) ctx.onSpawn('scout', s.x, s.y, d.phaseSeed);
    }
    return;
  }

  if (isBossWave(d.wave)) {
    if (!d.bossSpawned) {
      d.bossSpawned = true;
      ctx.onSpawnBoss(d.wave);
    }
    return;
  }

  const duration = waveDuration(d.wave);
  if (d.t >= duration || d.eventsLeft <= 0) {
    advanceWave(d, ctx);
    return;
  }

  d.spawnT -= dt;
  if (d.spawnT <= 0) {
    const remain = Math.max(1, d.eventsLeft);
    const slot = (duration - d.t) / remain;
    d.spawnT = Math.max(WAVE.spawnGapMin, slot * ctx.rng.range(0.7, 1.3));
    emit(d, ctx);
  }
}
