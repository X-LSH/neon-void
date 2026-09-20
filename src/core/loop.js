/**
 * 固定步长主循环。
 *
 * 物理步长恒定，渲染跟随刷新率，两者解耦；渲染拿到 alpha 做插值。
 * 见 SPEC §1.1：切后台回来不能「追账」，否则会瞬推上百步把玩家直接推进敌机里。
 *
 * ★ core 层不认识游戏概念 —— 步长、步数上限、帧间隔上限全部由调用方注入。
 *   core 反向 import game/config.js 是分层倒置，verify.mjs 有一条断言看守它。
 */

export function createLoop({ step, draw, fixedDt, maxSteps = 6, maxFrameDt = 0.25 }) {
  if (!(fixedDt > 0)) throw new Error('createLoop 需要正的 fixedDt');
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  /** 时间缩放（慢动作）。只影响「真实时间 → 物理时间」的兑换率，
   *  不改变步长 —— 单步物理永远确定，所以重放仍然逐位一致。 */
  let timeScale = 1;

  let stepCount = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!last) {
      last = now;
      return;
    }
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;
    if (dt > maxFrameDt) dt = maxFrameDt;

    acc += dt * timeScale;

    let steps = 0;
    while (acc >= fixedDt && steps < maxSteps) {
      step(fixedDt);
      acc -= fixedDt;
      steps += 1;
    }
    // 追不上就丢弃剩余累积，不要无限追赶（死亡螺旋的入口）
    if (steps >= maxSteps) acc = 0;
    stepCount = steps;

    fpsAcc += dt;
    fpsFrames += 1;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }

    draw(acc / fixedDt);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    isRunning: () => running,
    setTimeScale: (v) => {
      timeScale = v;
    },
    getTimeScale: () => timeScale,
    /** 渲染插值系数 0..1 */
    alpha: () => acc / fixedDt,
    stats: () => ({ fps, stepCount }),
  };
}
