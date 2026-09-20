#!/usr/bin/env node
/**
 * Node 裸跑自检。不需要浏览器。
 *
 * 为什么这一层存在（SPEC §12）：`game/` 不碰 DOM 不是洁癖，
 * 而是让物理不变量能在毫秒级被断言 —— 「不穿透」「确定性」「难度单调」
 * 这些事在浏览器里只能靠肉眼看，在这里可以跑上万次。
 *
 * 用法：node scripts/verify.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 去掉注释再做源码级检查 —— 否则「文档里提到 Math.random()」会被误判成使用它 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// 被测模块统一在这里导入：后面的分组会互相引用彼此的解构结果，
// 把 import 散落在各组里会在执行到某组时踩 TDZ（const 未初始化）。
const CFG = await import('../src/game/config.js');
const WAVE = await import('../src/game/wave.js');
const ENEMIES = await import('../src/game/enemies.js');
const COLLIDE = await import('../src/game/collision.js');
const BOSS = await import('../src/game/boss.js');
const TOUCH = await import('../src/core/touch.js');
const BULLETS = await import('../src/game/bullets.js');
const SCORE = await import('../src/game/score.js');
const DROPS = await import('../src/game/drops.js');
const RNG = await import('../src/core/rng.js');
const ST = await import('../src/core/storage.js');

let passed = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[38;5;245m${detail}\x1b[0m` : ''}\n`);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}  \x1b[31m${detail}\x1b[0m\n`);
  }
}
const section = (t) => process.stdout.write(`\n\x1b[36m${t}\x1b[0m\n`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(resolve(ROOT, 'src'));
const jsFiles = srcFiles.filter((f) => f.endsWith('.js'));
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const read = (f) => readFileSync(f, 'utf8');

// ══ 1. 语法 ═══════════════════════════════════════════════════
section('1. 语法');
{
  // ★ 本沙箱**完全禁止 spawn 子进程**（连 cmd.exe 都是 EBUSY），
  //   所以 `node --check` 这条路走不通。改用进程内动态 import：
  //   它既解析又加载，比 --check 更强 —— 顺带覆盖了模块顶层的执行错误。
  //
  //   唯一例外是 main.js：它在模块顶层访问 DOM，加载必然失败。
  //   用「失败类型」区分它：**SyntaxError 才算语法错误**，DOM 缺失不算。
  const syntaxBad = [];
  const loadBad = [];
  const domOnly = [];
  for (const f of jsFiles) {
    try {
      await import(pathToFileURL(f).href);
    } catch (e) {
      const name = rel(f);
      if (e instanceof SyntaxError) syntaxBad.push(`${name}: ${e.message}`);
      else if (name === 'src/main.js' && /document|window|navigator|is not defined/.test(e.message)) {
        domOnly.push(name);
      } else loadBad.push(`${name}: ${e.message}`);
    }
  }
  ok('全部源文件语法正确（逐文件 —— 入口的 --check 不跟随 import）',
    syntaxBad.length === 0, syntaxBad.slice(0, 2).join('  |  ') || `${jsFiles.length} 个文件`);
  ok('除 main.js 外全部模块可在 Node 裸加载（证明 game/render/ui 都不依赖 DOM）',
    loadBad.length === 0, loadBad.slice(0, 2).join('  |  '));
  ok('只有 main.js 因为需要 DOM 而无法裸加载（这是设计，不是缺陷）',
    domOnly.length === 1, domOnly.join(' '));

  // scripts/ 没法 import（它们会在导入时就跑起来：起服务器 / 起 Chrome / 递归）。
  // 它们的语法由「能不能被真的运行」覆盖 —— 这一层无法替代那一次运行。
  const pkg = JSON.parse(read(resolve(ROOT, 'package.json')));
  const declared = Object.values(pkg.scripts || {}).join(' ');
  const scriptFiles = readdirSync(resolve(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs'));
  const unwired = scriptFiles.filter((f) => !declared.includes(f));
  ok('全部 scripts/*.mjs 都挂在 package.json 的 npm script 上（不会变成没人跑的死代码）',
    unwired.length === 0, unwired.join(' '));
}

// ══ 2. 文件规模 ═══════════════════════════════════════════════
section('2. 文件规模（一条没有断言的规则等于没有规则）');
{
  const LIMIT = 300;
  const rows = jsFiles.map((f) => ({ f: rel(f), n: read(f).split('\n').length }));
  rows.sort((a, b) => b.n - a.n);
  const over = rows.filter((r) => r.n > LIMIT);
  ok(`src/ 单文件 ≤ ${LIMIT} 行`, over.length === 0,
    over.length ? over.map((r) => `${r.f}=${r.n}`).join(' ') : `最大 ${rows[0].f}=${rows[0].n} 行`);
  // scripts/ 是一串平铺断言，拆开只会更难读 —— 与规则要解决的问题正好相反
  const scriptRows = readdirSync(resolve(ROOT, 'scripts'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => ({ f, n: read(resolve(ROOT, 'scripts', f)).split('\n').length }));
  scriptRows.sort((a, b) => b.n - a.n);
  ok('scripts/ 不受行数限制（有意为之，不是漏检）', scriptRows.length > 0,
    `最大 ${scriptRows[0].f}=${scriptRows[0].n} 行`);
}

// ══ 3. 分层单向依赖 ═══════════════════════════════════════════
section('3. 分层单向依赖');
{
  const RULES = [
    ['game', ['render/', 'ui/', 'scenes/']],
    ['render', ['ui/', 'scenes/']],
    ['core', ['game/', 'render/', 'ui/', 'scenes/']],
  ];
  for (const [layer, forbids] of RULES) {
    const files = jsFiles.filter((f) => rel(f).startsWith(`src/${layer}/`));
    const bad = [];
    for (const f of files) {
      const src = read(f);
      for (const pat of [...src.matchAll(/from\s+'([^']+)'/g)]) {
        const target = pat[1];
        if (forbids.some((x) => target.includes(`/${x}`) || target.startsWith(x))) {
          bad.push(`${rel(f)} → ${target}`);
        }
      }
    }
    ok(`${layer}/ 不反向依赖 ${forbids.join(' ')}`, bad.length === 0, bad.join(' '));
  }

  // 全项目禁用 Math.random()：确定性是「可重放验证」的前提。
  // 先剥掉注释，否则「文档里提到 Math.random()」会被误判成使用它。
  const rnd = jsFiles.filter((f) => /Math\.random\s*\(/.test(stripComments(read(f)))).map(rel);
  ok('全项目禁用 Math.random()（用 core/rng.js 的确定性 PRNG）', rnd.length === 0, rnd.join(' '));

  // game/ 不得出现 DOM / Canvas / Audio 引用
  const domRefs = [];
  for (const f of jsFiles.filter((x) => rel(x).startsWith('src/game/'))) {
    const src = stripComments(read(f));
    for (const w of ['document.', 'window.', 'canvas', 'AudioContext', 'requestAnimationFrame']) {
      if (src.includes(w)) domRefs.push(`${rel(f)}:${w}`);
    }
  }
  ok('game/ 不引用 DOM / Canvas / Audio（这是它能在 Node 裸跑的前提）',
    domRefs.length === 0, domRefs.join(' '));
}

// ══ 4. 调色板无死token ═══════════════════════════════════════
section('4. 调色板');
{
  const palSrc = read(resolve(ROOT, 'src/render/palette.js'));
  const allSrc = jsFiles.map((f) => read(f)).join('\n');
  // 只取 PAL 对象自己花括号内的 key，别把 ENEMY_COLOR / POWER_COLOR 的键也算进来
  const palBody = palSrc.slice(palSrc.indexOf('export const PAL'), palSrc.indexOf('export const ENEMY_COLOR'));
  const keys = [...palBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  const unused = keys.filter((k) => !new RegExp(`PAL\\.${k}\\b`).test(allSrc));
  ok('PAL 每个 token 都被实际引用（这条抓过真实的 undefined 颜色 bug）',
    unused.length === 0, unused.join(' '));
  ok('PAL 至少有 15 个语义 token（太少说明颜色被写成了字面量）',
    keys.length >= 15, `${keys.length} 个`);

  const grabKeys = (name) => {
    const body = palSrc.slice(palSrc.indexOf(`export const ${name}`));
    return [...body.slice(0, body.indexOf('};')).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  };
  const eKeys = grabKeys('ENEMY_COLOR');
  // Boss 有独立模块、不在 ENEMY_DEFS 里，但同样需要一个颜色
  ok('ENEMY_COLOR 覆盖全部普通敌机类型 + Boss',
    ENEMIES.ENEMY_TYPES.every((k) => eKeys.includes(k)) && eKeys.includes('boss'),
    `${eKeys.join(',')} vs defs ${ENEMIES.ENEMY_TYPES.join(',')}`);
  ok('ENEMY_COLOR 没有多余的键（颜色表与类型表不会各说各话）',
    eKeys.every((k) => k === 'boss' || ENEMIES.ENEMY_TYPES.includes(k)), eKeys.join(','));
  const pKeys = grabKeys('POWER_COLOR');
  ok('POWER_COLOR 覆盖全部 5 种道具', pKeys.length === 5 && DROPS.POWER_TYPES.every((p) => pKeys.includes(p)),
    pKeys.join(','));

  // 渲染层不许出现字面量色相（调色板必须是唯一真相源）。
  // 纯白豁免：它是"闪光"而不是色相，且 `#ffffff` 在 Canvas 里没有语义歧义。
  const literal = [];
  for (const f of jsFiles.filter((x) => rel(x).startsWith('src/render/'))) {
    if (rel(f).endsWith('palette.js')) continue;
    const src = stripComments(read(f));
    const hits = [...src.matchAll(/['"]#[0-9a-fA-F]{3,8}['"]/g)]
      .map((m) => m[0])
      .filter((c) => !/^['"]#(?:fff|ffffff)['"]$/i.test(c));
    if (hits.length) literal.push(`${rel(f)}:${hits.join(',')}`);
  }
  ok('render/ 除 palette.js 外不出现字面量色相（纯白闪光豁免）',
    literal.length === 0, literal.join(' '));
}

// ══ 5. 难度曲线 ═══════════════════════════════════════════════
section('5. 难度曲线');
{
  const waves = Array.from({ length: 101 }, (_, i) => i + 1);
  const durs = waves.map(WAVE.waveDuration);
  const evs = waves.map(WAVE.waveEvents);
  const ramps = waves.map((w) => ENEMIES.ramps(w));

  ok('波次时长单调不增', durs.every((d, i) => i === 0 || d <= durs[i - 1]));
  ok('波次时长有下限', Math.min(...durs) === CFG.WAVE.minDuration, `min=${Math.min(...durs)}`);
  ok('每波事件数单调不减', evs.every((e, i) => i === 0 || e >= evs[i - 1]));
  ok('每波事件数有上界', Math.max(...evs) === CFG.WAVE.maxEvents, `max=${Math.max(...evs)}`);
  ok('敌机速度倍率单调不减且有上界',
    ramps.every((r, i) => i === 0 || r.speed >= ramps[i - 1].speed)
    && Math.max(...ramps.map((r) => r.speed)) <= 1 + CFG.WAVE.speedRampMax + 1e-9);
  ok('敌机血量倍率单调不减且有上界',
    ramps.every((r, i) => i === 0 || r.hp >= ramps[i - 1].hp)
    && Math.max(...ramps.map((r) => r.hp)) <= 1 + CFG.WAVE.hpRampMax + 1e-9);
  ok('开火间隔倍率单调不增且有下限',
    ramps.every((r, i) => i === 0 || r.fire <= ramps[i - 1].fire)
    && Math.min(...ramps.map((r) => r.fire)) >= CFG.WAVE.fireRampMin - 1e-9);

  // 可行性：事件数 × 最小间距不能超过波次时长，否则预算永远花不完（静默空场）
  const infeasible = waves.filter((w) => WAVE.waveEvents(w) * CFG.WAVE.spawnGapMin > WAVE.waveDuration(w));
  ok('每波的事件数在时长内放得下（否则预算静默花不完）',
    infeasible.length === 0, infeasible.length ? `波次 ${infeasible.slice(0, 5)}` : '全波次可行');

  // 解锁门槛必须递增且落在被观察的波次范围内
  const u = CFG.WAVE.unlock;
  ok('解锁门槛严格递增', u.striker < u.seeker && u.seeker < u.tank && u.tank < u.elite,
    JSON.stringify(u));

  // 权重：解锁前该类型权重必须不存在（否则前期就会出现后期敌机）
  let weightBad = [];
  for (const order of ['striker', 'seeker', 'tank', 'elite']) {
    const w = WAVE.typeWeights(u[order] - 1);
    if (order in w) weightBad.push(`${order}@w${u[order] - 1}`);
  }
  ok('敌机类型在解锁波次之前不出现在权重表里', weightBad.length === 0, weightBad.join(','));

  // 权重全部为正且有限
  let weightOk = true;
  for (let w = 1; w <= 100; w++) {
    const ws = WAVE.typeWeights(w);
    for (const [k, v] of Object.entries(ws)) {
      if (!Number.isFinite(v) || v <= 0) { weightOk = false; }
      if (!(k in ENEMIES.ENEMY_DEFS)) weightOk = false;
    }
  }
  ok('波次权重表全部为正有限值且类型都存在', weightOk);

  ok('Boss 每 10 波', CFG.WAVE.bossEvery === 10 && WAVE.isBossWave(10) && WAVE.isBossWave(30)
    && !WAVE.isBossWave(9));
  ok('Boss 血量随波次递增',
    BOSS.bossHp(10) < BOSS.bossHp(20) && BOSS.bossHp(20) < BOSS.bossHp(30),
    `${BOSS.bossHp(10)} / ${BOSS.bossHp(20)} / ${BOSS.bossHp(30)}`);
}

// ══ 6. 编队与生成位置 ═════════════════════════════════════════
section('6. 编队落点');
{
  const rng = (await import('../src/core/rng.js')).createRng(4242);
  let bad = [];
  let total = 0;
  for (const type of ENEMIES.ENEMY_TYPES) {
    const r = ENEMIES.ENEMY_DEFS[type].r + 10;
    for (let n = 1; n <= 5; n++) {
      for (let k = 0; k < 60; k++) {
        const spots = WAVE.formation(type, n, rng);
        if (spots.length !== n) bad.push(`${type} count ${spots.length}≠${n}`);
        for (const s of spots) {
          total += 1;
          if (s.x < r - 0.01 || s.x > CFG.FIELD_W - r + 0.01) bad.push(`${type} x=${s.x.toFixed(1)}`);
          if (s.y > 0) bad.push(`${type} 生成点在屏幕内 y=${s.y.toFixed(1)}`);
        }
      }
    }
  }
  ok('所有编队落点都在游戏区内且从屏幕外进入（否则玩家永远打不到）',
    bad.length === 0, bad.length ? bad.slice(0, 3).join(' ') : `${total} 个落点全部合法`);
}

// ══ 7. 碰撞：判定框不得超出视觉体积 ═══════════════════════════
section('7. 判定框与视觉体积');
{
  const P = CFG.PLAYER;
  const visual = COLLIDE.visualRadius(P.bodyW, P.bodyH);
  ok('玩家判定半径 ≤ 视觉外接圆', P.radius <= visual, `${P.radius} ≤ ${visual.toFixed(1)}`);
  ok('玩家判定半径是有限正数（NaN 会让全部碰撞静默失效）',
    Number.isFinite(P.radius) && P.radius > 0, String(P.radius));
  ok('Boss 判定比例 ≤ 1（贴棱角飞过不该死）',
    BOSS.BOSS_HIT_RATIO <= 1 && BOSS.BOSS_HIT_RATIO > 0.5, String(BOSS.BOSS_HIT_RATIO));
}

// ══ 8. 扫掠碰撞 ═══════════════════════════════════════════════
section('8. 扫掠碰撞');
{
  const rng = (await import('../src/core/rng.js')).createRng(777);
  // 参考实现：把线段密采样，任何一点落在圆内就算命中
  const reference = (x0, y0, x1, y1, cx, cy, r) => {
    const N = 3000;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) return true;
    }
    return false;
  };
  let mismatch = 0;
  let hits = 0;
  for (let i = 0; i < 4000; i++) {
    const x0 = rng.range(-40, 40);
    const y0 = rng.range(-40, 40);
    const x1 = x0 + rng.range(-20, 20);
    const y1 = y0 + rng.range(-20, 20);
    const cx = rng.range(-20, 20);
    const cy = rng.range(-20, 20);
    const r = rng.range(1, 14);
    const a = COLLIDE.segCircle(x0, y0, x1, y1, cx, cy, r);
    const b = reference(x0, y0, x1, y1, cx, cy, r);
    if (a) hits += 1;
    if (a !== b) mismatch += 1;
  }
  ok('扫掠检测与密采样参考实现逐例一致', mismatch === 0,
    `${4000} 例，命中 ${hits}，不一致 ${mismatch}`);

  // ★ 更强的断言：直接证明「不可能穿透」，而不是造一个穿透案例。
  // 穿透的条件是单步位移 ≥ 2 × 半径和。把每个「子弹 × 目标」配对的
  // 最坏值算出来，就能证明离散检测其实也不会漏 —— 扫掠是未来保险。
  const pairs = [];
  const stepOf = (speed) => speed * CFG.FIXED_DT;
  // 玩家子弹 → 敌机
  const minEnemyR = Math.min(...Object.values(ENEMIES.ENEMY_DEFS).map((d) => d.r));
  pairs.push({
    name: '玩家子弹→最小敌机',
    step: stepOf(CFG.PLAYER.bulletSpeed),
    span: 2 * (CFG.PLAYER.bulletR + minEnemyR),
  });
  // 敌方子弹 → 玩家
  let maxEB = 0;
  let maxEBr = 0;
  for (const d of Object.values(ENEMIES.ENEMY_DEFS)) {
    if (d.fire && d.fire.speed) { maxEB = Math.max(maxEB, d.fire.speed); maxEBr = Math.max(maxEBr, 3.6); }
  }
  maxEB = Math.max(maxEB, 205); // Boss P3 密集扇形
  pairs.push({ name: '敌方子弹→玩家', step: stepOf(maxEB), span: 2 * (maxEBr + CFG.PLAYER.radius) });
  // 敌机机体 → 玩家
  const maxBody = Math.max(...Object.values(ENEMIES.ENEMY_DEFS).map((d) => d.speed * (1 + CFG.WAVE.speedRampMax)));
  pairs.push({ name: '敌机机体→玩家', step: stepOf(maxBody), span: 2 * (minEnemyR + CFG.PLAYER.radius) });

  const tunnel = pairs.filter((p) => p.step >= p.span);
  ok('任何弹道单步位移 < 2×半径和（结构上不可能穿透）', tunnel.length === 0,
    pairs.map((p) => `${p.name} ${p.step.toFixed(1)}/${p.span.toFixed(1)}`).join('  '));
}

// ══ 9. 子弹场 ═════════════════════════════════════════════════
section('9. 子弹场');
{
  const f = BULLETS.createBulletField(16);
  for (let i = 0; i < 16; i++) f.spawn(i, i, 0, 0, 3, 5, BULLETS.KIND.ENEMY);
  ok('容量满时拒绝生成而不是扩容', f.spawn(0, 0, 0, 0, 3, 5, 0) === false && f.count === 16);
  ok('空闲栈与存活计数自洽', f.audit().consistent, JSON.stringify(f.audit()));
  f.kill(3);
  ok('回收后可以再生成', f.spawn(0, 0, 0, 0, 3, 5, 0) === true && f.count === 16);
  ok('回收后仍然自洽', f.audit().consistent);
  f.clear();
  ok('clear 之后全空且自洽', f.count === 0 && f.audit().consistent);

  // 越界与寿命回收
  const g = BULLETS.createBulletField(8);
  g.spawn(240, 360, 0, -900, 3, 10, 0);
  for (let i = 0; i < 120; i++) g.step(1 / 60);
  ok('飞出边界的子弹被回收（不会永久占位）', g.count === 0);
  g.spawn(240, 360, 0, 0, 3, 0.1, 0);
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  ok('寿命耗尽的子弹被回收', g.count === 0);
}

// ══ 10. 计分与连击 ════════════════════════════════════════════
section('10. 计分与连击');
{
  const s = SCORE.createScore();
  ok('首杀倍率为 1.0（连击奖励「连得住」而不是「开第一枪」）',
    SCORE.multiplier(1) === 1 && SCORE.addKill(s, 100) === 100, `gain=${SCORE.addKill.length}`);
  ok('倍率单调不减', Array.from({ length: 60 }, (_, i) => SCORE.multiplier(i + 1))
    .every((m, i, a) => i === 0 || m >= a[i - 1]));
  ok('倍率有上界', SCORE.multiplier(10000) === CFG.SCORE.comboMax, String(SCORE.multiplier(10000)));

  const s2 = SCORE.createScore();
  for (let i = 0; i < 10; i++) SCORE.addKill(s2, 100);
  ok('连击累积且记录最高连击', s2.combo === 10 && s2.maxCombo === 10 && s2.kills === 10);
  SCORE.stepScore(s2, CFG.SCORE.comboWindow + 0.01);
  ok('超过窗口自动断连', s2.combo === 0 && s2.comboT === 0);
  ok('断连不影响累计击杀与最高连击', s2.kills === 10 && s2.maxCombo === 10);

  const s3 = SCORE.createScore();
  for (let i = 0; i < 5; i++) SCORE.addKill(s3, 100);
  SCORE.breakCombo(s3);
  ok('受伤立即断连', s3.combo === 0);

  const s4 = SCORE.createScore();
  SCORE.stepScore(s4, 10);
  ok('存活加分按整数累加（不产生永远不落地的 0.2 浮点）',
    Number.isInteger(s4.score) && s4.score === CFG.SCORE.survivalPerSec * 10, `score=${s4.score}`);
}

// ══ 11. 掉落 ══════════════════════════════════════════════════
section('11. 掉落');
{
  const rng = (await import('../src/core/rng.js')).createRng(31337);
  const pool = DROPS.createDropPool(64);
  const kinds = new Set();
  let coins = 0;
  for (let i = 0; i < 4000; i++) {
    const before = pool.count;
    DROPS.rollLoot(pool, 100, 100, rng, false);
    if (pool.count > before) { coins += 1; }
    for (const d of pool.items) if (d.alive) kinds.add(d.kind === 1 ? d.ptype : 'coin');
    // 消费掉，避免池满后不再统计
    for (const d of pool.items) if (d.alive) pool.kill(d);
  }
  ok('普通击杀会掉金币', coins > 0, `${coins} 次掉落`);
  ok('掉落涵盖全部 5 种道具', DROPS.POWER_TYPES.every((p) => kinds.has(p)), [...kinds].join(','));

  const pool2 = DROPS.createDropPool(4);
  for (let i = 0; i < 10; i++) DROPS.rollLoot(pool2, 0, 0, rng, true);
  ok('掉落池满时拒绝生成而不是扩容', pool2.count === 4 && pool2.items.length === 4);
}

// ══ 12. 触屏几何 ══════════════════════════════════════════════
section('12. 触屏几何');
{
  const W = CFG.FIELD_W;
  const H = CFG.FIELD_H;
  const r = CFG.PLAYER.radius;
  ok('纵向偏移为负（飞船浮在手指上方，不被拇指盖住）', TOUCH.TOUCH_OFFSET_Y < 0,
    String(TOUCH.TOUCH_OFFSET_Y));
  // 四角可达：手指拖到屏幕外也应能到达游戏区四角
  const corners = [[-500, -500], [W + 500, -500], [-500, H + 500], [W + 500, H + 500]];
  let reach = [];
  for (const [cx, cy] of corners) {
    const t = TOUCH.applyTouch(cx, cy, W, H, r);
    reach.push(t.x >= r && t.x <= W - r && t.y >= r && t.y <= H - r);
  }
  ok('手指拖到视口外时四角仍可达（不会卡在边缘走不到）', reach.every(Boolean), reach.join(','));
  const mid = TOUCH.applyTouch(100, 600, W, H, r);
  ok('偏移量恒定', Math.abs(mid.y - (600 + TOUCH.TOUCH_OFFSET_Y)) < 1e-9, `y=${mid.y}`);
  ok('裁剪在游戏区内', mid.x >= r && mid.x <= W - r && mid.y >= r && mid.y <= H - r);

  // 客户端坐标 → 游戏区坐标 往返
  const vp = { ox: 420, oy: 0, scale: 1.25 };
  const rect = { left: 0, top: 0 };
  const f = TOUCH.clientToField(420 + 100 * 1.25, 0 + 200 * 1.25, rect, vp);
  ok('客户端坐标反算回游戏区坐标无损', Math.abs(f.x - 100) < 1e-9 && Math.abs(f.y - 200) < 1e-9,
    `(${f.x.toFixed(1)}, ${f.y.toFixed(1)})`);

  ok('指数逼近在不同帧率下收敛一致',
    Math.abs(TOUCH.approach(TOUCH.approach(0, 100, 26, 1 / 60), 100, 26, 1 / 60)
      - TOUCH.approach(0, 100, 26, 2 / 60)) < 1e-9);
}

// ══ 13. 存档 ══════════════════════════════════════════════════
section('13. 存档');
{
  const ST = await import('../src/core/storage.js');
  // 用假 localStorage 在 Node 里跑真实读写路径
  const makeWin = (failMode = null) => {
    const map = new Map();
    return {
      localStorage: {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
          if (failMode === 'throw') throw new Error('QuotaExceeded');
          map.set(k, v);
        },
        get _map() { return map; },
      },
    };
  };

  const win = makeWin();
  const s1 = ST.createStorage(win);
  ok('首次启动得到空存档且可持久化', s1.isPersistent() && s1.get().high_score === 0 && s1.get().v === 1);
  ok('新存档不含 P2 才有的 achievements 字段',
    !Object.prototype.hasOwnProperty.call(s1.get(), 'achievements'));
  s1.setName('ACE');
  s1.patchSettings('sound', false);
  const r1 = s1.submitRun({ score: 5000, kills: 40, combo: 12, time: 200, wave: 8 });
  ok('提交成绩返回排名', r1.rank === 1 && r1.isHigh === true, JSON.stringify(r1));
  ok('最高分被更新', s1.get().high_score === 5000);
  ok('设置被持久化', s1.get().settings.sound === false);

  const s2 = ST.createStorage(win);
  ok('重新载入后数据无损往返', s2.get().high_score === 5000 && s2.get().player_name === 'ACE'
    && s2.get().settings.sound === false && s2.get().leaderboard.length === 1);

  // 版本不符 → 丢弃重建
  win.localStorage.setItem(ST.SAVE_KEY, JSON.stringify({ v: 99, high_score: 999999, player_name: 'X' }));
  const s3 = ST.createStorage(win);
  ok('版本不符即丢弃重建（不写迁移代码）',
    s3.get().high_score === 0 && s3.get().leaderboard.length === 0 && s3.get().v === 1);

  // 损坏 JSON 不能抛异常
  win.localStorage.setItem(ST.SAVE_KEY, '{ 这不是 JSON ');
  let threw = false;
  try { ST.createStorage(win); } catch { threw = true; }
  ok('存档 JSON 损坏时不抛异常', !threw);

  // 排行榜裁剪
  win.localStorage.setItem(ST.SAVE_KEY, JSON.stringify({
    v: 1,
    leaderboard: Array.from({ length: 120 }, (_, i) => ({
      name: 'P', score: i + 1, kills: i, combo: i, time: i, wave: 1, date: '2026-01-01',
    })),
  }));
  const s4 = ST.createStorage(win);
  ok(`排行榜裁剪到 ${ST.LEADERBOARD_MAX} 条`, s4.get().leaderboard.length === ST.LEADERBOARD_MAX,
    String(s4.get().leaderboard.length));
  ok('排行榜按分数降序', s4.get().leaderboard.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  ok('裁剪保留的是最高分', s4.get().leaderboard[0].score === 120, String(s4.get().leaderboard[0].score));

  // sanitize 对垃圾行免疫
  const clean = ST._sanitizeSave({
    v: 1,
    leaderboard: [null, 'x', { score: -5 }, { score: 100, name: 'AB' }, { score: 50 }],
    high_score: 'nope',
    settings: null,
  });
  ok('垃圾行被过滤且非法数值被兜底',
    clean.leaderboard.length === 2 && clean.high_score === 0, JSON.stringify(clean.leaderboard));

  // 写入失败（隐私模式抛异常）→ 降级为内存态而不是崩溃
  const winFail = makeWin('throw');
  let failedThrew = false;
  let sf = null;
  try { sf = ST.createStorage(winFail); sf.setName('AA'); sf.submitRun({ score: 1, kills: 1, combo: 1, time: 1, wave: 1 }); }
  catch { failedThrew = true; }
  ok('localStorage 抛异常时降级为内存态（隐私模式不会崩）',
    !failedThrew && sf !== null && sf.isPersistent() === false);
  ok('降级后数据仍在内存里可用', sf.get().total_games === 1);

  // 格式化
  ok('时间格式化', ST.formatTime(272) === '4:32' && ST.formatTime(9) === '0:09', ST.formatTime(272));
  ok('分数千分位', ST.formatScore(12400) === '12,400', ST.formatScore(12400));
  ok('日期 ISO 格式', /^\d{4}-\d{2}-\d{2}$/.test(ST.isoDate(new Date())));
}

// ══ 14. 粒子池 ════════════════════════════════════════════════
section('14. 粒子池');
{
  const { createParticles } = await import('../src/render/particles.js');
  const rng = (await import('../src/core/rng.js')).createRng(9);
  const pool = createParticles(50, 9);
  for (let i = 0; i < 500; i++) {
    pool.burst(0, 0, 10, { rng, life: 5, size: 3, color: '#fff' });
  }
  ok('容量恒定不增长', pool.cap === 50 && pool.x.length === 50);
  ok('溢出时环形覆盖，存活数不超过容量', pool.liveCount() <= 50, String(pool.liveCount()));
  ok('溢出后仍全部是「活」的（覆盖而不是丢弃）', pool.liveCount() === 50, String(pool.liveCount()));
  pool.burst(0, 0, 20, { rng, life: 0.01, size: 40, color: '#fff' });
  ok('单粒子半径被夹到上限（否则看起来像渲染 bug）',
    pool.size.every((s) => s <= 9), `max=${Math.max(...pool.size)}`);
  // 寿命带 ±30% 抖动，所以"跑多久"必须从池内实际最长寿命推出来，
  // 写死一个步数迟早会在抖动边界上偶发失败（这正是探针本身量错自己的老毛病）
  const maxLife = Math.max(...pool.life);
  for (let i = 0; i < Math.ceil(maxLife * 60) + 4; i++) pool.step(1 / 60);
  ok('寿命耗尽后全部回收', pool.liveCount() === 0,
    `最长寿命 ${maxLife.toFixed(2)}s，剩余 ${pool.liveCount()}`);
  pool.clear();
  ok('clear 后全空', pool.liveCount() === 0);
}

// ══ 15. 音频降级 ══════════════════════════════════════════════
section('15. 音频（无 Web Audio 环境）');
{
  const { createAudio } = await import('../src/core/audio.js');
  const a = createAudio();
  let threw = false;
  try {
    for (const n of ['shoot', 'hit', 'enemyDie', 'bigDie', 'coin', 'pickup', 'playerHit',
      'shieldBreak', 'uiClick', 'waveBanner', 'bossPhase']) a.play(n);
    a.play('不存在的音效');
    a.setSetting('sound', false);
    a.setSetting('music', true);
    a.setSetting('不存在的设置', 1);
    await a.unlock();
    a.stopMusic();
  } catch (e) { threw = true; process.stdout.write(`    ${e.message}\n`); }
  ok('音频不可用时全部调用为 no-op 且不抛异常（音频永远不该是打不开游戏的原因）', !threw);
  ok('能报告不可用原因（供诊断）', typeof a.failureReason() === 'string', a.failureReason());
  ok('isUsable 为 false', a.isUsable() === false);

  const { createMusic } = await import('../src/core/music.js');
  const m = createMusic(a);
  let musicThrew = false;
  try { m.start(); m.start(); m.stop(); m.stop(); } catch { musicThrew = true; }
  ok('无 Web Audio 时音乐调度器安全降级', !musicThrew && m.isPlaying() === false);
}

// ══ 16. 世界：确定性 + 不变量（压力测试）═══════════════════════
section('16. 世界：确定性与不变量');
{
  const { createWorld, stepWorld, snapshotWorld, PHASE } = await import('../src/game/world.js');
  const KIND = BULLETS.KIND;

  /** 一个由世界状态决定的确定性输入序列（不是随机数 —— 否则两次运行没法比） */
  const inputAt = (w, i) => ({
    move: { x: Math.sin(w.t * 1.7) * 0.8, y: Math.cos(w.t * 0.9) * 0.35 },
    pointer: { active: false, x: 0, y: 0 },
    confirm: { pressed: i % 500 === 0 },
    pause: { pressed: false },
    mute: { pressed: false },
  });

  const run = (seed, steps) => {
    const w = createWorld(seed);
    const snaps = [];
    for (let i = 0; i < steps; i++) {
      stepWorld(w, CFG.FIXED_DT, inputAt(w, i));
      if (i % 400 === 0) snaps.push(JSON.stringify(snapshotWorld(w)));
    }
    return { snaps, final: snapshotWorld(w), w };
  };

  const A = run(20260920, 3600);
  const B = run(20260920, 3600);
  const C = run(20260921, 3600);
  ok('相同种子 + 相同输入 → 逐位一致（可重放）',
    JSON.stringify(A.snaps) === JSON.stringify(B.snaps));
  ok('不同种子 → 结果不同', JSON.stringify(A.snaps) !== JSON.stringify(C.snaps));
  ok('两次运行的最终快照完全一致',
    JSON.stringify(A.final) === JSON.stringify(B.final));

  // ★ 不变量压力测试：跑一整局，逐步检查世界自洽
  const { createWorld: cw, stepWorld: sw } = await import('../src/game/world.js');
  const w = cw(555);
  let bad = [];
  let scoreDecreased = 0;
  let comboExceedsKills = 0;
  let bulletInsideEnemy = 0;
  let dupSpawn = 0;
  let hitsOverShots = 0;
  let prevScore = 0;
  const seenEnemySlots = new Set();
  for (let i = 0; i < 20000; i++) {
    stepWorld(w, CFG.FIXED_DT, inputAt(w, i));
    w.player.hp = 3; // 不死，把压力测试跑满整局
    w.player.invuln = Math.max(w.player.invuln, 0.5);

    if (w.score.score < prevScore) scoreDecreased += 1;
    prevScore = w.score.score;
    if (w.score.combo > w.score.kills) comboExceedsKills += 1;
    if (w.stats.hits > w.stats.shots) hitsOverShots += 1;

    // 结算后不该还剩着「已经打中敌机却没被回收」的玩家子弹
    for (let b = 0; b < w.pBullets.cap; b++) {
      if (!w.pBullets.alive[b] || w.pBullets.kind[b] !== KIND.PLAYER) continue;
      for (const e of w.enemies.items) {
        if (!e.alive) continue;
        // 只检查**已经完全进入战场**的敌机：生成发生在 resolve 之后，
        // 一个刚在 y<0 出生的敌机要等下一步才会被判定 ——
        // 那是正常的"一帧延迟"，不是漏判。
        if (e.y < 0 || w.pBullets.y[b] < 0) continue;
        const dx = w.pBullets.x[b] - e.x;
        const dy = w.pBullets.y[b] - e.y;
        const rr = w.pBullets.rad[b] + e.r;
        if (dx * dx + dy * dy <= rr * rr) bulletInsideEnemy += 1;
      }
    }

    // 敌机池不想出现"同一格被两个敌机占用"（池管理错误的典型症状）
    if (i % 200 === 0) {
      const live = w.enemies.items.filter((e) => e.alive);
      const slots = new Set(live);
      if (slots.size !== live.length) dupSpawn += 1;
      seenEnemySlots.add(live.length);
    }

    // 子弹场必须始终自洽
    if (i % 137 === 0) {
      if (!w.eBullets.audit().consistent || !w.pBullets.audit().consistent) bad.push(`step${i} 子弹场脏`);
      if (w.enemies.count < 0 || w.drops.count < 0) bad.push(`step${i} 计数为负`);
      if (w.player.powers.spread < 0 || w.player.powers.magnet < 0) bad.push(`step${i} 道具计时为负`);
    }
  }
  ok('20k 步压力测试无状态污染', bad.length === 0, bad.slice(0, 3).join(' '));
  ok('分数单调不减', scoreDecreased === 0, `${scoreDecreased} 次下降`);
  ok('连击数不超过击杀数', comboExceedsKills === 0, `${comboExceedsKills} 次越界`);
  ok('命中数不超过发射数', hitsOverShots === 0, `${hitsOverShots} 次越界`);
  ok('没有「已命中敌机却仍存活」的玩家子弹（扫掠检测没有漏判）',
    bulletInsideEnemy === 0, `${bulletInsideEnemy} 次重叠`);
  ok('敌机池没有重复占用同一槽位', dupSpawn === 0);
  const fin = snapshotWorld(w);
  // 波次由**时间**驱动，与击杀无关：20k 步 = 333 模拟秒 ≈ 5:33。
  // balance.mjs 的计量局实测"5 分钟到第 20 波"，两边必须对得上。
  ok('压力测试后波次与时间标尺一致（≈20 波 / 5.5 分钟）',
    fin.wave >= 18 && fin.wave <= 26, `wave=${fin.wave} @ ${(fin.t / 60).toFixed(1)} 分钟`);
  ok('压力测试后仍能继续运行（无死锁）', fin.phase === PHASE.PLAYING || fin.phase === PHASE.OVER,
    fin.phase);
  ok('实体数量全部在容量内',
    fin.counts.eBullets <= CFG.EBULLET.cap && fin.counts.enemies <= 72 && fin.counts.pBullets <= 240,
    JSON.stringify(fin.counts));
}

