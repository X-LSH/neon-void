/**
 * 引导与场景流。
 *
 * 分层（SPEC §2）：main 是唯一同时接触输入、更新、渲染的地方。
 * 界面切换只改 screen 变量与 DOM 面板可见性，不做别的同步 ——
 * 每多一份「当前状态」的副本，就多一处会被忘记更新的地方。
 */

import { createViewport } from './core/viewport.js';
import { createInput } from './core/input.js';
import { createLoop } from './core/loop.js';
import { createAudio } from './core/audio.js';
import { createMusic } from './core/music.js';
import { createStorage } from './core/storage.js';
import { createRng } from './core/rng.js';
import { createParticles } from './render/particles.js';
import { createWorldRenderer } from './render/scene.js';
import { createHud } from './ui/hud.js';
import { createPanels } from './ui/panels.js';
import { createBattle } from './scenes/battle.js';
import { clientToField, clamp } from './core/touch.js';
import { FIELD_W, FIELD_H, PARTICLES, FIXED_DT, MAX_STEPS, MAX_FRAME_DT } from './game/config.js';

const canvas = document.getElementById('screen');
const storage = createStorage();
// core 层不认识游戏概念：画布尺寸与步长从这里注入（反向 import 是分层倒置）
const vp = createViewport(canvas, { fieldW: FIELD_W, fieldH: FIELD_H });
vp.resize();

const audio = createAudio();
const music = createMusic(audio);
const input = createInput();
input.attach();

const particles = createParticles(
  vp.touch ? PARTICLES.capTouch : PARTICLES.capDesktop,
  PARTICLES.maxSize,
);
const renderer = createWorldRenderer(vp, particles, createRng(20260920));
const hud = createHud();
const panels = createPanels(storage);

function applySettings() {
  const s = storage.get().settings;
  audio.setSetting('sound', s.sound);
  audio.setSetting('music', s.music);
  battle.setShakeEnabled(s.shake);
  panels.syncToggles();
  if (!s.music) music.stop();
  else if (audio.isUsable() && !music.isPlaying()) music.start();
}

const battle = createBattle({
  particles,
  rng: createRng(0x9e3779b9),
  audio,
  storage,
  hud,
  setTimeScale: (v) => loop.setTimeScale(v),
  getFps: () => loop.stats().fps,
  onEnd(result) {
    const res = storage.submitRun(result);
    panels.setHighlight(res.rank ? res.rank - 1 : -1);
    panels.fillOver({ ...result, ...res });
    go('over');
  },
});

// ── 场景流 ───────────────────────────────────────────────────
let screen = 'menu';
let bgClock = 0;

function go(name) {
  screen = name;
  hud.setVisible(name === 'battle' || name === 'pause' || name === 'over');
  panels.show(name === 'battle' ? null : name);
  input.reset();
  if (name === 'menu') panels.refreshMenu();
  if (name === 'board') panels.renderBoard();
  if (name === 'battle') {
    audio.play('uiClick');
    musicHook();
  }
}

function startRun(seed) {
  battle.start(seed);
  panels.show(null);
  go('battle');
}

function musicHook() {
  if (storage.get().settings.music && audio.isUsable()) music.start();
}

function action(name) {
  const set = storage.get().settings;
  switch (name) {
    case 'start':
    case 'again': {
      const n = panels.readName();
      if (!n.ok) { panels.focusName(); return; }
      storage.setName(n.name);
      startRun();
      break;
    }
    case 'menu':
      battle.stop();
      go('menu');
      break;
    case 'board':
      // 只有从主菜单进排行榜才清掉高亮。
      // 从结算页进来时那条高亮就是"你刚打完的这一局"，清掉它等于把玩家
      // 最想看的东西（我排第几）藏起来 —— 而这条路径恰恰是最常走的。
      if (screen !== 'over') panels.setHighlight(-1);
      go('board');
      break;
    case 'help':
      go('help');
      break;
    case 'resume':
      go('battle');
      break;
    case 'abort':
      battle.stop();
      go('menu');
      break;
    case 'sound':
      storage.patchSettings('sound', !set.sound);
      applySettings();
      audio.play('uiClick');
      break;
    case 'music':
      storage.patchSettings('music', !set.music);
      applySettings();
      break;
    case 'shake':
      storage.patchSettings('shake', !set.shake);
      applySettings();
      break;
    case 'clear-board':
      storage.clearBoard();
      panels.renderBoard();
      panels.refreshMenu();
      audio.play('uiClick');
      break;
    default:
      break;
  }
}

