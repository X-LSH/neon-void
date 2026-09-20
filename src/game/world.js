/**
 * 世界装配与每步编排。
 *
 * 这个文件只负责「顺序」：谁先动、谁后判、什么时候推进波次。
 * 判定细节在 resolve.js，手感常量在 config.js，行为在 enemies/boss/wave.js。
 *
 * game/ 不认识 DOM、Canvas、Audio —— 全部对外沟通通过 w.events 队列。
 * 这就是 verify.mjs 能在 Node 裸跑整个世界的前提。
 */

import { createRng } from '../core/rng.js';
import { EBULLET, FX, PHASE, WAVE } from './config.js';
import { createBulletField } from './bullets.js';
import { createEnemyPool, stepEnemy } from './enemies.js';
import { createPlayer, resetPlayer, stepPlayer } from './player.js';
import { createDropPool, stepDrops } from './drops.js';
import { createScore, stepScore, addRaw } from './score.js';
import { createDirector, stepDirector, beginWave as restartWave } from './wave.js';import { createBoss, stepBoss } from './boss.js';
import { resolveCollisions, collectDrop, killEnemy } from './resolve.js';

export { PHASE };

export function createWorld(seed) {
  const s = (seed ?? ((Date.now() ^ 0x5bf03635) >>> 0)) >>> 0;
  const w = {
    seed: s,
    rng: createRng(s),
    /** 视觉抖动单独一条随机流 —— 否则「关掉屏幕震动」会改变游戏随机性 */
    fxRng: createRng((s ^ 0x1234567) >>> 0),
    t: 0,
    overT: 0,
    phase: PHASE.PLAYING,
    shakeEnabled: true,
    player: createPlayer(),
    enemies: createEnemyPool(72),
    pBullets: createBulletField(240),
    eBullets: createBulletField(EBULLET.cap),
    drops: createDropPool(64),
    boss: null,
    director: createDirector(),
    score: createScore(),
    fx: { shake: 0, shakeX: 0, shakeY: 0, flash: 0, slowmo: 0, timeScale: 1 },
    stats: { shots: 0, hits: 0, coins: 0, powers: 0, escaped: 0, bossKills: 0, kills: 0 },
    events: [],
    debugKills: 0,
  };
  resetPlayer(w.player);
  restartWave(w.director, 1);
  return w;
}

export function stepWorld(w, dt, intent) {
  w.t += dt;
  w.events.length = 0; // 事件是「本步发生了什么」，不跨步累积

  const p = w.player;

  if (w.phase === PHASE.PLAYING) {
    stepPlayer(p, intent, dt, {
      pb: w.pBullets,
      canFire: true,
      onShoot: () => {
        w.stats.shots += 1;
        w.events.push({ type: 'shoot', x: p.x, y: p.y - 18, spread: p.powers.spread > 0 });
      },
    });
  } else {
    p.px = p.x;
    p.py = p.y;
    w.overT += dt;
  }

  for (const e of w.enemies.items) {
    if (!e.alive) continue;
    stepEnemy(e, w.enemies, dt, {
      wave: w.director.wave,
      player: p,
      eb: w.eBullets,
      onEnemyFire: (en) => w.events.push({ type: 'enemyFire', x: en.x, y: en.y, etype: en.type }),
      onEscape: () => { w.stats.escaped += 1; },
    });
  }

  if (w.boss) {
    stepBoss(w.boss, dt, {
      eb: w.eBullets,
      player: p,
      onBossPhase: (b) => {
        w.fx.shake = Math.max(w.fx.shake, FX.shakeBossPhase);
        w.events.push({ type: 'bossPhase', x: b.x, y: b.y, phase: b.phase });
      },
      onBossFire: (b) => w.events.push({ type: 'enemyFire', x: b.x, y: b.y, etype: 'boss', heavy: true }),
      summonScouts: (n) => {
        for (let i = 0; i < n; i++) {
          w.enemies.spawn('scout', 90 + i * 300, -60 - i * 30, w.director.wave, w.director.phaseSeed);
        }
      },
    });
  }

  w.pBullets.step(dt);
  w.eBullets.step(dt);

  stepDrops(w.drops, dt, {
    player: p,
    onPickup: (d) => collectDrop(w, d),
  });

  resolveCollisions(w);

  // 调试击杀：在本步之内消费，事件才能被 fx 桥接到粒子
  if (w.debugKills > 0) {
    let k = w.debugKills;
    w.debugKills = 0;
    for (const e of w.enemies.items) {
      if (k <= 0) break;
      if (e.alive) { killEnemy(w, e); k -= 1; }
    }
  }

  if (w.phase === PHASE.PLAYING) {
    stepScore(w.score, dt);
    stepDirector(w.director, dt, {
      rng: w.rng,
      onSpawn: (type, x, y, phase) => {
        w.enemies.spawn(type, x, y, w.director.wave, phase);
      },
      onSpawnBoss: (wave) => {
        w.boss = createBoss(wave);
        w.events.push({ type: 'bossEnter', wave });
      },
      onWave: (wave) => w.events.push({ type: 'waveBanner', wave }),
      onWaveClear: (wave) => {
        addRaw(w.score, WAVE.clearBonus * wave);
      },
      bossAlive: Boolean(w.boss && !w.boss.dying),
    });
  }

  // Boss 死亡动画播完再释放引用（渲染层靠它画碎裂过程）
  if (w.boss && w.boss.dying && w.boss.deathT > 1.2) w.boss = null;

  stepFx(w, dt);
}

