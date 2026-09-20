/**
 * 一局战斗的会话：拥有 world，把事件桥接到粒子/音效，并负责「死亡 → 结算」的迁移。
 *
 * 死亡后的过渡是**由相位迁移驱动**的，不是由事件驱动 ——
 * world.events 每个物理步开头清空，从外部注入的死亡（调试钩子）推不出事件。
 * 相位是持久的，所以两条死亡路径都能被观察到。
 */

import {
  createWorld, stepWorld, snapshotWorld, PHASE, debugGotoWave, debugQueueKills,
} from '../game/world.js';
import { createFxBridge } from '../render/fx.js';

/**
 * 死亡到弹结算面板之间的等待（模拟秒）。
 * 实测：这段等待还要叠加死亡慢动作（0.35×），所以 1.4 模拟秒
 * ≈ 0.8/0.35 + 0.6 ≈ 2.9 真实秒。E2E 必须按真实时间等，否则会误判成"没切页"。
 */
const OVER_DELAY = 1.4;

export function createBattle({ particles, rng, audio, storage, hud, onEnd, setTimeScale, getFps }) {
  let world = null;
  let deathFxDone = false;
  let reported = false;
  const fxBridge = createFxBridge(particles, rng);

  return {
    start(seed) {
      world = createWorld(seed);
      world.shakeEnabled = storage.get().settings.shake;
      deathFxDone = false;
      reported = false;
      fxBridge.reset();
      hud.reset();
      setTimeScale(1);
      return world;
    },

    stop() {
      world = null;
      particles.clear();
      fxBridge.reset();
      setTimeScale(1);
    },

    world: () => world,
    isOver: () => Boolean(world && world.phase === PHASE.OVER),

    setShakeEnabled(v) {
      if (world) world.shakeEnabled = v;
    },

    step(dt, intent) {
      if (!world) return;
      stepWorld(world, dt, intent);
      fxBridge.consume(world, dt, audio);
      particles.step(dt);
      setTimeScale(world.fx.timeScale);
      hud.update(world, dt, getFps());

      if (world.phase === PHASE.OVER) {
        if (!deathFxDone) {
          deathFxDone = true;
          fxBridge.deathBlast(world);
          audio.play('bigDie');
        }
        if (!reported && world.overT >= OVER_DELAY) {
          reported = true;
          const s = snapshotWorld(world);
          onEnd({
            score: s.score,
            kills: s.kills,
            combo: s.maxCombo,
            time: Math.round(s.t),
            wave: s.wave,
          });
        }
      }
    },

    // ── 测试接缝 ────────────────────────────────────────────
    debug: {
      snapshot: () => (world ? snapshotWorld(world) : null),
      gotoWave: (n) => { if (world) debugGotoWave(world, n); },
      queueKills: (n) => (world ? debugQueueKills(world, n) : 0),
      enemies: () => (world ? world.enemies.count : 0),
      particles: () => particles.liveCount(),
      particleCap: () => particles.cap,
    },
  };
}
