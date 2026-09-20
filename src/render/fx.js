/**
 * 事件 → 反馈 的桥。这是 game 层唯一被「翻译」成视觉与听觉的地方。
 *
 * 反馈必须在**事件发生的同一帧**给出 —— 这不是"加特效好看"，
 * 而是玩家对机制的信任来自机制对操作的即时回应。延迟一帧的反馈
 * 会让人怀疑「到底生效没有」。
 *
 * 注意 spawn 的是「本步的事件」（world.events 每个物理步开头清空），
 * 所以这里的 dt 是物理步长，不是帧间隔。
 */

import { KIND } from './particles.js';
import { PAL, ENEMY_COLOR, POWER_COLOR } from './palette.js';

/** 敌机引擎尾迹的节流间隔：0.05s → 20 次/秒 */
const ENEMY_TRAIL_INTERVAL = 0.05;
/**
 * 每次 tick 只有这个比例的敌机留尾迹。
 * 全留会把粒子池挤满，而粒子池是"溢出即覆盖最旧"的 ——
 * 结果是把爆炸碎片那种真正需要被看到的粒子挤掉。
 */
const ENEMY_TRAIL_RATE = 0.05;
/** 引擎尾焰间隔。每个物理步都发（120Hz 也照发）会在 1 秒内吃光整个池子， */
const TRAIL_INTERVAL = 0.022;