export function stepFx(w, dt) {
  const f = w.fx;
  if (f.slowmo > 0) f.slowmo = Math.max(0, f.slowmo - dt);
  f.timeScale = f.slowmo > 0 ? FX.slowmoScale : 1;

  if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 2.6);

  if (f.shake > 0 && w.shakeEnabled) {
    // 自阻尼：越弱衰减越快，避免尾巴拖得很长
    f.shake = Math.max(0, f.shake - dt * FX.shakeDecay * (1 + f.shake / FX.shakeMax));
    const a = w.fxRng.range(0, Math.PI * 2);
    f.shakeX = Math.cos(a) * f.shake;
    f.shakeY = Math.sin(a) * f.shake;
  } else {
    f.shake = 0;
    f.shakeX = 0;
    f.shakeY = 0;
  }
}

/** 供自检与 E2E 读取的纯数据快照 */
export function snapshotWorld(w) {
  const p = w.player;
  return {
    seed: w.seed,
    t: +w.t.toFixed(2),
    phase: w.phase,
    wave: w.director.wave,
    waveT: +w.director.t.toFixed(2),
    score: w.score.score,
    combo: w.score.combo,
    kills: w.score.kills,
    maxCombo: w.score.maxCombo,
    hp: p.hp,
    alive: p.alive,
    shield: p.shield,
    invuln: +p.invuln.toFixed(2),
    px: +p.x.toFixed(1),
    py: +p.y.toFixed(1),
    powers: {
      spread: +p.powers.spread.toFixed(1),
      magnet: +p.powers.magnet.toFixed(1),
      speed: +p.powers.speed.toFixed(1),
    },
    counts: {
      enemies: w.enemies.count,
      pBullets: w.pBullets.count,
      eBullets: w.eBullets.count,
      drops: w.drops.count,
    },
    boss: w.boss
      ? { hp: w.boss.hp, maxHp: w.boss.maxHp, phase: w.boss.phase, dying: w.boss.dying }
      : null,
    fx: { shake: +w.fx.shake.toFixed(2), flash: +w.fx.flash.toFixed(2), timeScale: w.fx.timeScale },
    stats: { ...w.stats },
  };
}

/**
 * 测试接缝（供 E2E 用）。
 * 明确标注为 debug 前缀，避免被误当成游戏内机制调用。
 */

/**
 * 直接扣血、绕开无敌帧与护盾（用于把测试推进到「死亡 → 结算」路径）。
 *
 * 刻意**不推事件**：world.events 是「本步发生了什么」，只在 stepWorld 内部有效，
 * 在步外推入的事件会被下一步开头清空。死亡的可观测副作用是 w.phase 变成 'over' ——
 * 场景通过**相位迁移**触发爆炸与音效，而不是依赖事件，两条死亡路径因此都成立。
 */
export function debugDamagePlayer(w, amount = 1) {
  const p = w.player;
  p.invuln = 0;
  p.shield = false;
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp === 0 && p.alive) {
    p.alive = false;
    w.phase = PHASE.OVER;
    w.overT = 0;
    w.fx.slowmo = Math.max(w.fx.slowmo, 0.9);
  }
}

/**
 * 走**真实击杀路径**杀掉若干敌机（触发掉落、事件、后续粒子）。
 *
 * ★ 必须**排队后在本步之内消费**，不能直接在这里循环调用 killEnemy：
 *   `world.events` 在每个物理步开头被清空，步外推入的事件活不到渲染帧 ——
 *   表现就是"击杀了 8 只但一个粒子都没冒出来"。这是事件队列语义的必然结果，
 *   不是 bug（world.js 的 death 路径遇到过同一个坑）。
 */
export function debugQueueKills(w, n = 8) {
  w.debugKills = (w.debugKills || 0) + Math.max(0, Math.floor(n));
  return w.debugKills;
}

/** 立刻清场（把测试快速推进到指定波次） */
export function debugClearEnemies(w) {
  for (const e of w.enemies.items) if (e.alive) killEnemy(w, e);
  w.eBullets.clearEnemy();
}

/**
 * 跳到指定波次：清场 + 重置导演。
 * 用于把 E2E 快速推到 Boss 波（否则要真跑 2 分钟才验证得到 Boss 路径）。
 */
export function debugGotoWave(w, wave) {
  // 直接清池，不走 killEnemy —— 否则"清场"反而会掉一地金币与道具
  w.enemies.clear();
  w.drops.clear();
  w.eBullets.clear();
  w.pBullets.clear();
  w.boss = null;
  restartWave(w.director, wave);
}
