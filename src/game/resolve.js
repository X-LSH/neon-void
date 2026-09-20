/**
 * 碰撞求解与伤害结算。全部通过 world 引用就地修改。
 *
 * 从 world.js 拆出来的理由：这两块加起来是游戏规则最密集的部分，
 * 混在编排代码里会让 world.js 同时承担「顺序」和「判定」两件事。
 */

import { PLAYER, FIELD_W, FIELD_H, WAVE, FX, PHASE } from './config.js';
import { KIND } from './bullets.js';
import { segCircle, circleHit } from './collision.js';
import { ENEMY_DEFS } from './enemies.js';
import { addKill, addRaw, breakCombo } from './score.js';
import { rollLoot, DROP } from './drops.js';
import { grantPower } from './player.js';
import { BOSS_HIT_RATIO } from './boss.js';

/** Boss 击杀得分：6000 × (1 + bossIndex × 0.5) */
function bossScore(wave) {
  return 6000 * (1 + Math.floor(wave / WAVE.bossEvery) * 0.5);
}

export function resolveCollisions(w) {
  const p = w.player;
  const pb = w.pBullets;
  const eb = w.eBullets;

  // ── 玩家子弹 → Boss / 敌机（扫掠，见 SPEC §1.1）────────────
  for (let i = 0; i < pb.cap; i++) {
    if (!pb.alive[i]) continue;
    const r = pb.rad[i];
    const x0 = pb.px[i];
    const y0 = pb.py[i];
    const x1 = pb.x[i];
    const y1 = pb.y[i];
    let consumed = false;

    const b = w.boss;
    if (b && !b.entering && !b.dying && segCircle(x0, y0, x1, y1, b.x, b.y, b.r + r)) {
      damageBoss(w, PLAYER.bulletDmg);
      consumed = true;
    }
    if (!consumed) {
      for (const e of w.enemies.items) {
        if (!e.alive) continue;
        if (segCircle(x0, y0, x1, y1, e.x, e.y, e.r + r)) {
          damageEnemy(w, e, PLAYER.bulletDmg);
          consumed = true;
          break;
        }
      }
    }
    if (consumed) {
      pb.kill(i);
      w.stats.hits += 1;
      w.events.push({ type: 'bulletHit', x: x1, y: y1, kind: pb.kind[i] });
    }
  }

  // ── 敌方子弹 → 玩家（只吃第一发，之后进入无敌帧）──────────
  if (p.alive && p.invuln <= 0) {
    for (let i = 0; i < eb.cap; i++) {
      if (!eb.alive[i]) continue;
      if (segCircle(eb.px[i], eb.py[i], eb.x[i], eb.y[i], p.x, p.y, p.radius + eb.rad[i])) {
        eb.kill(i);
        hitPlayer(w, 'bullet');
        break;
      }
    }
  }

  // ── Boss 机体 → 玩家 ───────────────────────────────────────
  const br = w.boss;
  if (br && p.alive && !br.entering && !br.dying) {
    if (circleHit(br.x, br.y, br.r * BOSS_HIT_RATIO, p.x, p.y, p.radius)) {
      hitPlayer(w, 'boss');
    }
  }

  // ── 敌机机体 → 玩家。撞机双方都受伤。 ──────────────────────
  // 无敌帧内撞机只伤敌机不死玩家 —— 这是对「刚受伤」的正面补偿，不是漏洞。
  for (const e of w.enemies.items) {
    if (!e.alive || !p.alive) continue;
    if (circleHit(e.x, e.y, e.r, p.x, p.y, p.radius)) {
      const wasInvuln = p.invuln > 0;
      damageEnemy(w, e, 3);
      if (!wasInvuln && p.alive) hitPlayer(w, 'crash');
    }
  }
}

export function damageEnemy(w, e, dmg) {
  if (!e.alive) return false;
  e.hp -= dmg;
  e.flash = 1;
  if (e.hp > 0) return false;
  killEnemy(w, e);
  return true;
}

