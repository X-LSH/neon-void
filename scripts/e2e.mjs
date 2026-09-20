#!/usr/bin/env node
/**
 * 真实浏览器端到端验证（Chrome + CDP）。零依赖。
 *
 * ★ 为什么「起服务器 / 起 Chrome / 跑验证」必须全在同一个 Node 进程里：
 *   工具会在两次调用之间**回收进程树**。任何在上一轮调用里 spawn 的东西
 *   （哪怕加了 detached + unref）到这一轮都已经死了 —— 表现为
 *   `net::ERR_CONNECTION_REFUSED`，看起来像"服务器没配好"，其实是生命周期问题。
 *   本脚本因此自己起服务器、自己起 Chrome、跑完自己收尸，全程单进程。
 *
 * 用法：
 *   node scripts/e2e.mjs                      （会自动拉起本地静态服务器）
 *   APP_URL=https://x-lsh.github.io/neon-void/ node scripts/e2e.mjs   （线上实测）
 *
 * 环境变量：
 *   APP_URL   默认 http://127.0.0.1:5175/
 *   CDP_PORT  默认 9351
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = resolve(ROOT, '.tmp', 'shots');
const BASE = process.env.APP_URL || 'http://127.0.0.1:5175/';
const CDP_PORT = Number(process.env.CDP_PORT || 9351);
const isLocal = /(127\.0\.0\.1|localhost|\[::1\])/.test(BASE);

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function portOpen() {
  try {
    return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok;
  } catch {
    return false;
  }
}

/**
 * 自管静态服务器。
 * 只有本地 URL 才需要；已经有人响应就直接复用（不重复起）。
 */
async function ensureServer() {
  if (!isLocal) return null;
  try {
    if ((await fetch(BASE)).ok) return null;
  } catch { /* 没起，继续 */ }
  const port = String(new URL(BASE).port || '5175');
  const child = spawn(process.execPath, [resolve(ROOT, 'scripts', 'serve.mjs')], {
    detached: true, stdio: 'ignore', env: { ...process.env, PORT: port },
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(BASE)).ok) {
        process.stdout.write(`  \x1b[38;5;245m已拉起静态服务器 :${port}\x1b[0m\n`);
        return child;
      }
    } catch { /* 还没就绪 */ }
    await sleep(250);
  }
  throw new Error(`静态服务器未能在 10 秒内响应 ${BASE}`);
}

async function launchChrome(extraArgs = []) {  if (await portOpen()) return null;
  const bin = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) throw new Error('未找到 Chrome/Edge 可执行文件');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--mute-audio',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${resolve(ROOT, '.tmp', `cdp-profile-${CDP_PORT}`)}`,
    ...extraArgs,
    'about:blank',
  ];
  // 本机有企业代理：本地服务必须绕开，否则请求被送进隧道变成 ERR_CONNECTION_REFUSED
  if (isLocal) args.unshift('--no-proxy-server', '--proxy-bypass-list=<-loopback>');
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (await portOpen()) return child.pid;
    await sleep(500);
  }
  throw new Error('Chrome 未能在 30 秒内开启调试端口');
}

/**
 * 在页面里逐层数像素。
 *
 * ★ 用**色相判据**而不是精确色值：霓虹是靠「同一形状描 N 遍」做的，
 *   最内层虽然 alpha=1，但 1.4 单位的细线在缩放 + 抗锯齿下没有一个像素
 *   是 100% 覆盖 —— 精确匹配恒为 0，而那一层明明画了。
 *   色相在暗底混色下是稳的，所以判色相比判色值可靠得多。
 *   （"不同颜色数 > N" 这种弱断言更不能用：少画一整层它照样通过。）
 */
