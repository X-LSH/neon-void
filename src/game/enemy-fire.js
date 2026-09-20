/**
 * 敌机弹幕模式。纯计算，只往子弹场里写。
 *
 * 每种模式都接受一个「快慢倍率」mul（来自波次难度曲线，越小越快），
 * 这样难度递增只需要乘一个系数，不需要为每个波次写一套参数。
 *
 * 寿命统一取自 EBULLET.life —— 弹幕寿命只有一个调参入口。
 */

import { EBULLET } from './config.js';

const TAU = Math.PI * 2;
const LIFE = EBULLET.life;

/** 朝玩家打一发 */
export function aimed(field, ex, ey, angle, speed, r, k) {
  field.spawn(ex, ey, Math.cos(angle) * speed, Math.sin(angle) * speed, r, LIFE, k);
}

/** N 路扇形，围绕给定方向 */
export function fan(field, ex, ey, angle, count, spread, speed, r, k) {
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = angle - spread / 2;
  for (let i = 0; i < count; i++) {
    const a = start + step * i;
    field.spawn(ex, ey, Math.cos(a) * speed, Math.sin(a) * speed, r, LIFE, k);
  }
}

/**
 * 整圈环形。每次都把环旋转一个固定角度（volley 计数），
 * 否则同一个缺口会反复出现在同一位置，玩家只要站进去就无敌了。
 */
export function ring(field, ex, ey, count, speed, r, k, volley) {
  const off = volley * 0.2618; // ≈ 15°
  for (let i = 0; i < count; i++) {
    const a = off + (TAU * i) / count;
    field.spawn(ex, ey, Math.cos(a) * speed, Math.sin(a) * speed, r, LIFE, k);
  }
}

/** 旋转螺旋：臂数固定，相位随时间前进 */
export function spiral(field, ex, ey, arms, phase, speed, r, k) {
  for (let i = 0; i < arms; i++) {
    const a = phase + (TAU * i) / arms;
    field.spawn(ex, ey, Math.cos(a) * speed, Math.sin(a) * speed, r, LIFE, k);
  }
}

export { TAU };
