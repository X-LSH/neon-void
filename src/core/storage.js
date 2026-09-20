/**
 * 本地存档。无后端，全部落在 localStorage。
 *
 * 三条纪律（见 SPEC §10）：
 *   1. 版本字段必需，不符即丢弃重建 —— 不写迁移代码；
 *   2. 所有访问包 try/catch —— 隐私模式下 localStorage **抛异常**而不是返回 null；
 *   3. 写入不进热路径 —— 只在开局/结算/改设置时调用。
 */

export const SAVE_KEY = 'neonvoid.save.v1';
export const SAVE_VERSION = 1;
export const LEADERBOARD_MAX = 50;
export const LEADERBOARD_SHOW = 10;
export const NAME_MIN = 3;
export const NAME_MAX = 8;

function freshSave() {
  return {
    v: SAVE_VERSION,
    player_name: '',
    high_score: 0,
    total_games: 0,
    total_kills: 0,
    best_combo: 0,
    best_time: 0,
    best_wave: 0,
    settings: { sound: true, music: true, shake: true },
    leaderboard: [],
  };
}

const num = (v, fallback = 0) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);

function sanitizeRow(r) {
  if (!r || typeof r !== 'object') return null;
  const score = num(r.score);
  if (score <= 0) return null;
  return {
    name: str(r.name, 'ACE').slice(0, NAME_MAX) || 'ACE',
    score,
    kills: num(r.kills),
    combo: num(r.combo),
    time: num(r.time),
    wave: Math.max(1, num(r.wave, 1)),
    date: str(r.date, ''),
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.v !== SAVE_VERSION) return null; // 版本不符 → 丢弃重建
  const s = freshSave();
  s.player_name = str(raw.player_name, '').slice(0, NAME_MAX);
  s.high_score = num(raw.high_score);
  s.total_games = num(raw.total_games);
  s.total_kills = num(raw.total_kills);
  s.best_combo = num(raw.best_combo);
  s.best_time = num(raw.best_time);
  s.best_wave = Math.max(0, num(raw.best_wave));
  const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  s.settings = {
    sound: st.sound !== false,
    music: st.music !== false,
    shake: st.shake !== false,
  };
  const rows = Array.isArray(raw.leaderboard) ? raw.leaderboard : [];
  s.leaderboard = rows.map(sanitizeRow).filter(Boolean);
  sortTrim(s.leaderboard);
  return s;
}

function sortTrim(rows) {
  rows.sort((a, b) => b.score - a.score || a.time - b.time);
  if (rows.length > LEADERBOARD_MAX) rows.length = LEADERBOARD_MAX;
}

export function createStorage(win = globalThis) {
  let available = true;
  let memory = freshSave();

  function read() {
    try {
      const ls = win.localStorage;
      if (!ls) throw new Error('no localStorage');
      const text = ls.getItem(SAVE_KEY);
      if (!text) return null;
      return JSON.parse(text);
    } catch {
      available = false;
      return null;
    }
  }

  function load() {
    const raw = read();
    const clean = sanitize(raw);
    if (clean) {
      memory = clean;
      return memory;
    }
    // 首次进入 / 版本不符 / 数据损坏 → 重建
    memory = freshSave();
    if (!available) memory.__memoryOnly = true;
    return memory;
  }

  function flush() {
    if (!available) return false;
    try {
      win.localStorage.setItem(SAVE_KEY, JSON.stringify(memory));
      return true;
    } catch {
      available = false;
      memory.__memoryOnly = true;
      return false;
    }
  }

  load();

  return {
    get: () => memory,
    isPersistent: () => available,
    save: flush,

    /** 场景切换之外的写入口：改名 / 改设置 */
    patchSettings(key, value) {
      if (!(key in memory.settings)) return;
      memory.settings[key] = Boolean(value);
      flush();
    },

    setName(name) {
      const n = String(name || '').trim().slice(0, NAME_MAX);
      memory.player_name = n.length >= NAME_MIN ? n : n || '';
      flush();
      return memory.player_name;
    },

    /** 一局结束后提交成绩。返回 { rank, isHigh, isBest } */
    submitRun({ score, kills, combo, time, wave }) {
      const name = memory.player_name || 'ACE';
      const date = isoDate(new Date());
      memory.total_games += 1;
      memory.total_kills += Math.max(0, Math.floor(kills));
      const isHigh = score > memory.high_score;
      if (isHigh) memory.high_score = score;
      if (combo > memory.best_combo) memory.best_combo = combo;
      if (time > memory.best_time) memory.best_time = time;
      if (wave > memory.best_wave) memory.best_wave = wave;

      memory.leaderboard.push({
        name, score, kills, combo, time, wave, date,
      });
      sortTrim(memory.leaderboard);
      const rank = memory.leaderboard.findIndex(
        (r) => r.score === score && r.kills === kills && r.date === date,
      );
      flush();
      return { rank: rank < 0 ? null : rank + 1, isHigh };
    },

    /** 清空排行榜（保留昵称与设置） */
    clearBoard() {
      memory.leaderboard = [];
      flush();
    },

    /** 全量重置 */
    wipe() {
      memory = freshSave();
      if (!available) memory.__memoryOnly = true;
      flush();
      return memory;
    },

    /** 供自检注入损坏数据 */
    _raw: () => memory,
    _forceMemoryOnly: () => { available = false; },
  };
}

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatScore(n) {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

export { sanitize as _sanitizeSave, freshSave as _freshSave };