export function createFxBridge(pool, rng) {
  let trailT = 0;
  let enemyTrailT = 0;

  /**
   * 敌机引擎尾迹。
   * 视差星点让"背景在动"，但敌机本身要看起来**自己在飞**才有活物感 ——
   * 这是最便宜的一招：几个 DOT 粒子，代价可忽略。
   *
   * 必须**限流 + 抽稀**：40 只敌机每 tick 都发尾迹，1 秒内就能把 1600 的池子
   * 吃掉大半，而池是环形覆盖的 —— 挤掉的恰好是爆炸碎片那种真正需要被看到的粒子。
   */
  function enemyTrails(w, dt) {
    enemyTrailT -= dt;
    if (enemyTrailT > 0) return;
    enemyTrailT = ENEMY_TRAIL_INTERVAL;
    // 高密度时尾迹也停：它是最"可有可无"的一层，而且会挤占爆炸粒子的池子
    if (w.enemies.count > 45) return;
    for (const e of w.enemies.items) {
      if (!e.alive) continue;
      if (e.y < -10 || e.y > 730) continue;
      if (rng.next() > ENEMY_TRAIL_RATE) continue;
      pool.one(
        e.x + rng.jitter(2.4), e.y - e.r * 0.75,
        rng.jitter(12), -34 - rng.range(0, 40),
        0.2, 1.9, KIND.DOT, ENEMY_COLOR[e.type] || PAL.danger, 0, 2.8,
      );
    }
  }

  function trail(p, dt) {
    trailT -= dt;
    if (trailT > 0) return;
    trailT = TRAIL_INTERVAL;
    const jx = rng.jitter(2.6);
    pool.one(
      p.x + jx, p.y + 15,
      jx * 6, 130 + rng.range(0, 50),
      0.26, 2.6, KIND.DOT, PAL.playerTrail, 0, 2.2,
    );
    if (rng.chance(0.35)) {
      pool.one(p.x + rng.jitter(4), p.y + 12, rng.jitter(30), 90, 0.34, 1.8, KIND.SPARK, PAL.player, 0, 1.8);
    }
  }

  function shards(x, y, count, color, speed, size = 3, life = 0.55) {
    pool.burst(x, y, count, {
      speed, jitter: 0.55, life, size, kind: KIND.SHARD, color, drag: 1.3, rng,
    });
  }

  function sparks(x, y, count, color, speed, size = 2.2, life = 0.34) {
    pool.burst(x, y, count, {
      speed, jitter: 0.6, life, size, kind: KIND.SPARK, color, drag: 2.4, rng,
    });
  }

  function ring(x, y, color, size, life = 0.42) {
    pool.one(x, y, 0, 0, life, size, KIND.RING, color, 0, 0);
  }

  return {
    reset() { trailT = 0; enemyTrailT = 0; },

    consume(w, dt, audio) {
      const p = w.player;
      if (p.alive) trail(p, dt);
      enemyTrails(w, dt);

      for (const ev of w.events) {
        switch (ev.type) {
          case 'shoot':
            sparks(ev.x, ev.y, ev.spread ? 3 : 2, PAL.pBullet, 70, 1.8, 0.16);
            audio.play('shoot');
            break;

          case 'bulletHit':
            sparks(ev.x, ev.y, 3, '#ffffff', 110, 1.6, 0.16);
            audio.play('hit');
            break;

          case 'enemyFire':
            // 开火本身太频繁，不做粒子，只给一个极短的枪口点
            pool.one(ev.x, ev.y, 0, 0, 0.1, 4.5, KIND.RING, PAL.muzzle, 0, 0);
            break;

          case 'enemyDie': {
            const color = ENEMY_COLOR[ev.etype] || PAL.danger;
            const heavy = ev.r >= 19;
            shards(ev.x, ev.y, Math.round(8 + ev.r * 0.9), color, heavy ? 190 : 150, heavy ? 3.6 : 2.8,
              heavy ? 0.85 : 0.6);
            ring(ev.x, ev.y, color, heavy ? 46 : 30, heavy ? 0.5 : 0.36);
            sparks(ev.x, ev.y, 5, '#ffffff', 170, 1.8, 0.2);
            audio.play(heavy ? 'bigDie' : 'enemyDie');
            break;
          }

          case 'bossDie':
            shards(ev.x, ev.y, 72, PAL.danger, 320, 5, 1.3);
            shards(ev.x, ev.y, 40, '#ffffff', 240, 4, 1.1);
            for (let i = 1; i <= 5; i++) ring(ev.x, ev.y, PAL.danger, i * 70, 0.6 + i * 0.12);
            ring(ev.x, ev.y, '#ffffff', 200, 0.9);
            audio.play('bigDie');
            break;

          case 'bossPhase':
            shards(ev.x, ev.y, 26, PAL.danger, 230, 3.6, 0.7);
            ring(ev.x, ev.y, PAL.danger, 90, 0.6);
            audio.play('bossPhase');
            break;

          case 'bossEnter':
            ring(360, 108, PAL.danger, 160, 0.9);
            audio.play('waveBanner');
            break;

          case 'playerHit':
            shards(ev.x, ev.y, 24, PAL.player, 220, 3.2, 0.7);
            sparks(ev.x, ev.y, 14, '#ffffff', 200, 2.4, 0.4);
            ring(ev.x, ev.y, PAL.danger, 64, 0.5);
            ring(ev.x, ev.y, PAL.player, 34, 0.34);
            audio.play('playerHit');
            break;

          case 'shieldBreak':
            shards(ev.x, ev.y, 20, PAL.shield, 230, 3, 0.65);
            ring(ev.x, ev.y, PAL.shield, 58, 0.5);
            audio.play('shieldBreak');
            break;

          case 'pickup': {
            const color = POWER_COLOR[ev.ptype] || '#ffffff';
            ring(ev.x, ev.y, color, 52, 0.55);
            ring(ev.x, ev.y, '#ffffff', 22, 0.3);
            sparks(ev.x, ev.y, 12, color, 150, 2.4, 0.4);
            audio.play('pickup');
            break;
          }

          case 'coin':
            sparks(ev.x, ev.y, 4, PAL.coin, 90, 1.8, 0.26);
            ring(ev.x, ev.y, PAL.coin, 16, 0.26);
            audio.play('coin');
            break;

          case 'bomb':
            sparks(ev.x, ev.y, 40, '#ffffff', 300, 3, 0.6);
            ring(ev.x, ev.y, POWER_COLOR.bomb, 150, 0.7);
            ring(ev.x, ev.y, '#ffffff', 90, 0.5);
            audio.play('bigDie');
            break;

          case 'waveBanner':
            audio.play('waveBanner');
            break;

          case 'death':
            shards(ev.x, ev.y, 46, PAL.player, 300, 4, 1.1);
            shards(ev.x, ev.y, 20, '#ffffff', 220, 3, 0.9);
            for (let i = 1; i <= 3; i++) ring(ev.x, ev.y, PAL.player, i * 46, 0.5 + i * 0.14);
            audio.play('bigDie');
            break;

          default:
            break;
        }
      }
    },

    /** 玩家死亡时由场景补一次爆炸（相位迁移驱动，不依赖事件 —— 见 world.js 的注释） */
    deathBlast(w) {
      const p = w.player;
      shards(p.x, p.y, 46, PAL.player, 300, 4, 1.1);
      shards(p.x, p.y, 20, '#ffffff', 220, 3, 0.9);
      for (let i = 1; i <= 3; i++) ring(p.x, p.y, PAL.player, i * 46, 0.5 + i * 0.14);
    },
  };
}