// ══ 17. 死亡与结算路径 ════════════════════════════════════════
section('17. 死亡与结算');
{
  const { createWorld, stepWorld, snapshotWorld, debugDamagePlayer, debugGotoWave, PHASE } =
    await import('../src/game/world.js');
  const idle = {
    move: { x: 0, y: 0 }, pointer: { active: false, x: 0, y: 0 },
    confirm: { pressed: false }, pause: { pressed: false }, mute: { pressed: false },
  };
  const { hitPlayer } = await import('../src/game/resolve.js');
  const w = createWorld(11);
  for (let i = 0; i < 300; i++) stepWorld(w, CFG.FIXED_DT, idle);
  w.player.invuln = 0;
  w.player.shield = false;
  ok('受伤扣血并进入无敌帧',
    hitPlayer(w, 'test') === true && w.player.hp === 2 && w.player.invuln === CFG.PLAYER.invuln,
    `hp=${w.player.hp} invuln=${w.player.invuln}`);
  const hpBefore = w.player.hp;
  ok('无敌帧内再次受伤被拒绝', hitPlayer(w, 'test') === false && w.player.hp === hpBefore,
    `hp=${w.player.hp}`);
  w.player.invuln = 0;
  w.player.shield = true;
  hitPlayer(w, 'test');
  ok('护盾吸收一次伤害且不掉血',
    w.player.hp === hpBefore && w.player.shield === false && w.player.invuln > 0,
    `hp=${w.player.hp} shield=${w.player.shield}`);
  // debugDamagePlayer 是"绕开无敌帧"的测试接缝，用它把死亡路径走完
  debugDamagePlayer(w, 3);
  ok('血量归零进入 over', w.phase === PHASE.OVER && w.player.alive === false && w.player.hp === 0);
  const t0 = w.overT;
  for (let i = 0; i < 120; i++) stepWorld(w, CFG.FIXED_DT, idle);
  ok('死亡后结算计时器在推进（场景靠它切页）', w.overT > t0, `overT=${w.overT.toFixed(2)}`);
  ok('死亡后世界仍在动（敌人子弹继续飞，不是整屏冻结）',
    snapshotWorld(w).t > 300 * CFG.FIXED_DT);

  // 每 10 波都能生成 Boss，并且 Boss 死后能推进（索引关不能死锁）
  const w2 = createWorld(77);
  let bossSeen = 0;
  for (const wave of [10, 20, 30, 40]) {
    debugGotoWave(w2, wave);
    for (let i = 0; i < 240; i++) {
      stepWorld(w2, CFG.FIXED_DT, idle);
      w2.player.hp = 3;
      w2.player.invuln = 1;
    }
    if (w2.boss) bossSeen += 1;
  }
  ok('第 10/20/30/40 波都能生成 Boss', bossSeen === 4, `${bossSeen}/4`);

  const w3 = createWorld(78);
  debugGotoWave(w3, 10);
  for (let i = 0; i < 200; i++) { stepWorld(w3, CFG.FIXED_DT, idle); w3.player.hp = 3; w3.player.invuln = 1; }
  ok('Boss 波确实生成了 Boss', Boolean(w3.boss));
  if (w3.boss) {
    const { damageBoss } = await import('../src/game/resolve.js');
    damageBoss(w3, w3.boss.maxHp + 10);
    ok('Boss 被击杀进入 dying 且清空了敌方弹幕',
      w3.boss.dying === true && w3.eBullets.count === 0);
    for (let i = 0; i < 200; i++) { stepWorld(w3, CFG.FIXED_DT, idle); w3.player.hp = 3; w3.player.invuln = 1; }
    ok('Boss 死亡后波次能推进（索引关不会卡死）', w3.director.wave === 11,
      `wave=${w3.director.wave}`);
    ok('Boss 引用被释放（渲染层不会画幽灵）', w3.boss === null);
  }
}

