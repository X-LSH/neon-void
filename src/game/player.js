/**
 * 玩家。判定半径远小于视觉体积 —— 方向对玩家有利，但**必须被画出来**
 * （发光内核点），否则受伤不可归因（SPEC §8）。
 */

import { PLAYER, FIELD_W, FIELD_H, POWER } from './config.js';
import { applyTouch, approach, clamp } from '../core/touch.js';
import { KIND } from './bullets.js';

export function createPlayer() {
  return {
    x: PLAYER.startX,
    y: PLAYER.startY,
    px: PLAYER.startX,
    py: PLAYER.startY,
    vx: 0,
    vy: 0,
    /**
     * 判定半径必须挂在玩家对象上。
     * 曾经只在 PLAYER 常量上，结果碰撞与拾取代码里的 `p.radius` 是 undefined，
     * `p.radius + eb.rad[i]` = NaN 让所有 `<= r*r` 比较恒为 false ——
     * 玩家对子弹、撞机、掉落全部免疫，而**没有任何报错**。
     * 这类「NaN 让判定静默失效」是最难查的一类 bug，因此断言里有一条
     * 专门检查玩家判定半径是有限正数。
     */
    radius: PLAYER.radius,
    hp: PLAYER.hitPoints,
    maxHp: PLAYER.hitPoints,
    shield: false,
    invuln: 0,
    fireT: 0,
    muzzle: 0,
    hitFlash: 0,
    t: 0,
    alive: true,
    powers: { spread: 0, magnet: 0, speed: 0 },
  };
}

export function resetPlayer(p) {
  p.x = PLAYER.startX;
  p.y = PLAYER.startY;
  p.px = p.x;
  p.py = p.y;
  p.vx = 0;
  p.vy = 0;
  p.hp = PLAYER.hitPoints;
  p.shield = false;
  p.invuln = PLAYER.invuln * 1.6; // 开局给一点缓冲，避免生成瞬间被压死的运气局
  p.fireT = 0;
  p.muzzle = 0;
  p.hitFlash = 0;
  p.t = 0;
  p.alive = true;
  p.powers.spread = 0;
  p.powers.magnet = 0;
  p.powers.speed = 0;
}

export function hasPower(p, name) {
  return p.powers[name] > 0;
}

export function grantPower(p, name) {
  if (!(name in POWER)) return;
  if (name === 'shield') {
    p.shield = true;
    return;
  }
  if (name === 'bomb') return; // 即时生效，不进入计时器
  p.powers[name] = POWER[name];
}

function fire(p, ctx) {
  const y = p.y - PLAYER.bodyH / 2 + 2;
  const sp = PLAYER.bulletSpeed;
  const r = PLAYER.bulletR;
  const life = PLAYER.bulletLife;

  if (p.powers.spread > 0) {
    for (const a of [-PLAYER.spreadAngle, 0, PLAYER.spreadAngle]) {
      ctx.pb.spawn(p.x, y, Math.sin(a) * sp, -Math.cos(a) * sp, r, life, KIND.PLAYER);
    }
  } else {
    ctx.pb.spawn(p.x, y, 0, -sp, r, life, KIND.PLAYER);
  }
  p.muzzle = 0.07;
}

export function stepPlayer(p, intent, dt, ctx) {
  p.px = p.x;
  p.py = p.y;
  p.t += dt;

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  if (p.muzzle > 0) p.muzzle = Math.max(0, p.muzzle - dt);
  if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 4);
  for (const k of ['spread', 'magnet', 'speed']) {
    if (p.powers[k] > 0) p.powers[k] = Math.max(0, p.powers[k] - dt);
  }

  const speedMul = p.powers.speed > 0 ? PLAYER.speedMul : 1;

  if (intent.pointer.active) {
    // 触屏：绝对定位 + 纵向偏移（飞船浮在手指上方，不被拇指盖住）
    const target = applyTouch(intent.pointer.x, intent.pointer.y, FIELD_W, FIELD_H, p.radius);
    const before = { x: p.x, y: p.y };
    p.x = approach(p.x, target.x, 40, dt);
    p.y = approach(p.y, target.y, 40, dt);
    p.vx = dt > 0 ? (p.x - before.x) / dt : 0;
    p.vy = dt > 0 ? (p.y - before.y) / dt : 0;
  } else {
    const wantX = intent.move.x * PLAYER.speed * speedMul;
    const wantY = intent.move.y * PLAYER.speed * speedMul;
    p.vx = approach(p.vx, wantX, PLAYER.accelRate, dt);
    p.vy = approach(p.vy, wantY, PLAYER.accelRate, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  const m = p.radius + 6;
  p.x = clamp(p.x, m, FIELD_W - m);
  p.y = clamp(p.y, m, FIELD_H - m);

  if (ctx.canFire) {
    p.fireT -= dt;
    if (p.fireT < -0.5) p.fireT = 0;
    while (p.fireT <= 0) {
      p.fireT += PLAYER.fireInterval;
      fire(p, ctx);
      ctx.onShoot(p);
    }
  } else {
    p.fireT = 0;
  }
}