const PIXEL_PROBE = `(() => {
  const c = document.getElementById('screen');
  if (!c) return null;
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const d = g.getImageData(0, 0, w, h).data;
  const P = {
    white:  (r,gg,b) => r > 232 && gg > 232 && b > 232,
    cyan:   (r,gg,b) => gg > 168 && b > 168 && r < 112,
    pBullet:(r,gg,b) => gg > 208 && b > 226 && r > 108 && r < 205,
    eBullet:(r,gg,b) => r > 70 && r - gg > 42 && r - b > 18,
    eCore:  (r,gg,b) => r > 198 && gg > 148 && gg < 246 && b > 158 && b < 250,
    green:  (r,gg,b) => gg > 186 && r < 122 && b < 172,
    orange: (r,gg,b) => r > 196 && gg > 58 && gg < 172 && b < 92,
    purple: (r,gg,b) => r > 148 && b > 196 && gg < 152,
    gold:   (r,gg,b) => r > 196 && gg > 158 && b < 102
  };
  const counts = {}; for (const k in P) counts[k] = 0;
  let bright = 0, seen = new Set();
  // 每 2 个像素采样一次：1440×900×2 像素逐点跑 9 个判据会明显拖慢
  for (let i = 0; i < d.length; i += 8) {
    const r = d[i], gg = d[i+1], b = d[i+2];
    seen.add(((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3));
    if (r + gg + b > 150) bright++;
    for (const k in P) if (P[k](r, gg, b)) counts[k]++;
  }
  return { counts, bright, distinct: seen.size, w, h };
})()`;

/**
 * 分区平均亮度。用来验证「留边被压暗、战场是唯一焦点」——
 * 这件事在截图上很难判断（两处都是"很暗的蓝"，肉眼分不出来），
 * 但它是明确的视觉意图，必须被断言而不是被假设。
 */
const REGION_PROBE = `(() => {
  const c = document.getElementById('screen');
  const g = c.getContext('2d');
  const vp = __NV.viewport();
  const S = vp.scale, OX = vp.ox, OY = vp.oy, W = 480 * S, H = 720 * S;
  const dpr = c.width / vp.w;
  const lum = (x0, y0, x1, y1) => {
    const X0 = Math.max(0, Math.round(x0 * dpr)), Y0 = Math.max(0, Math.round(y0 * dpr));
    const X1 = Math.min(c.width, Math.round(x1 * dpr)), Y1 = Math.min(c.height, Math.round(y1 * dpr));
    if (X1 <= X0 || Y1 <= Y0) return null;
    const d = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i+1] + d[i+2]; n++; }
    return s / (n * 3);
  };
  const field = lum(OX + W * 0.25, OY + H * 0.35, OX + W * 0.75, OY + H * 0.9);
  const left = lum(0, OY + H * 0.35, Math.max(1, OX - 6), OY + H * 0.9);
  const right = lum(Math.min(c.width - 1, OX + W + 6), OY + H * 0.35, c.width, OY + H * 0.9);
  return { field, left, right, ox: OX, w: W };
})()`;