// ══ 18. 文档与代码同步 ════════════════════════════════════════
section('18. 文档与代码同步');
{
  const spec = resolve(ROOT, 'docs/SPEC.md');
  ok('SPEC.md 存在（唯一真相源）', existsSync(spec));
  const text = read(spec);
  // 比的是"文档里实际写出来的记法"，不是 String(1/60) 那种浮点串
  ok('步长确实等于 1/60', Math.abs(CFG.FIXED_DT - 1 / 60) < 1e-12, String(CFG.FIXED_DT));
  const must = [
    ['步长记法', '1/60'],
    ['逻辑画布', `${CFG.FIELD_W} × ${CFG.FIELD_H}`],
    ['生命格数', `${CFG.PLAYER.hitPoints} 格血条`],
    ['Boss 周期', `每 ${CFG.WAVE.bossEvery} 波`],
    ['敌弹容量', String(CFG.EBULLET.cap)],
  ];
  const drifted = must.filter(([, v]) => !text.includes(v));
  ok('SPEC 里的关键数值与 config.js 一致（文档不会静默漂移）',
    drifted.length === 0, drifted.map(([l, v]) => `${l}(${v})`).join(' '));

  ok('PRD 要求的五页面都在 index.html 里',
    ['panel-menu', 'panel-over', 'panel-board', 'panel-help', 'panel-pause']
      .every((id) => read(resolve(ROOT, 'index.html')).includes(id)));
  ok('index.html 声明了 favicon（否则 Chrome 自动请求 /favicon.ico 污染断言）',
    read(resolve(ROOT, 'index.html')).includes('rel="icon"'));
  ok('.nojekyll 存在（legacy Pages 不会漏掉下划线开头的文件）',
    existsSync(resolve(ROOT, '.nojekyll')));
  ok('package.json 没有任何 dependencies（零构建是硬约束）', (() => {
    const pkg = JSON.parse(read(resolve(ROOT, 'package.json')));
    return !pkg.dependencies && !pkg.devDependencies;
  })());
}

// ══ 汇总 ══════════════════════════════════════════════════════
process.stdout.write(`\n${failures.length === 0
  ? `\x1b[32m全部通过 · ${passed} 项\x1b[0m`
  : `\x1b[31m${passed} 项通过 · ${failures.length} 项失败\x1b[0m`}\n`);
if (failures.length) {
  process.stdout.write('\n失败项：\n');
  for (const f of failures) process.stdout.write(`  · ${f}\n`);
}
process.stdout.write('\n');
process.exit(failures.length === 0 ? 0 : 1);
