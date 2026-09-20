/**
 * 全部可调常量。改手感只动这个文件，不动业务代码。
 *
 * 口径见 docs/SPEC.md —— 改数值前先确认 SPEC 里的推导还成立
 * （尤其是 §4 单局时长标尺与 §8 手感比例关系）。
 */

// ── 逻辑画布（与屏幕尺寸完全解耦，见 SPEC §1）────────────────
export const FIELD_W = 480;
export const FIELD_H = 720;

/** 局内阶段。放在 config 而不是 world，是为了让 resolve.js 不必反向 import world。 */
export const PHASE = { PLAYING: 'playing', OVER: 'over' };

// ── 主循环 ───────────────────────────────────────────────────
export const FIXED_DT = 1 / 60;
export const MAX_STEPS = 6;
export const MAX_FRAME_DT = 0.25;

// ── 玩家 ─────────────────────────────────────────────────────
export const PLAYER = {
  startX: FIELD_W / 2,
  startY: FIELD_H - 100,

  /** 判定圆半径。远小于视觉体积 26×32，方向对玩家有利，
   *  但必须被画出来（发光内核），否则受伤不可归因。 */
  radius: 6,
  bodyW: 26,
  bodyH: 32,

  speed: 265,
  speedMul: 1.5,
  /** v += (target−v) × (1−exp(−rate·dt))，各帧率观感一致 */
  accelRate: 26,

  hitPoints: 3,
  invuln: 1.35,
  invulnBlinkHz: 14,
  /** 受伤时清掉这个半径内的敌方子弹：防「一发中弹→撞进第二发」 */
  hitClearRadius: 130,

  fireInterval: 0.115,
  bulletSpeed: 760,
  bulletDmg: 1,
  bulletR: 3.2,
  bulletLen: 14,
  /** 散射道具的夹角（单边，弧度） */
  spreadAngle: (14 * Math.PI) / 180,
  /** 子弹寿命只是兜底（越界回收才是正常路径）。
   *  必须 > FIELD_H / bulletSpeed = 0.95s，否则从战场最下方射出的子弹
   *  会在到达顶部之前凭空消失 —— 那是「打出去没反应」这类最难查的 bug。 */
  bulletLife: 1.6,
};

// ── 敌机子弹 ─────────────────────────────────────────────────
export const EBULLET = {
  radius: 3.6,
/**
 * 硬上限。达到上限时新子弹直接丢弃 —— 宁可少一发也不掉帧。
 *
 * 容量必须由**实测峰值**倒推，不能拍脑袋（balance.mjs 看守）：
 * 第 20 波附近峰值约 430，第 22 波约 560，第 30 波约 700。
 * 取 900（≈1.3 倍余量）。
 * **余量本身就是不变量** —— 一旦真正打到上限，弹幕密度就被静默截断了，
 * 难度曲线在最高段失效，而这件事不会有任何报错。
 */
cap: 900,
  /**
   * 敌方子弹寿命。只够横穿一次战场即可，多出来的都是无效驻留。
   * 170 u/s × 4.2s ≈ 714 ≈ 战场高度。
   */
  life: 4.2,
};

// ── 波次与难度曲线（见 SPEC §4）───────────────────────────────
export const WAVE = {
  baseDuration: 15,
  durationDecay: 0.25,
  minDuration: 9,
  bannerTime: 2.2,

  bossEvery: 10,
  /** Boss 波期间补零星的间隔 */
  bossScoutInterval: 2.6,

  baseEvents: 5,
  /**
   * 每波事件数随波次线性增长，**上界 56 只是防溢出，不是难度上界**（见下）。
   * 难度终局的保证来自「敌机池被打满」而不是这个数字 ——
   * 池满之后生成请求被静默丢弃，屏幕上持续是一堵会开火的墙，单局因此一定会结束。
   */
  eventsPerWave: 0.95,
  maxEvents: 56,
  /** 间距由「剩余时间 / 剩余事件数」自适应推导，这只是下限（防同帧狂刷） */
  spawnGapMin: 0.14,

  /** 解锁门槛（波次） */
  unlock: { striker: 6, seeker: 9, tank: 16, elite: 18 },
  /** 权重随波次的倾斜速度：越晚越偏向重敌机 */
  weightTilt: 0.055,

  speedRamp: 0.018,
  speedRampMax: 0.55,
  hpRamp: 0.03,
  hpRampMax: 1.0,
  fireRamp: 0.015,
  fireRampMin: 0.55,

  clearBonus: 250,
};

// ── 连击与计分（见 SPEC §7）──────────────────────────────────
export const SCORE = {
  comboWindow: 2.2,
  comboStep: 0.1,
  comboMax: 5.0,
  survivalPerSec: 12,
  coinValues: [10, 20, 30],
  coinDropChance: 0.45,
  coinAttractRadius: 42,
  coinAttractSpeed: 340,
  powerDropChance: 0.07,
};

// ── 道具时长（秒；0 表示即时或「直到被击中」）──────────────────
export const POWER = {
  spread: 10,
  magnet: 8,
  speed: 8,
  shield: 0,
  bomb: 0,
};

// ── 反馈（见 SPEC §8）────────────────────────────────────────
export const FX = {
  shakeKill: 2.2,
  shakeElite: 5.5,
  shakePlayerHit: 9,
  shakeBossPhase: 11,
  shakeBossDie: 20,
  shakeDecay: 7.5,
  shakeMax: 22,

  flashPlayerHit: 0.28,
  flashBossDie: 0.5,

  slowmoKill: 0.12,
  slowmoElite: 0.3,
  slowmoBossDie: 1.4,
  slowmoScale: 0.35,
};

// ── 粒子池容量（桌面 / 触屏低端降级）─────────────────────────
export const PARTICLES = {
  capDesktop: 1600,
  capTouch: 700,
  // 画布逻辑单位下的最大半径，防止单粒子铺满屏幕
  maxSize: 9,
};