async function main() {
  await mkdir(SHOTS, { recursive: true });
  process.stdout.write(`\nNEON VOID · 浏览器实测  ${BASE}\n`);

  await ensureServer();
  await launchChrome();
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('未找到页面目标');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'));
  });

  let seq = 0;
  const pending = new Map();
  let errors = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d?.exception?.description || d?.text || 'unknown exception');
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const e = m.params.entry;
      errors.push(`${e.text}${e.url ? ` @ ${e.url}` : ''}`);
    }
  };

  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return r.result?.result?.value;
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };

  const key = (type, k, code, vk) => send('Input.dispatchKeyEvent', {
    type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
  const keyPress = async (k, code, vk, ms = 60) => {
    await key('keyDown', k, code, vk);
    await sleep(ms);
    await key('keyUp', k, code, vk);
  };
  const keys = { left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39], up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40], space: [' ', 'Space', 32], esc: ['Escape', 'Escape', 27], m: ['m', 'KeyM', 77], p: ['p', 'KeyP', 80] };
  const hold = (n) => key('keyDown', ...keys[n]);
  const release = (n) => key('keyUp', ...keys[n]);

  const load = async (url = BASE) => {
    await send('Page.navigate', { url });
    await sleep(1800);
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // 桌面试必须在真实桌面尺寸下跑：headless 默认窗口只有 758×426，
  // 那个尺寸下游戏区被压到 284px 宽，宽屏侧栏布局根本不会被触发。
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await load();

  // 模块加载期的异常单独成段并且**先报**：不然后面的断言会以
  // "元素找不到 / __NV 未定义" 的形式连锁崩溃，把真正的原因埋掉。
  section('0. 页面加载');
  const loadErrors = errors.slice();
  ok('模块加载期无控制台异常', loadErrors.length === 0,
    loadErrors.slice(0, 3).join('  |  '));
  ok('页面脚本已执行（__NV 挂载）', (await evaluate(`typeof window.__NV`)) === 'object',
    `typeof __NV = ${await evaluate(`typeof window.__NV`)}`);
  errors = [];
  if (loadErrors.length) {
    process.stdout.write('\n\x1b[31m加载期异常全文：\x1b[0m\n');
    for (const e of loadErrors.slice(0, 6)) process.stdout.write(`  ${e.split('\n')[0]}\n`);
    process.stdout.write('\n');
  }

  // ══ 1. 首屏 ════════════════════════════════════════════════
  section('1. 首屏与主菜单');
  ok('主菜单可见', await evaluate(`!document.getElementById('panel-menu').classList.contains('hidden')`));
  ok('标题为 NEON VOID', (await evaluate(`document.querySelector('.title').textContent.trim()`)) === 'NEON VOID');
  ok('有 favicon 链接（否则 Chrome 自动请求 /favicon.ico 报 404 污染断言）',
    await evaluate(`!!document.querySelector('link[rel="icon"]')`));
  ok('HUD 在菜单中隐藏', await evaluate(`document.getElementById('hud').classList.contains('hidden')`));

  const bg = await evaluate(PIXEL_PROBE);
  ok('画布非空白（背景星空已绘制）', bg && bg.distinct > 24, bg ? `distinct≈${bg.distinct}` : '探针失败');
  ok('背景有明暗层次（星空 + 透视网格已绘制）', bg && bg.bright > 400,
    bg ? `bright=${bg.bright}` : '');

  const reg = await evaluate(REGION_PROBE);
  if (reg && reg.left !== null && reg.right !== null) {
    ok('留边比战场暗（战场是唯一焦点，不是和留边融成一片）',
      reg.left < reg.field * 0.92 && reg.right < reg.field * 0.92,
      `战场 ${reg.field.toFixed(1)} / 左 ${reg.left.toFixed(1)} / 右 ${reg.right.toFixed(1)}`);
  } else {
    ok('留边比战场暗（无留边，跳过）', true, '当前视口没有留边');
  }
  await shot('01-menu');

  // ══ 2. 设置开关 ════════════════════════════════════════════
  section('2. 设置开关与存档');
  await evaluate(`document.querySelector('[data-act="sound"]').click()`);
  await sleep(120);
  ok('音效开关可关闭并写盘', (await evaluate(`__NV.save().settings.sound`)) === false);
  await evaluate(`document.querySelector('[data-act="sound"]').click()`);
  await sleep(120);
  ok('音效开关可恢复', (await evaluate(`__NV.save().settings.sound`)) === true);
  ok('存档里没有 P2 才有的 achievements 字段（不预留"未来可能需要"的空字段）',
    (await evaluate(`Object.prototype.hasOwnProperty.call(__NV.save(),'achievements')`)) === false);
  ok('存档带版本字段 v=1', (await evaluate(`__NV.save().v`)) === 1);

  // ══ 3. 开始游戏 ════════════════════════════════════════════
  section('3. 真实点击开始游戏');
  await evaluate(`document.querySelector('[data-act="start"]').click()`);
  await sleep(400);
  ok('进入战斗场景', (await evaluate(`__NV.screen()`)) === 'battle');
  ok('HUD 已显示', await evaluate(`!document.getElementById('hud').classList.contains('hidden')`));
  ok('主菜单已隐藏', await evaluate(`document.getElementById('panel-menu').classList.contains('hidden')`));
  ok('代号为空时自动用默认值（PRD 要求 3 秒进入游戏）',
    (await evaluate(`__NV.save().player_name`)).length >= 1);

  await sleep(900);
  let st = await evaluate(`__NV.state()`);
  ok('世界已建立且为 playing', st && st.phase === 'playing', st ? `wave=${st.wave} hp=${st.hp}` : 'null');
  ok('自动开火生效（已发射子弹）', st.stats.shots > 0, `shots=${st.stats.shots}`);
  ok('玩家判定半径是有限正数（NaN 会让全部碰撞静默失效）',
    Number.isFinite(await evaluate(`__NV.state().hp`)) && (await evaluate(`__NV.state().hp`)) === 3);

  // ══ 4. 真实键盘 ════════════════════════════════════════════
  section('4. 真实键盘操控');
  const x0 = (await evaluate(`__NV.state().px`));
  await hold('left');
  await sleep(500);
  await release('left');
  const x1 = await evaluate(`__NV.state().px`);
  ok('按左键飞船确实左移', x1 < x0 - 30, `x ${x0} → ${x1}`);

  const y0 = await evaluate(`__NV.state().py`);
  await hold('up');
  await sleep(420);
  await release('up');
  const y1 = await evaluate(`__NV.state().py`);
  ok('按上键飞船确实上移', y1 < y0 - 20, `y ${y0} → ${y1}`);

  const edge = await evaluate(`(() => { const s = __NV.state(); return s.px >= 6 && s.px <= 474 && s.py >= 6 && s.py <= 714; })()`);
  ok('飞船被裁剪在游戏区内', edge);

  // ══ 5. 密集战斗 + 像素断言 ═════════════════════════════════
  section('5. 密集战斗、粒子与逐层像素');
  // 用第 22 波：这一刻 scout 只占权重 23%，其余全是会开火的类型，
  // 「敌方弹幕在飞」不会是运气问题。第 16 波 scout 权重过半，
  // 偶尔会出现"整屏侦察机都不射击"的窗口，把断言变成抛硬币。
  await evaluate(`__NV.gotoWave(22)`);
  await sleep(1200);

  // ★ 弹幕是**突发性**的：瞬时读数天然会撞上"齐射间隙"。
  //   所以所有"在飞/在工作"类断言一律取窗口内的**峰值**。
  let particlePeak = 0;
  let bulletPeak = 0;
  let enemyPeak = 0;
  const sample = async () => {
    const s = await evaluate(`__NV.state()`);
    const p = await evaluate(`__NV.particles()`);
    particlePeak = Math.max(particlePeak, p.live);
    bulletPeak = Math.max(bulletPeak, s.counts.eBullets);
    enemyPeak = Math.max(enemyPeak, s.counts.enemies);
    return s;
  };
  await hold('left');
  for (let i = 0; i < 6; i++) { await sleep(200); await sample(); }
  await hold('right');
  await release('left');
  for (let i = 0; i < 8; i++) { await sleep(200); await sample(); }
  await release('right');
  await sleep(300);
  const combat = await sample();

  ok('敌机已生成（窗口内峰值）', enemyPeak > 3, `峰值 ${enemyPeak}，当前 ${combat.counts.enemies}`);
  ok('敌方弹幕在飞（窗口内峰值）', bulletPeak > 5, `峰值 ${bulletPeak}`);
  ok('玩家子弹在飞', combat.counts.pBullets > 0, `pBullets=${combat.counts.pBullets}`);
  const pp = await evaluate(`__NV.particles()`);
  // 这一条量的是**尾焰基线**：拖尾按固定间隔 0.022s 发射、寿命 0.26s，
  // 所以只要飞船活着在动，稳态就该有约 12 个粒子。它是确定性的。
  // 「粒子系统整体在工作」由下面的因果断言证明 —— 那条才不受运气影响。
  ok('飞船尾焰在持续发射（拖尾基线）', particlePeak >= 8, `峰值 ${particlePeak}/${pp.cap}`);
  ok('粒子池未超容量', pp.live <= pp.cap, `${pp.live} <= ${pp.cap}`);

  const pix = await evaluate(PIXEL_PROBE);
  ok('绘制了玩家青色', pix.counts.cyan > 40, `cyan=${pix.counts.cyan}`);
  ok('绘制了玩家判定核心（受伤可归因的前提）', pix.counts.white > 12, `white=${pix.counts.white}`);
  ok('绘制了玩家子弹', pix.counts.pBullet > 20, `pBullet=${pix.counts.pBullet}`);
  ok('绘制了敌方子弹亮核', pix.counts.eCore > 20, `eCore=${pix.counts.eCore}`);
  ok('绘制了红色层（敌方子弹辉光 / 敌机本体）', pix.counts.eBullet > 40, `red=${pix.counts.eBullet}`);
  ok('绘制了多种敌机本体色（色相即危险等级）',
    (pix.counts.green + pix.counts.orange + pix.counts.purple) > 30,
    `g=${pix.counts.green} o=${pix.counts.orange} p=${pix.counts.purple}`);
  await shot('02-combat');

  // ★ 因果断言，放在像素采样**之后**：它会清掉大半战场，
  //   放在前面会让"敌机本体色""红色层"这类逐层断言读到空场景。
  //   绝对粒子数取决于"这一刻恰好打死几只"，是运气；
  //   "主动触发真实击杀 → 粒子当场跳增"才是机制证据。
  const pBefore = (await evaluate(`__NV.particles()`)).live;
  await evaluate(`__NV.forceKills(8)`);
  await sleep(120);
  const pAfter = (await evaluate(`__NV.particles()`)).live;
  ok('击杀确实当场产出粒子（因果，不是"数量看起来还行"）',
    pAfter >= pBefore + 40, `${pBefore} → ${pAfter}`);

  // ══ 6. Boss ════════════════════════════════════════════════
  section('6. Boss 波与预警');
  await evaluate(`__NV.gotoWave(10)`);
  await sleep(2600);
  const bs = await evaluate(`__NV.state()`);
  ok('第 10 波生成 Boss', Boolean(bs.boss), bs.boss ? `hp=${bs.boss.hp}/${bs.boss.maxHp}` : 'null');
  ok('Boss 血条已显示', await evaluate(`document.getElementById('hud-boss').classList.contains('on')`));
  ok('Boss 有血量', bs.boss && bs.boss.maxHp > 0, bs.boss ? `${bs.boss.maxHp}` : '');
  await sleep(1200);
  await shot('03-boss');
  const bossPix = await evaluate(PIXEL_PROBE);
  ok('Boss 本体已绘制', bossPix.counts.eBullet > 200 || bossPix.bright > 1500,
    `eBullet=${bossPix.counts.eBullet} bright=${bossPix.bright}`);

  // ══ 7. 帧率 ════════════════════════════════════════════════
  section('7. 帧率（肉眼分辨不出 52 与 60，必须读数字）');
  // 用非 Boss 波测密度：Boss 波只有 Boss 一个人开火，密度反而不是最高的
  await evaluate(`__NV.gotoWave(24)`);
  await hold('left');
  await sleep(2200);
  await hold('right');
  await release('left');
  await sleep(2200);
  await release('right');
  await sleep(400);
  const fps = await evaluate(`__NV.fps()`);
  ok('密集弹幕下帧率 ≥ 55', fps >= 55, `fps=${fps.toFixed(1)}`);
  const st2 = await evaluate(`__NV.state()`);
  ok('第 24 波弹幕确实很密', st2.counts.eBullets > 10, `eBullets=${st2.counts.eBullets}`);
  ok('第 24 波敌机数量可观', st2.counts.enemies > 3, `enemies=${st2.counts.enemies}`);

  // ══ 8. 暂停 ════════════════════════════════════════════════
  section('8. 暂停');
  await keyPress(...keys.esc);
  await sleep(300);
  ok('ESC 进入暂停', (await evaluate(`__NV.screen()`)) === 'pause');
  ok('暂停面板可见', await evaluate(`!document.getElementById('panel-pause').classList.contains('hidden')`));
  const pausedT = await evaluate(`__NV.state().t`);
  await sleep(600);
  ok('暂停时世界时间冻结', Math.abs((await evaluate(`__NV.state().t`)) - pausedT) < 0.02, `t=${pausedT}`);
  await shot('04-pause');
  await keyPress(...keys.esc);
  await sleep(300);
  ok('再次 ESC 恢复', (await evaluate(`__NV.screen()`)) === 'battle');

  // ══ 9. 死亡 → 结算 → 存档 ══════════════════════════════════
  section('9. 死亡、结算与排行榜落盘');
  const before = await evaluate(`__NV.save()`);
  await evaluate(`__NV.damage(3)`);
  await sleep(300);
  ok('血量归零即进入 over 相位', (await evaluate(`__NV.state().phase`)) === 'over');
  // 死亡慢动作（0.35×）+ 结算延迟 ≈ 3 真实秒，必须按真实时间等
  await sleep(4200);
  ok('自动切到结算页', (await evaluate(`__NV.screen()`)) === 'over',
    `screen=${await evaluate(`__NV.screen()`)}`);
  ok('结算页显示本局得分', Number((await evaluate(`document.getElementById('over-score').textContent`)).replace(/,/g, '')) > 0);
  ok('结算页显示存活时间', /^\d+:\d{2}$/.test(await evaluate(`document.getElementById('over-time').textContent`)));
  ok('结算页显示抵达波次', Number(await evaluate(`document.getElementById('over-wave').textContent`)) >= 10);
  await shot('05-gameover');

  const after = await evaluate(`__NV.save()`);
  ok('局数 +1', after.total_games === before.total_games + 1, `${before.total_games} → ${after.total_games}`);
  ok('排行榜新增一条', after.leaderboard.length === before.leaderboard.length + 1,
    `${before.leaderboard.length} → ${after.leaderboard.length}`);
  ok('最高分被更新', after.high_score >= after.leaderboard[0].score, `high=${after.high_score}`);
  ok('排行榜按分数降序', after.leaderboard.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  ok('排行榜条目含 wave 与时长字段',
    after.leaderboard[0].wave >= 1 && after.leaderboard[0].time > 0);
  ok('写入确实进了 localStorage', await evaluate(
    `(() => { try { return JSON.parse(localStorage.getItem('neonvoid.save.v1')).total_games; } catch { return -1; } })()`)
    === after.total_games);

  // ══ 10. 排行榜页 + 再来一局 ════════════════════════════════
  section('10. 排行榜与重开');
  await evaluate(`document.querySelector('#panel-over [data-act="board"]').click()`);
  await sleep(300);
  ok('排行榜页可见', (await evaluate(`__NV.screen()`)) === 'board');
  ok('排行榜渲染出数据行', (await evaluate(`document.querySelectorAll('#board-body tbody tr').length`)) >= 1);
  ok('本局记录被高亮', (await evaluate(`document.querySelectorAll('#board-body tr.me').length`)) === 1);
  await shot('06-board');

  await evaluate(`document.querySelector('#panel-board [data-act="menu"]').click()`);
  await sleep(250);
  ok('返回主菜单', (await evaluate(`__NV.screen()`)) === 'menu');
  ok('主菜单最高分已刷新', (await evaluate(`document.getElementById('menu-high').textContent`)) !== '0');

  await evaluate(`document.querySelector('[data-act="again"]') ? 1 : document.querySelector('#panel-over [data-act="again"]').click()`);
  await evaluate(`__NV.action('again')`);
  await sleep(700);
  const fresh = await evaluate(`__NV.state()`);
  ok('再来一局：新世界满血重置', fresh.hp === 3 && fresh.wave === 1 && fresh.score < 5000,
    `hp=${fresh.hp} wave=${fresh.wave} score=${fresh.score}`);

  // ══ 11. 说明页 ═════════════════════════════════════════════
  section('11. 操作说明');
  await evaluate(`__NV.go('menu')`);
  await sleep(200);
  await evaluate(`__NV.action('help')`);
  await sleep(250);
  ok('说明页可打开', (await evaluate(`__NV.screen()`)) === 'help');
  ok('说明页写明了自动开火', (await evaluate(`document.getElementById('panel-help').textContent`)).includes('自动开火'));

  // ══ 12. 桌面端零泄漏 ═══════════════════════════════════════
  section('12. 手机端适配（390×844 真实触摸）');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await load();
  await sleep(400);

  const vpM = await evaluate(`__NV.viewport()`);
  ok('触摸仿真确实让环境检测为触屏（否则后续断言全是假的）', vpM.touch === true,
    `touch=${vpM.touch} scale=${vpM.scale.toFixed(3)}`);
  ok('body 打上 touch-ui 类', await evaluate(`document.body.classList.contains('touch-ui')`));
  ok('窄屏无横向溢出', await evaluate(
    `document.documentElement.scrollWidth <= window.innerWidth + 1 && window.innerWidth === 390`),
    `scrollW=${await evaluate('document.documentElement.scrollWidth')}`);
  ok('游戏区完整落在视口内', vpM.oy >= 0 && vpM.oy + 720 * vpM.scale <= 844 + 1,
    `oy=${vpM.oy} fieldH=${(720 * vpM.scale).toFixed(0)}`);
  ok('HUD 切换为顶部条（留边不够宽时不许压到游戏区）',
    (await evaluate(`document.getElementById('hud').dataset.layout`)) === 'top');
  ok('触屏提示可见', await evaluate(
    `getComputedStyle(document.getElementById('touch-hint')).display !== 'none'`));
  ok('暂停按钮可见且够大（触屏最小触摸目标 44px）', await evaluate(
    `(() => { const b = document.getElementById('pause-btn'); const r = b.getBoundingClientRect();
       return getComputedStyle(b).display !== 'none' && r.width >= 40 && r.height >= 40; })()`));
  ok('桌面端专属元素已隐藏（零泄漏）', await evaluate(
    `getComputedStyle(document.getElementById('hud-fps')).display === 'none'`));
  await shot('07-mobile-menu');

  // ══ 13. 真实触摸操控 ═══════════════════════════════════════
  section('13. 真实触摸拖拽');
  await evaluate(`__NV.start(4242)`);
  await sleep(900);
  const tb = await evaluate(`__NV.state()`);
  const fieldTop = (await evaluate(`__NV.viewport()`)).oy;
  const scale = (await evaluate(`__NV.viewport()`)).scale;

  // 触摸点换算：游戏区 (x,y) → 屏幕 CSS 坐标
  const toScreen = (fx, fy) => ({ x: fx * scale, y: fieldTop + fy * scale });
  const p1 = toScreen(120, 560);
  const p2 = toScreen(360, 520);

  await send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: p1.x, y: p1.y, id: 1 }],
  });
  await sleep(320);
  const mid = await evaluate(`__NV.state()`);
  await send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: p2.x, y: p2.y, id: 1 }],
  });
  await sleep(420);
  const moved = await evaluate(`__NV.state()`);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);

  ok('触摸按下后飞船响应（位置明显改变）',
    Math.abs(mid.px - tb.px) > 20 || Math.abs(mid.py - tb.py) > 20,
    `(${tb.px},${tb.py}) → (${mid.px},${mid.py})`);
  ok('触摸拖动后飞船继续跟随', Math.abs(moved.px - mid.px) > 40,
    `x ${mid.px} → ${moved.px}`);
  ok('触摸抬起后飞船停住', await evaluate(
    `(() => { const a = __NV.state().px; return new Promise(r => setTimeout(() => r(Math.abs(__NV.state().px - a) < 3), 300)); })()`));
  ok('拖拽期间仍在自动开火', moved.stats.shots > tb.stats.shots, `${tb.stats.shots} → ${moved.stats.shots}`);
  await shot('08-mobile-battle');

  // ══ 14. 回到桌面端，双方向验证 ═════════════════════════════
  section('14. 回到桌面端：零泄漏的反方向验证');
  // 恢复成 1440×900（不是 clearDeviceMetricsOverride —— 那会退回 headless
  // 默认的 758×426，宽屏侧栏布局根本不会被触发）
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await load();
  await sleep(400);
  ok('桌面端视口恢复为 1440×900', (await evaluate(`window.innerWidth`)) === 1440);
  ok('桌面端用的是宽屏侧栏布局', (await evaluate(`document.getElementById('hud').dataset.layout`)) === 'side',
    `layout=${await evaluate(`document.getElementById('hud').dataset.layout`)}`);
  ok('桌面端没有 touch-ui 类', (await evaluate(`document.body.classList.contains('touch-ui')`)) === false);
  ok('桌面端没有触屏提示', await evaluate(
    `getComputedStyle(document.getElementById('touch-hint')).display === 'none'`));
  ok('桌面端没有暂停按钮', await evaluate(
    `getComputedStyle(document.getElementById('pause-btn')).display === 'none'`));
  ok('桌面端帧率面板可见', await evaluate(
    `getComputedStyle(document.getElementById('hud-fps')).display !== 'none'`));
  await shot('09-back-to-desktop');

  // ══ 15. 控制台零异常 ═══════════════════════════════════════
  section('15. 控制台');
  const real = errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR/.test(e));
  ok('全程无控制台异常', real.length === 0, real.slice(0, 4).join(' | '));

  process.stdout.write(`\n${failures.length === 0
    ? `\x1b[32m全部通过 · ${passed} 项\x1b[0m`
    : `\x1b[31m${passed} 项通过 · ${failures.length} 项失败\x1b[0m`}\n`);
  if (failures.length) {
    process.stdout.write('\n失败项：\n');
    for (const f of failures) process.stdout.write(`  · ${f}\n`);
  }
  process.stdout.write(`\n截图：${SHOTS}\n\n`);
  ws.close();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stdout.write(`\n\x1b[31mE2E 崩溃：${e.message}\x1b[0m\n${e.stack}\n`);
  process.exit(2);
});
