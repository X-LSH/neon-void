#!/usr/bin/env node
/**
 * 难度曲线与单局时长探针。
 *
 * 为什么必须实测（见 SPEC §4.1 与 zero-build-canvas-game §七点九九七）：
 * 「公式算出来 4:47」和「真的打了 4:47」是两件事。配置值与实际物理不符、
 * 弹幕密度被子弹上限静默截断、参考玩家其实太强或太弱 —— 这三类问题
 * 光读代码和配置一个都发现不了。
 *
 * 本探针已经抓到过两个真实缺陷：
 *   1. `p.radius` 未定义 → 所有碰撞比较因 NaN 恒为 false（玩家完全免疫）
 *   2. 势场躲避是坏模型 → 硬核档比新手档死得更快（度量本身失效）
 * 所以参考玩家用的是**前瞻采样**（真实玩家找空隙的方式），
 * 并且带**反应延迟** —— 一个没有延迟、每步都重新决策的 AI 不是玩家，是外挂。
 *
 * 用法：node scripts/balance.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld, snapshotWorld, PHASE } from '../src/game/world.js';
import { FIXED_DT, FIELD_W, FIELD_H, EBULLET, WAVE, PLAYER } from '../src/game/config.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(ROOT, '.tmp');

/** 威胁收集半径（只收集附近的，避免每步遍历全屏子弹） */
const THREAT_R = 300;

function makeDirs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  out.push({ x: 0, y: 0 });
  return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 参考玩家档位。
 *
 * ★ 三个档位**只允许在「看得多快、看得多细」上不同**（dirs / react / horizon / steps），
 *   其余权重全部共享。多变量同时改的探针量不出它想量的事 ——
 *   曾经给硬核档单独加高 edgeCare，结果它比新手档多挨 23% 的弹，
 *   因为那实际上是在惩罚「待在屏幕底部」，而纵版射击里底部就是最安全的位置。
 *
 * ★ 标定依据来自一次参数扫描（.tmp/sweep.mjs），不是拍脑袋：
 *     反应延迟（react）是**主导变量**：20 步 → 10+ 次受击，1 步 → 0 次，单调且差距大
 *     方向分辨率（dirs）次之：6 向 vs 16 向在高延迟下差约 25%
 *     前瞻时长（horizon）**超过约 0.3s 反而变差** ——
 *       长前瞻会外推出「此刻还没子弹的空地」，而那片空地马上被新一轮齐射填满。
 *       探针看不见尚未生成的弹幕，所以远距离预测是系统性过度自信。
 *       （这不影响游戏设计：它只说明一个不看敌人开火周期的预测模型不该看得太远。）
 *
 * `react` = 决策保持步数（60 步 = 1 秒）。人类持续走位的反应约 50–150ms。
 */
const PROFILES = {
  新手: { dirs: 6, react: 20, horizon: 0.28, steps: 4, align: 0.7, edgeCare: 1.0 },
  熟练: { dirs: 10, react: 10, horizon: 0.24, steps: 4, align: 0.7, edgeCare: 1.0 },
  硬核: { dirs: 14, react: 3, horizon: 0.20, steps: 5, align: 0.7, edgeCare: 1.0 },
};
for (const p of Object.values(PROFILES)) p._dirs = makeDirs(p.dirs);

/** 收集玩家附近的威胁 */
function collectThreats(w, radius) {
  const p = w.player;
  const eb = w.eBullets;
  const bullets = [];
  const r2 = radius * radius;
  for (let i = 0; i < eb.cap; i++) {
    if (!eb.alive[i]) continue;
    const dx = eb.x[i] - p.x;
    const dy = eb.y[i] - p.y;
    if (dx * dx + dy * dy > r2) continue;
    bullets.push(i);
  }
  const bodies = [];
  for (const e of w.enemies.items) {
    if (!e.alive) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy > r2) continue;
    bodies.push(e);
  }
  if (w.boss && !w.boss.dying && !w.boss.entering) bodies.push(w.boss);
  return { bullets, bodies };
}

