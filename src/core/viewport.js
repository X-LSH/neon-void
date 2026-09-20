/**
 * 视口：把固定逻辑画布（480×720）映射到任意屏幕。
 *
 * 画布铺满视口，游戏区居中；游戏区外的留边由背景与 DOM HUD 填充。
 * scale 用浮点（矢量图形不需要光栅对齐）。
 * 见 SPEC §1：逻辑尺寸必须固定，否则弹幕密度随屏幕变化、排行榜失去可比性。
 */

/** 测试可覆写：?touch=1 / ?touch=0 强制触屏 / 桌面形态 */
function readTouchOverride(search) {
  if (/[?&]touch=1\b/.test(search)) return true;
  if (/[?&]touch=0\b/.test(search)) return false;
  return null;
}

export function createViewport(canvas, { fieldW, fieldH, win = globalThis } = {}) {
  if (!(fieldW > 0) || !(fieldH > 0)) throw new Error('createViewport 需要 fieldW / fieldH');
  const ctx = canvas.getContext('2d', { alpha: false });
  const vp = {
    canvas,
    ctx,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    scale: 1,
    ox: 0,
    oy: 0,
    fieldW,
    fieldH,
    touch: false,
  };

  const override = readTouchOverride((win.location && win.location.search) || '');

  function detectTouch() {
    if (override !== null) return override;
    try {
      const coarse = win.matchMedia && win.matchMedia('(pointer: coarse)').matches;
      return Boolean(coarse) || (win.navigator && win.navigator.maxTouchPoints > 0);
    } catch {
      return false;
    }
  }

  function resize() {
    const cssW = Math.max(320, win.innerWidth || 320);
    const cssH = Math.max(320, win.innerHeight || 320);
    // dpr 封顶 2：再高的密度对矢量图形没有收益，但填充率是实打实的成本
    const dpr = Math.min(2, win.devicePixelRatio || 1);

    vp.cssW = cssW;
    vp.cssH = cssH;
    vp.dpr = dpr;
    vp.scale = Math.min(cssW / fieldW, cssH / fieldH);
    vp.ox = Math.round((cssW - fieldW * vp.scale) / 2);
    vp.oy = Math.round((cssH - fieldH * vp.scale) / 2);
    vp.touch = detectTouch();

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    return vp;
  }

  /** 每帧开头：把变换重置为「以 CSS 像素为单位」 */
  function begin() {
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  }

  /** 进入游戏区坐标系（叠加震动偏移） */
  function enterField(shakeX = 0, shakeY = 0) {
    ctx.save();
    ctx.translate(vp.ox + shakeX, vp.oy + shakeY);
    ctx.scale(vp.scale, vp.scale);
  }

  function exitField() {
    ctx.restore();
  }

  vp.resize = resize;
  vp.begin = begin;
  vp.enterField = enterField;
  vp.exitField = exitField;
  vp.rect = () => canvas.getBoundingClientRect();
  return vp;
}
