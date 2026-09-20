/**
 * 调色板 —— 颜色的唯一真相源。
 *
 * 色相即语义，且危险等级随色相单调递增（SPEC §5）：
 *   绿(无害) → 橙(单发) → 紫(散射) → 红(环形·最危险) → 品红(精英) → 红+青(Boss)
 * 装饰性元素不得打破这条。render 层不允许出现字面量颜色。
 *
 * ★ PAL 只导出**被实际使用**的语义 token —— verify.mjs 有一条断言看守
 *   「每个 token 都被引用过」。它抓过一次真实的静默 bug：
 *   `PAL.red` / `PAL.gold` 被使用但从未定义，`strokeStyle = undefined`
 *   会让 Canvas **保留上一次的颜色**，于是 Boss 有可能被画成上一只敌机的绿色。
 *   所以宁可让基础色只作为模块内部的 NEON 存在，也不额外导出一批没人用的 token。
 */

const WHITE = '#ffffff';

/** 基础霓虹色：只在模块内部使用，用来装配下面的语义 token */
const NEON = {
  cyan: '#00fff5',
  magenta: '#ff00ff',
  red: '#ff2d55',
  orange: '#ff6a00',
  green: '#39ff88',
  purple: '#c16bff',
  gold: '#ffd400',
  blue: '#3aa0ff',
};

export const PAL = {
  // 底：深邃宇宙黑 → 深紫
  void: '#05060c',
  deep: '#0a0a1a',
  grid: '#151538',
  gridHot: '#26336b',
  /** 背景纵向渐变的中段：深紫，是"深邃宇宙"到"地平线辉光"之间的那一档 */
  bgMid: '#0d0a24',
  starFar: '#3a4a78',
  starMid: '#7f92c8',
  starNear: '#d8e6ff',

  // 玩家：霓虹青 = 我 · 安全 · 助力
  player: NEON.cyan,
  playerCore: WHITE,
  playerTrail: '#2aa8ff',

  // 玩家子弹
  pBullet: '#9dfcff',
  pBulletCore: WHITE,

  // 敌方子弹：高饱和暖色 + 接近白的亮核（密集时靠它读得出弹缝）
  eBullet: NEON.red,
  eBulletCore: '#ffd9e2',
  /** 敌机开火的极短枪口点：比弹体更粉，用来区分"刚出膛"与"已在飞" */
  muzzle: '#ff8fa3',

  // 危险 / 危险红（敌机、Boss、爆炸）
  danger: NEON.red,
  // 掉落
  coin: NEON.gold,
  shield: NEON.blue,

  // UI 语义
  faint: '#2b3350',
  warn: NEON.orange,
};

/** 敌机颜色：按 id 取，与 SPEC §5 的色相阶梯一一对应 */
export const ENEMY_COLOR = {
  scout: NEON.green,
  striker: NEON.orange,
  seeker: NEON.purple,
  tank: NEON.red,
  elite: NEON.magenta,
  boss: NEON.red,
};

/** Boss 描边用的辅助色（主体仍是红，深青只做细节——纯青是"我"的语义） */
export const BOSS_TRIM = '#00b8d4';

/** 道具颜色：沿用 PRD，撞色由「旋转菱形 + 白色内部图标」消解（见 SPEC §0.2） */
export const POWER_COLOR = {
  spread: NEON.red,
  shield: NEON.blue,
  magnet: NEON.gold,
  bomb: NEON.green,
  speed: NEON.purple,
};

/** 道具内部图标颜色，恒定白色 —— 这是「可拾取」的视觉签名 */
export const POWER_GLYPH = WHITE;
