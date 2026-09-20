/**
 * 五个界面（主菜单 / 结算 / 排行榜 / 说明 / 暂停）的 DOM 面板。
 *
 * 界面文字全部走 DOM，不画进 Canvas —— 浏览器排中文与等宽数字远比
 * 手写位图字体可靠，而且这些内容不在世界坐标系里。
 */

import {
  formatScore, formatTime, LEADERBOARD_SHOW, NAME_MIN, NAME_MAX,
} from '../core/storage.js';

const SCREENS = ['menu', 'over', 'board', 'help', 'pause'];

export function createPanels(storage) {
  const ids = {};
  for (const s of SCREENS) ids[s] = document.getElementById(`panel-${s}`);
  const root = document.querySelector('.ui');

  const el = {
    name: document.getElementById('name-input'),
    nameErr: document.getElementById('name-err'),
    high: document.getElementById('menu-high'),
    games: document.getElementById('menu-games'),
    wave: document.getElementById('menu-wave'),
    boardBody: document.getElementById('board-body'),
    clearBtn: document.getElementById('clear-board-btn'),
    overRank: document.getElementById('over-rank'),
    overScore: document.getElementById('over-score'),
    overHigh: document.getElementById('over-high'),
    overKills: document.getElementById('over-kills'),
    overCombo: document.getElementById('over-combo'),
    overWave: document.getElementById('over-wave'),
    overTime: document.getElementById('over-time'),
  };

  const toggles = new Map();
  for (const btn of root.querySelectorAll('[data-act]')) {
    toggles.set(btn.dataset.act, btn);
  }

  let current = 'menu';
  let highlight = -1;

  function show(name) {
    for (const s of SCREENS) ids[s].classList.toggle('hidden', s !== name);
    current = name;
    root.style.pointerEvents = name ? 'none' : 'none';
  }

  function syncToggles() {
    const s = storage.get().settings;
    const map = { sound: s.sound, music: s.music, shake: s.shake };
    for (const [act, on] of Object.entries(map)) {
      const btn = toggles.get(act);
      if (!btn) continue;
      btn.dataset.on = String(on);
      const small = btn.querySelector('small');
      if (small) small.textContent = on ? '开' : '关';
    }
  }

  function refreshMenu() {
    const s = storage.get();
    el.high.textContent = formatScore(s.high_score);
    el.games.textContent = String(s.total_games);
    el.wave.textContent = String(s.best_wave);
    if (document.activeElement !== el.name) el.name.value = s.player_name || '';
    syncToggles();
    el.clearBtn.disabled = s.leaderboard.length === 0;
    el.clearBtn.style.opacity = s.leaderboard.length === 0 ? '0.45' : '1';
  }

  function renderBoard() {
    const rows = storage.get().leaderboard.slice(0, LEADERBOARD_SHOW);
    if (rows.length === 0) {
      el.boardBody.innerHTML = '<p class="empty">还没有记录 —— 去打一局吧。</p>';
      return;
    }
    const body = rows.map((r, i) => {
      const me = i === highlight;
      return `<tr${me ? ' class="me"' : ''}>`
        + `<td>${i + 1}</td><td>${escapeHtml(r.name)}</td>`
        + `<td>${formatScore(r.score)}</td><td>W${r.wave}</td><td>${formatTime(r.time)}</td>`
        + `<td>${escapeHtml(r.date.slice(5))}</td></tr>`;
    }).join('');
    el.boardBody.innerHTML = `
      <table class="board">
        <thead><tr><th>#</th><th>代号</th><th>分数</th><th>波次</th><th>时长</th><th>日期</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function fillOver(data) {
    const s = storage.get();
    el.overScore.textContent = formatScore(data.score);
    el.overHigh.textContent = formatScore(s.high_score);
    el.overKills.textContent = formatScore(data.kills);
    el.overCombo.textContent = `x${data.maxCombo}`;
    el.overWave.textContent = String(data.wave);
    el.overTime.textContent = formatTime(data.time);
    if (data.rank) {
      el.overRank.textContent = data.isHigh
        ? `新纪录 · 排行榜第 ${data.rank} 名`
        : `排行榜第 ${data.rank} 名`;
    } else {
      el.overRank.textContent = '未进入前 50';
    }
  }

  /** 校验代号。留空视为「用默认代号」而不是报错 —— PRD 要「3 秒进入游戏」。 */
  function readName() {
    const raw = el.name.value.trim();
    if (raw.length === 0) {
      el.name.classList.remove('bad');
      el.nameErr.textContent = '';
      return { ok: true, name: storage.get().player_name || 'ACE' };
    }
    if (raw.length < NAME_MIN || raw.length > NAME_MAX) {
      el.name.classList.add('bad');
      el.nameErr.textContent = `代号需要 ${NAME_MIN}–${NAME_MAX} 个字符`;
      return { ok: false, name: raw };
    }
    el.name.classList.remove('bad');
    el.nameErr.textContent = '';
    return { ok: true, name: raw };
  }

  function wire(onAction) {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      onAction(btn.dataset.act);
    });
    el.name.addEventListener('input', () => {
      el.name.classList.remove('bad');
      el.nameErr.textContent = '';
    });
    el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onAction('start');
      e.stopPropagation();
    });
  }

  return {
    wire,
    show,
    current: () => current,
    isPanelVisible: (name) => !ids[name].classList.contains('hidden'),
    refreshMenu,
    renderBoard,
    fillOver,
    readName,
    syncToggles,
    setHighlight(i) { highlight = i; },
    focusName() { el.name.focus(); },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
