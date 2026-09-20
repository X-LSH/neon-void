/**
 * HUD。全部是 DOM，不画进 Canvas。
 *
 * 两条纪律：
 *   1. **刷新节流到 10Hz** —— 每帧写 textContent 会让浏览器每帧重排。
 *      （采样陷阱：读 HUD 值时必须等过节流窗口，否则读到的是上一帧的旧值。）
 *   2. **布局由 viewport 反推**：侧栏宽度 = 画布留边宽度，
 *      所以 HUD 永远不会压到游戏区上；留边不够宽时自动切成顶部条。
 */

import { formatScore, formatTime } from '../core/storage.js';
import { POWER } from '../game/config.js';
import { POWER_COLOR } from '../render/palette.js';

const POWER_LABEL = { spread: '散射', shield: '护盾', magnet: '磁铁', bomb: '炸弹', speed: '加速' };

/**
 * 拾取提示的文案。
 * ★ 用户报「有些道具吃过以后效果不是很明显」—— 数值其实是对的
 *   （实测散射 ×3、加速 ×1.5），问题在于**玩家看不出自己拿到了什么**。
 *   护盾更是只有在被打中时才有感觉；不挨打就等于什么都没发生。
 *   所以拾取时必须把「名字 + 具体效果 + 时长」直接说出来。
 */
const POWER_DESC = {
  spread: ['主武器 ×3 路', `${POWER.spread}s`],
  shield: ['吸收一次伤害', '直到被击中'],
  magnet: ['全屏自动吸取', `${POWER.magnet}s`],
  bomb: ['清空弹幕与小敌机', '即时'],
  speed: ['移动速度 ×1.5', `${POWER.speed}s`],
};
const REFRESH = 0.1;

export function createHud() {
  const root = document.getElementById('hud');
  const el = {
    score: document.getElementById('hud-score'),
    score2: document.getElementById('hud-score2'),
    combo: document.getElementById('hud-combo'),
    combo2: document.getElementById('hud-combo2'),
    wave: document.getElementById('hud-wave'),
    wave2: document.getElementById('hud-wave2'),
    time: document.getElementById('hud-time'),
    lives: document.getElementById('hud-lives'),
    lives2: document.getElementById('hud-lives2'),
    powers: document.getElementById('hud-powers'),
    fps: document.getElementById('hud-fps'),
    power: document.getElementById('hud-power'),
    powerName: document.getElementById('hud-power-name'),
    powerSub: document.getElementById('hud-power-sub'),
    boss: document.getElementById('hud-boss'),
    bossFill: document.getElementById('hud-bossfill'),
    banner: document.getElementById('hud-banner'),
  };

  let acc = REFRESH;
  let lastCombo = 0;
  let lastBoss = false;
  const rows = new Map();
  const pips = [];

  /** 布局：留边够宽就放侧栏，否则切顶部条（窄屏横排会压到游戏区） */
  function layout(vp) {
    const side = vp.ox >= 150;
    root.dataset.layout = side ? 'side' : 'top';
    const r = document.documentElement.style;
    r.setProperty('--gutter', `${vp.ox}px`);
    r.setProperty('--field-top', `${vp.oy}px`);
    r.setProperty('--pad-bottom', `${Math.max(0, vp.cssH - vp.oy - vp.fieldH * vp.scale)}px`);
  }

  function buildPips() {
    for (const container of [el.lives, el.lives2]) {
      container.innerHTML = '';
      const arr = [];
      for (let i = 0; i < 3; i++) {
        const d = document.createElement('i');
        d.className = 'pip';
        container.appendChild(d);
        arr.push(d);
      }
      pips.push(arr);
    }
  }
  buildPips();

  function syncPowers(p) {
    const active = [];
    if (p.shield) active.push(['shield', 1, 1]);
    for (const k of ['spread', 'magnet', 'speed']) {
      if (p.powers[k] > 0) active.push([k, p.powers[k], POWER[k]]);
    }
    const names = new Set(active.map((a) => a[0]));
    for (const [k, node] of rows) {
      if (!names.has(k)) {
        node.remove();
        rows.delete(k);
      }
    }
    for (const [k, remain, max] of active) {
      let node = rows.get(k);
      if (!node) {
        node = document.createElement('div');
        node.className = 'pw';
        node.style.color = POWER_COLOR[k] || '#ffffff';
        node.innerHTML = `<span>${POWER_LABEL[k] || k}</span><i><b></b></i>`;
        rows.set(k, node);
        el.powers.appendChild(node);
      }
      const ratio = max > 0 ? Math.max(0, Math.min(1, remain / max)) : 1;
      node.firstElementChild.nextElementSibling.firstElementChild.style.width = `${ratio * 100}%`;
    }
  }

  return {
    layout,
    show() { root.classList.remove('hidden'); },
    hide() { root.classList.add('hidden'); },
    setVisible(v) { root.classList.toggle('hidden', !v); },

    reset() {
      acc = REFRESH;
      lastCombo = 0;
      lastBoss = false;
      el.banner.classList.remove('show');
      el.power.classList.remove('show');
      el.boss.classList.remove('on');
      for (const [k, node] of rows) { node.remove(); rows.delete(k); }
    },

    /** 拾取道具时的名字 + 效果提示（1.5s） */
    powerToast(ptype) {
      const desc = POWER_DESC[ptype];
      if (!desc) return;
      el.powerName.textContent = POWER_LABEL[ptype] || ptype;
      el.powerName.style.textShadow = `0 0 6px ${POWER_COLOR[ptype]}, 0 0 22px ${POWER_COLOR[ptype]}`;
      el.powerSub.textContent = `${desc[0]} · ${desc[1]}`;
      el.power.classList.remove('show');
      void el.power.offsetWidth;
      el.power.classList.add('show');
    },

    banner(text) {
      el.banner.textContent = text;
      el.banner.classList.remove('show');
      // 强制回流以重启动画（去掉这一行，第二次同文本不会重播）
      void el.banner.offsetWidth;
      el.banner.classList.add('show');
    },

    /** 每物理步调用，内部按 10Hz 节流 */
    update(w, dt, fps) {
      acc += dt;
      if (acc < REFRESH) return;
      acc = 0;

      const s = w.score;
      const txt = formatScore(s.score);
      el.score.textContent = txt;
      el.score2.textContent = txt;
      el.time.textContent = formatTime(s.t);
      const waveTxt = String(w.director.wave);
      el.wave.textContent = waveTxt;
      el.wave2.textContent = waveTxt;
      el.fps.textContent = `${Math.round(fps)} fps`;

      for (const arr of pips) {
        for (let i = 0; i < arr.length; i++) {
          const on = i < w.player.hp;
          arr[i].className = on
            ? (i === w.player.hp - 1 && w.player.shield ? 'pip shield' : 'pip on')
            : 'pip';
        }
      }

      const combo = s.combo;
      const comboStr = `x${combo}`;
      el.combo.textContent = comboStr;
      el.combo2.textContent = comboStr;
      if (combo > lastCombo + 3) {
        el.combo.classList.remove('hot');
        void el.combo.offsetWidth;
        el.combo.classList.add('hot');
      }
      lastCombo = combo;

      syncPowers(w.player);

      const bossOn = Boolean(w.boss && !w.boss.dying);
      if (bossOn !== lastBoss) {
        el.boss.classList.toggle('on', bossOn);
        lastBoss = bossOn;
      }
      if (bossOn) {
        el.bossFill.style.width = `${Math.max(0, (w.boss.hp / w.boss.maxHp) * 100)}%`;
      }
    },
  };
}