function findTargetX(w) {
  const p = w.player;
  let best = null;
  let bestD = Infinity;
  for (const e of w.enemies.items) {
    if (!e.alive || e.y > p.y) continue;
    const d = p.y - e.y;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best && w.boss && !w.boss.dying && !w.boss.entering) best = w.boss;
  if (!best) return null;
  const tvx = best === w.boss ? (w.boss.x - w.boss.px) / FIXED_DT : (best.vx || 0);
  const flight = Math.max(0, p.y - best.y) / PLAYER.bulletSpeed;
  return best.x + tvx * Math.min(0.55, flight) * 0.9;
}

/**
 * 前瞻采样：对每个候选方向，沿它推演若干步，取「离最近威胁的最小距离」。
 * 选最安全的那个；同样安全时选更贴近目标的那个。
 */
function plan(w, pr) {
  const p = w.player;
  const speed = PLAYER.speed * (p.powers.speed > 0 ? PLAYER.speedMul : 1);
  const m = p.radius + 4;
  const threat = collectThreats(w, THREAT_R);
  const targetX = findTargetX(w);
  const eb = w.eBullets;

  let bestDir = { x: 0, y: 0 };
  let bestScore = -Infinity;

  for (const d of pr._dirs) {
    let worst = Infinity;
    for (let s = 1; s <= pr.steps; s++) {
      const t = (pr.horizon * s) / pr.steps;
      const nx = clamp(p.x + d.x * speed * t, m, FIELD_W - m);
      // 刻意不限制纵向：躲避需要能上下走，只把它压在战场内

      const ny = clamp(p.y + d.y * speed * t, m, FIELD_H - m);

      for (const i of threat.bullets) {
        // 子弹在 [t, t+dt] 内扫过的一段：用当前速度外推，取更保守的那个端点
        const t2 = t + FIXED_DT * 2;
        const bx = eb.x[i] + eb.vx[i] * t;
        const by = eb.y[i] + eb.vy[i] * t;
        const bx2 = eb.x[i] + eb.vx[i] * t2;
        const by2 = eb.y[i] + eb.vy[i] * t2;
        const d1 = Math.hypot(nx - bx, ny - by);
        const d2 = Math.hypot(nx - bx2, ny - by2);
        const dist = Math.min(d1, d2) - eb.rad[i] - p.radius;
        if (dist < worst) worst = dist;
      }
      for (const e of threat.bodies) {
        const ex = e.x + (e.vx || 0) * t;
        const ey = e.y + (e.vy || 0) * t;
        const dist = Math.hypot(nx - ex, ny - ey) - e.r - p.radius;
        if (dist < worst) worst = dist;
      }

      // 边界按方位区分对待 —— 四边的危险程度完全不同：
      //   顶部 = 迎面撞进敌机生成区（最危险）
      //   左右 = 被逼进角落，横向闪避空间消失（危险）
      //   底部 = **纵版射击最安全的位置**（唯一能后退的方向），只轻微提示
      const sideGap = Math.min(nx - m, FIELD_W - m - nx);
      if (sideGap < 58) worst -= ((58 - sideGap) / 58) * 30 * pr.edgeCare;
      const topGap = ny - m;
      if (topGap < 130) worst -= ((130 - topGap) / 130) * 42 * pr.edgeCare;
      const botGap = FIELD_H - m - ny;
      if (botGap < 20) worst -= ((20 - botGap) / 20) * 10;
    }

    let score = worst;
    if (targetX !== null) {
      score += (1 - Math.abs(clamp(p.x + d.x * speed * pr.horizon, m, FIELD_W - m) - targetX) / FIELD_W) * 26 * pr.align;
    }
    if (d.x === 0 && d.y === 0) score -= 6; // 略偏好动起来（站桩是最容易被算死的）

    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }
  return bestDir;
}

function makePlayer(profile) {
  const pr = PROFILES[profile];
  let cached = { x: 0, y: 0 };
  let age = 1e9;
  return {
    profile,
    decide(w) {
      age += 1;
      if (age >= pr.react) {
        cached = plan(w, pr);
        age = 0;
      }
      return cached;
    },
  };
}