export function killEnemy(w, e) {
  const def = ENEMY_DEFS[e.type];
  const gain = addKill(w.score, def.score);
  w.enemies.kill(e);
  w.stats.kills = w.score.kills;

  w.events.push({
    type: 'enemyDie', x: e.x, y: e.y, etype: e.type, r: e.r, gain, combo: w.score.combo,
  });

  const heavy = def.cost >= 5; // 坦克 / 精英
  w.fx.shake = Math.max(w.fx.shake, heavy ? FX.shakeElite : FX.shakeKill);
  // ★ 时间缩放只给重击，且**带冷却门闩**。普通击杀完全不碰 timeScale ——
  //   详见 config.js：每次击杀都触发时实测 35% 的时间在慢动作里，
  //   只留给重击仍有 19.5%，所以慢动作要当"稀有奖励"而不是"每次都有的反馈"。
  if (heavy && w.fx.slowmo <= 0 && w.fx.slowmoCd <= 0) {
    w.fx.slowmo = FX.slowmoHeavy;
    w.fx.slowmoCd = FX.slowmoCooldown;
  }

  rollLoot(w.drops, e.x, e.y, w.rng, e.type === 'elite');
}

export function damageBoss(w, dmg) {
  const b = w.boss;
  if (!b || b.dying) return;
  b.hp -= dmg;
  b.flash = 0.7;
  if (b.hp > 0) return;

  b.hp = 0;
  b.dying = true;
  b.deathT = 0;
  w.stats.bossKills += 1;
  const gain = addRaw(w.score, bossScore(b.wave));
  w.eBullets.clearEnemy();
  w.fx.shake = Math.max(w.fx.shake, FX.shakeBossDie);
  w.fx.flash = FX.flashBossDie;
  w.fx.slowmo = Math.max(w.fx.slowmo, FX.slowmoBossDie);
  w.director.pendingAdvance = 1.8;
  w.events.push({ type: 'bossDie', x: b.x, y: b.y, gain, wave: b.wave });
}

export function hitPlayer(w, cause) {
  const p = w.player;
  if (!p.alive || p.invuln > 0) return false;

  if (p.shield) {
    p.shield = false;
    p.invuln = PLAYER.invuln * 0.7;
    breakCombo(w.score);
    w.events.push({ type: 'shieldBreak', x: p.x, y: p.y });
    return true;
  }

  p.hp -= 1;
  p.invuln = PLAYER.invuln;
  p.hitFlash = 1;
  breakCombo(w.score);
  w.fx.shake = Math.max(w.fx.shake, FX.shakePlayerHit);
  w.fx.flash = FX.flashPlayerHit;
  clearBulletsNear(w, p.x, p.y, PLAYER.hitClearRadius);
  w.events.push({ type: 'playerHit', x: p.x, y: p.y, hp: p.hp, cause });

  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    w.phase = PHASE.OVER;
    w.overT = 0;
    // 死亡慢动作。注意它按**模拟时间**消耗，而模拟时间又被自己拉慢 0.35×，
    // 所以 0.8s 的慢动作 ≈ 2.3s 真实时间 —— 结算面板出现前的总等待由它决定。
    w.fx.slowmo = Math.max(w.fx.slowmo, FX.slowmoPlayerDeath);
    w.events.push({ type: 'death', x: p.x, y: p.y, wave: w.director.wave });
  } else if (w.fx.slowmo <= 0) {
    w.fx.slowmo = FX.slowmoPlayerHit;
  }
  return true;
}

/** 受伤时清掉附近的敌方子弹：防「一发中弹 → 撞进第二发」的连续死亡 */
export function clearBulletsNear(w, x, y, radius) {
  const f = w.eBullets;
  const r2 = radius * radius;
  for (let i = 0; i < f.cap; i++) {
    if (!f.alive[i] || f.kind[i] === KIND.PLAYER) continue;
    const dx = f.x[i] - x;
    const dy = f.y[i] - y;
    if (dx * dx + dy * dy <= r2) f.kill(i);
  }
}

export function collectDrop(w, d) {
  if (d.kind === DROP.COIN) {
    addRaw(w.score, d.value);
    w.stats.coins += 1;
    w.events.push({ type: 'coin', x: d.x, y: d.y, value: d.value });
    return;
  }
  applyPower(w, d.ptype, d.x, d.y);
}

export function applyPower(w, ptype, x, y) {
  const p = w.player;
  w.stats.powers += 1;

  if (ptype === 'bomb') {
    w.eBullets.clearEnemy();
    const removed = w.enemies.clearSmall(4);
    w.fx.shake = Math.max(w.fx.shake, FX.shakePlayerHit);
    w.fx.flash = Math.max(w.fx.flash, 0.35);
    w.events.push({ type: 'bomb', x, y, removed });
    return;
  }

  grantPower(p, ptype);
  w.events.push({ type: 'pickup', x, y, ptype });
}

/** 自检用：判断一个点是否落在游戏区内 */
export function inField(x, y) {
  return x >= 0 && x <= FIELD_W && y >= -80 && y <= FIELD_H + 80;
}
