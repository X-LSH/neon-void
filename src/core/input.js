/**
 * 输入抽象。游戏逻辑永远不知道输入来自键盘还是手指。
 *
 * 边沿信号用「计数锁存」而非布尔（见 SPEC §3）：
 *   一帧可能推进多个物理步 → 边沿只该被第一步消费；
 *   一帧也可能零个物理步   → 信号必须留到下一帧，输入绝不丢失。
 */

const MOVE_KEYS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

const ACTION_KEYS = {
  Space: 'confirm',
  Enter: 'confirm',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
};

const PREVENT = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter',
]);

export function createInput(win = globalThis) {
  const held = { left: false, right: false, up: false, down: false };
  const heldActions = { confirm: false, pause: false, mute: false };
  const pending = { confirm: 0, pause: 0, mute: 0 };

  /** 触屏绝对拖拽目标（游戏区坐标）。active 时优先于键盘方向。 */
  let pointer = { active: false, x: 0, y: 0 };

  const isDown = (name) => held[name] === true;

  const press = (action) => {
    if (heldActions[action]) return; // 抑制重复（等价于键盘的 e.repeat）
    heldActions[action] = true;
    pending[action] += 1;
  };
  const release = (action) => {
    heldActions[action] = false;
  };

  const onKeyDown = (e) => {
    const mv = MOVE_KEYS[e.code];
    if (mv) {
      held[mv] = true;
      if (PREVENT.has(e.code)) e.preventDefault();
      return;
    }
    const ac = ACTION_KEYS[e.code];
    if (ac) {
      if (!e.repeat) press(ac);
      if (PREVENT.has(e.code)) e.preventDefault();
    }
  };

  const onKeyUp = (e) => {
    const mv = MOVE_KEYS[e.code];
    if (mv) {
      held[mv] = false;
      return;
    }
    const ac = ACTION_KEYS[e.code];
    if (ac) release(ac);
  };

  /** 切走再回来不该还在跑 —— 清空 held，但保留 pending（按下还没被消费的信号） */
  const onBlur = () => {
    held.left = held.right = held.up = held.down = false;
    heldActions.confirm = heldActions.pause = heldActions.mute = false;
    pointer.active = false;
  };

  const intent = () => {
    let x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    let y = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return {
      move: { x, y },
      pointer,
      confirm: { pressed: pending.confirm > 0 },
      pause: { pressed: pending.pause > 0 },
      mute: { pressed: pending.mute > 0 },
    };
  };

  return {
    attach() {
      win.addEventListener('keydown', onKeyDown);
      win.addEventListener('keyup', onKeyUp);
      win.addEventListener('blur', onBlur);
    },
    detach() {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
    },
    intent,
    /** 触屏与键盘写同一份状态 —— 手机端不需要另一套 touchState */
    setAction: (action, down) => {
      if (!(action in heldActions)) return;
      if (down) press(action);
      else release(action);
    },
    setPointer: (active, x = 0, y = 0) => {
      pointer.active = active;
      pointer.x = x;
      pointer.y = y;
    },
    /** 每个物理步末尾调用：消费掉一个边沿信号 */
    endStep() {
      for (const k of Object.keys(pending)) {
        if (pending[k] > 0) pending[k] -= 1;
      }
    },
    /** 场景切换时调用：清掉跨场景残留的按住状态 */
    reset() {
      held.left = held.right = held.up = held.down = false;
      heldActions.confirm = heldActions.pause = heldActions.mute = false;
      for (const k of Object.keys(pending)) pending[k] = 0;
      pointer.active = false;
    },
    /** 供自检读取内部状态 */
    snapshot: () => ({
      held: { ...held },
      heldActions: { ...heldActions },
      pending: { ...pending },
      pointer: { ...pointer },
    }),
  };
}