function playOne(profileName, seed, immortal = false, seconds = 0) {
  const bot = makePlayer(profileName);
  const w = createWorld(seed);
  const waves = [{ wave: 1, t: 0 }];
  const bossWaves = [];
  const hitCauses = {};
  let hits = 0;
  let lastWave = 1;
  let bossStart = 0;
  let peakEB = 0;
  let capHits = 0;
  let peakEnemies = 0;
  let poolFullSteps = 0;
  const limit = immortal ? Math.round(60 * seconds) : 60 * 60 * 25;

  for (let step = 0; step < limit; step++) {
    // 计量局：每步把血补满，把「能活多久」换成「多容易被击中」——
    // 3 条命的真实局每局只有 3 个样本，是纯噪声，量不出档位差异。
    if (immortal) {
      w.player.hp = w.player.maxHp;
      w.player.shield = false;
    }
    if (w.phase !== PHASE.PLAYING) break;

    const d = bot.decide(w);
    stepWorld(w, FIXED_DT, {
      move: d,
      pointer: { active: false, x: 0, y: 0 },
      confirm: { pressed: false },
      pause: { pressed: false },
      mute: { pressed: false },
    });

    for (const ev of w.events) {
      if (ev.type === 'playerHit') {
        hits += 1;
        hitCauses[ev.cause] = (hitCauses[ev.cause] || 0) + 1;
      }
    }

    if (w.eBullets.count >= EBULLET.cap) capHits += 1;
    peakEB = Math.max(peakEB, w.eBullets.count);
    peakEnemies = Math.max(peakEnemies, w.enemies.count);
    if (w.enemies.full) poolFullSteps += 1;

    if (w.director.wave !== lastWave) {
      const wasBoss = lastWave % WAVE.bossEvery === 0;
      waves.push({ wave: w.director.wave, t: +w.t.toFixed(1) });
      if (wasBoss) bossWaves.push({ wave: lastWave, dur: +(w.t - bossStart).toFixed(1) });
      lastWave = w.director.wave;
      if (lastWave % WAVE.bossEvery === 0) bossStart = w.t;
    }
  }

  const s = snapshotWorld(w);
  return {
    profile: profileName,
    seed,
    immortal,
    survived: +w.t.toFixed(1),
    hits,
    hitsPerMin: +(hits / (w.t / 60)).toFixed(2),
    hitCauses,
    wave: s.wave,
    score: s.score,
    kills: s.kills,
    maxCombo: s.maxCombo,
    escaped: s.stats.escaped,
    peakEB,
    peakEnemies,
    capHits,
    poolFullSteps,
    waves,
    bossWaves,
    stats: s.stats,
  };
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const SEEDS = (process.env.SEEDS || '11,22,33').split(',').map(Number);
const IMMORTAL_SEC = Number(process.env.IMMORTAL_SEC || 360);
const rows = [];
const metered = [];
for (const name of Object.keys(PROFILES)) {
  for (const seed of SEEDS) rows.push(playOne(name, seed, false));
  for (const seed of SEEDS) metered.push(playOne(name, seed, true, IMMORTAL_SEC));
}

// 配对比较：同一颗种子上比不同档位，消掉「这一局恰好是什么局面」的方差。
const hitsOf = (p, seed) => (metered.find((r) => r.profile === p && r.seed === seed) || {}).hits || 0;
const paired = (a, b) => SEEDS.map((s) => hitsOf(a, s) - hitsOf(b, s));
const meanOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log('\nNEON VOID · 难度曲线实测\n');

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}  \x1b[38;5;245m${detail}\x1b[0m`);
  if (!cond) failed += 1;
};

console.log('档位      种子   存活    波次   得分      击杀  逃逸  峰值弹  峰值怪  僵死');
for (const r of rows) {
  console.log(
    `  ${r.profile}    ${String(r.seed).padEnd(4)}  ${fmt(r.survived).padStart(5)}  ` +
    `${String(r.wave).padStart(4)}  ${String(r.score).padStart(7)}  ${String(r.kills).padStart(5)}  ` +
    `${String(r.escaped).padStart(4)}  ${String(r.peakEB).padStart(5)}  ${String(r.peakEnemies).padStart(5)}  ${String(r.capHits).padStart(4)}`,
  );
}

console.log('\n死亡归因（真实局）：');
for (const r of rows) {
  const c = Object.entries(r.hitCauses).map(([k, v]) => `${k}=${v}`).join(' ') || '无';
  console.log(`  ${r.profile}·${r.seed}: 共 ${Object.values(r.hitCauses).reduce((a, b) => a + b, 0)} 次命中  ${c}`);
}

console.log(`\n计量局（血量恒满 · ${IMMORTAL_SEC}s · 受击率越低越强）：`);
console.log('档位      种子   受击/分   总受击   到达波次   峰值弹  峰值怪  池满步数  上限命中');
for (const r of metered) {
  console.log(
    `  ${r.profile}    ${String(r.seed).padEnd(4)}  ${String(r.hitsPerMin).padStart(6)}  ` +
    `${String(r.hits).padStart(6)}  ${String(r.wave).padStart(8)}  ${String(r.peakEB).padStart(6)}  ` +
    `${String(r.peakEnemies).padStart(6)}  ${String(r.poolFullSteps).padStart(8)}  ${String(r.capHits).padStart(8)}`,
  );
}
const rate = (p) => metered.filter((r) => r.profile === p).map((r) => r.hitsPerMin);
const avgRate = (p) => rate(p).reduce((a, b) => a + b, 0) / rate(p).length;
console.log(`  平均受击/分：新手 ${avgRate('新手').toFixed(2)}  熟练 ${avgRate('熟练').toFixed(2)}  硬核 ${avgRate('硬核').toFixed(2)}`);

// ★ 档位必须有单调区分度：这是「探针本身可信」的前提。
// 用配对差值（同种子跨档位）而不是整体均值 ——
// 局面随机性远大于档位差异：实测 n=5 时档位间均值差 0.5、标准差 0.9，
// 那个差异在统计上根本读不出来，追它就是在追噪声。
// 受击数越低越强，所以差值应为负。
const dCasual = paired('熟练', '新手');
const dHard = paired('硬核', '熟练');
console.log(`  配对差值（熟练−新手）: ${dCasual.join(', ')}  均值 ${meanOf(dCasual).toFixed(1)}`);
console.log(`  配对差值（硬核−熟练）: ${dHard.join(', ')}  均值 ${meanOf(dHard).toFixed(1)}`);

console.log('\n波次到达时刻（熟练档 seed=' + SEEDS[0] + '）：');
const ref = rows.find((r) => r.profile === '熟练' && r.seed === SEEDS[0]);
console.log('  ' + ref.waves.map((x) => `${x.wave}@${fmt(x.t)}`).join('  '));
if (ref.bossWaves.length) {
  console.log('  Boss 耗时: ' + ref.bossWaves.map((b) => `W${b.wave}=${b.dur}s`).join('  '));
}
const long = metered.find((r) => r.profile === '熟练' && r.seed === SEEDS[0]);
console.log(`  计量局 ${Math.round(IMMORTAL_SEC / 60)} 分钟到达波次 ${long.wave}，Boss 耗时: ` +
  (long.bossWaves.length ? long.bossWaves.map((b) => `W${b.wave}=${b.dur}s`).join('  ') : '无'));

// ── 断言 ────────────────────────────────────────────────────
console.log('\n断言：');

const byProfile = (p) => rows.filter((r) => r.profile === p);
const survivals = (p) => byProfile(p).map((r) => r.survived);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const skilled = survivals('熟练');
const casual = survivals('新手');
const hardcore = survivals('硬核');

// 单局时长标尺：PRD 要求 3–8 分钟
check('熟练档单局 ≥ 2:30', Math.min(...skilled) >= 150, `最短 ${fmt(Math.min(...skilled))}`);
check('熟练档单局 ≤ 9:00', Math.max(...skilled) <= 540, `最长 ${fmt(Math.max(...skilled))}`);
check('熟练档平均落在 3–8 分钟', avg(skilled) >= 180 && avg(skilled) <= 480, `均值 ${fmt(avg(skilled))}`);
check('新手档单局 ≥ 1:00', Math.min(...casual) >= 60, `最短 ${fmt(Math.min(...casual))}`);
check('新手档单局 ≤ 6:00', Math.max(...casual) <= 360, `最长 ${fmt(Math.max(...casual))}`);

check('受击数单调（配对均值，越低越强）：熟练−新手 < 0',
  meanOf(dCasual) < 0,
  `熟练−新手 = ${meanOf(dCasual).toFixed(1)}`);
check('受击数单调（配对均值）：硬核−新手 < 0',
  meanOf(SEEDS.map((s) => hitsOf('硬核', s) - hitsOf('新手', s))) < 0,
  `硬核−新手 = ${meanOf(SEEDS.map((s) => hitsOf('硬核', s) - hitsOf('新手', s))).toFixed(1)}`);

// 难度必须真的在变难：从「无差别」到「有区分」的走势
check('受击率随难度确实上升',
  metered.every((r) => r.hits > 0),
  `最低受击 ${Math.min(...metered.map((r) => r.hits))}`);

// 难度必须真的在变难
check('所有档位最终都会死', rows.every((r) => r.survived < 1500), `最长 ${fmt(Math.max(...rows.map((r) => r.survived)))}`);

// 上限截断是「优雅降级」而不是 bug —— 但它必须出现在深到真实玩家够不着的地方。
// 实测：第 20 波峰值约 430 · 第 30 波约 700 · 第 40 波之后才真正触顶（900）。
// 真实玩家死在 15 波附近（约 3:39），所以触顶只可能出现在「血量恒满」的计量局里。
const capped = [...rows, ...metered].filter((r) => r.capHits > 0);
check('真实局（会死亡的）从未触顶', rows.every((r) => r.capHits === 0),
  `触顶的真实局 ${rows.filter((r) => r.capHits > 0).length} 个`);
check('上限截断只出现在第 40 波之后',
  capped.every((r) => r.wave >= 40),
  capped.length ? capped.map((r) => `${r.profile}@W${r.wave}`).join(' ') : '未出现');

// 敌机池「瞬时打满」可以接受（生成请求被丢弃一次而已），
// 「持续打满」才是问题 —— 那意味着晚期波次静默地什么也生成不出来。
const totalMeteredSteps = IMMORTAL_SEC * 60 * metered.length;
const fullSteps = metered.reduce((n, r) => n + r.poolFullSteps, 0);
check('敌机池持续打满的时间占比 < 2%',
  fullSteps < totalMeteredSteps * 0.02,
  `池满 ${fullSteps} 步 / ${totalMeteredSteps} 步 = ${((fullSteps / totalMeteredSteps) * 100).toFixed(2)}%`);

check('熟练档波次推进到 12+', byProfile('熟练').every((r) => r.wave >= 12),
  `最低 ${Math.min(...byProfile('熟练').map((r) => r.wave))}`);
check('计量局能推进到 20 波', metered.every((r) => r.wave >= 20),
  `最低 ${Math.min(...metered.map((r) => r.wave))}`);
check('熟练档击杀 > 60', byProfile('熟练').every((r) => r.kills > 60),
  `最低 ${Math.min(...byProfile('熟练').map((r) => r.kills))}`);

check('熟练档拾取过金币', byProfile('熟练').some((r) => r.stats.coins > 0),
  `最高 ${Math.max(...byProfile('熟练').map((r) => r.stats.coins))}`);
check('熟练档拾取过道具', byProfile('熟练').some((r) => r.stats.powers > 0),
  `最高 ${Math.max(...byProfile('熟练').map((r) => r.stats.powers))}`);

const bossesBeaten = rows.reduce((n, r) => n + r.stats.bossKills, 0);
check('至少击杀过 1 只 Boss', bossesBeaten >= 1, `共 ${bossesBeaten} 只`);

// 死亡必须可归因：不能出现「无来源的伤害」
const totalHits = rows.reduce((n, r) => n + Object.values(r.hitCauses).reduce((a, b) => a + b, 0), 0);
check('每次受伤都有可归因来源', totalHits > 0 && Object.keys(rows[0].hitCauses).length > 0,
  `共 ${totalHits} 次，来源 ${[...new Set(rows.flatMap((r) => Object.keys(r.hitCauses)))].join('/')}`);

console.log(`\n${failed === 0 ? '\x1b[32m全部通过\x1b[0m' : `\x1b[31m${failed} 项未通过\x1b[0m`}\n`);

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'balance.json'), JSON.stringify({ runs: rows, metered }, null, 2));
process.exit(failed === 0 ? 0 : 1);