panels.wire(action);
document.getElementById('pause-btn').addEventListener('click', () => {
  if (screen === 'battle') go('pause');
});

// ── 触屏：绝对拖拽（飞船浮在手指上方）────────────────────────
let activePointer = null;

function pointerToField(e) {
  const f = clientToField(e.clientX, e.clientY, vp.rect(), vp);
  // 越界不解除接管，只裁剪 —— 手指滑出游戏区就"失去控制"是最让人恼火的手感。
  // 纵向偏移在 player.js 里统一施加，这里只送原始游戏区坐标。
  input.setPointer(true, clamp(f.x, 0, FIELD_W), clamp(f.y, 0, FIELD_H));
}

canvas.addEventListener('pointerdown', (e) => {
  if (!vp.touch || screen !== 'battle') return;
  activePointer = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件可能不支持 */ }
  pointerToField(e);
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointer) return;
  pointerToField(e);
  e.preventDefault();
}, { passive: false });

const release = (e) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  input.setPointer(false, 0, 0);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ── 音频必须在首次用户手势里解锁 ─────────────────────────────
async function unlock() {
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
  const ok = await audio.unlock();
  if (ok) musicHook();
}
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ── 尺寸变化 ─────────────────────────────────────────────────
function onResize() {
  vp.resize();
  hud.layout(vp);
  document.body.classList.toggle('touch-ui', vp.touch);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// ── 主循环 ───────────────────────────────────────────────────
function stepFrame(dt) {
  const it = input.intent();

  switch (screen) {
    case 'battle':
      battle.step(dt, it);
      if (it.pause.pressed) go('pause');
      break;
    case 'menu':
      if (it.confirm.pressed) action('start');
      break;
    case 'pause':
      if (it.confirm.pressed || it.pause.pressed) go('battle');
      break;
    case 'over':
      if (it.confirm.pressed) action('again');
      break;
    case 'board':
    case 'help':
      if (it.confirm.pressed || it.pause.pressed) go('menu');
      break;
    default:
      break;
  }

  if (it.mute.pressed) action('sound');
  input.endStep();
  bgClock += dt;
}

function drawFrame(alpha) {
  const w = battle.world();
  if (w && (screen === 'battle' || screen === 'pause' || screen === 'over')) {
    renderer.draw(w, alpha, bgClock);
  } else {
    renderer.backdrop(bgClock);
  }
}

const loop = createLoop({
  step: stepFrame,
  draw: drawFrame,
  fixedDt: FIXED_DT,
  maxSteps: MAX_STEPS,
  maxFrameDt: MAX_FRAME_DT,
});

// ── 启动 ─────────────────────────────────────────────────────
onResize();
applySettings();
panels.refreshMenu();
panels.show('menu');
loop.start();

// ── 测试接缝（E2E 用；状态只读，动作走真实路径）──────────────
window.__NV = {
  version: '0.1.0',
  screen: () => screen,
  state: () => battle.debug.snapshot(),
  save: () => JSON.parse(JSON.stringify(storage.get())),
  fps: () => loop.stats().fps,
  particles: () => ({ live: battle.debug.particles(), cap: battle.debug.particleCap() }),
  audio: () => ({ usable: audio.isUsable(), reason: audio.failureReason(), on: audio.getSettings() }),
  viewport: () => ({ w: vp.cssW, h: vp.cssH, scale: vp.scale, ox: vp.ox, oy: vp.oy, touch: vp.touch }),
  go: (n) => go(n),
  action: (n) => action(n),
  start: (seed) => { storage.setName(storage.get().player_name || 'ACE'); startRun(seed); },
  damage: (n = 1) => {
    const w = battle.world();
    if (!w) return false;
    w.player.invuln = 0;
    w.player.shield = false;
    w.player.hp = Math.max(0, w.player.hp - n);
    if (w.player.hp === 0 && w.player.alive) {
      w.player.alive = false;
      w.phase = 'over';
      w.overT = 0;
      w.fx.slowmo = Math.max(w.fx.slowmo, 0.9);
    }
    return true;
  },
  gotoWave: (n) => battle.debug.gotoWave(n),
  forceKills: (n) => battle.debug.queueKills(n),
  enemyCount: () => battle.debug.enemies(),
  wipeSave: () => { storage.wipe(); panels.refreshMenu(); },
};
