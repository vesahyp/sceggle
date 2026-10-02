/**
 * Procedural sprite cache, the Räkkä way: every sprite is drawn once with
 * canvas paths at the render resolution and reused as an image. Coordinates
 * inside a draw function are world units centred on (0, 0).
 */
import type { GunType, Maker } from '../game/types';
import type { HeroDef } from '../game/content/heroes';
import { MAKER_INFO, RARITY_COLOR } from '../game/guns';

export interface Sprite {
  img: HTMLCanvasElement;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

type C = CanvasRenderingContext2D;

const OUT = '#16120e';
let res = 2;
const cache = new Map<string, Sprite>();

export function setSpriteResolution(r: number): void {
  const q = Math.round(r * 4) / 4;
  if (q !== res) {
    res = q;
    cache.clear();
  }
}

function make(key: string, hw: number, hh: number, draw: (c: C) => void): Sprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(hw * 2 * res);
  cv.height = Math.ceil(hh * 2 * res);
  const c = cv.getContext('2d')!;
  c.scale(res, res);
  c.translate(hw, hh);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  draw(c);
  const s = { img: cv, w: hw * 2, h: hh * 2, ox: hw, oy: hh };
  cache.set(key, s);
  return s;
}

export function blit(ctx: C, s: Sprite, x: number, y: number, flip = false, alpha = 1): void {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(s.img, -s.ox, -s.oy, s.w, s.h);
    ctx.restore();
  } else ctx.drawImage(s.img, x - s.ox, y - s.oy, s.w, s.h);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function ell(c: C, x: number, y: number, rx: number, ry: number, fill: string, stroke: string | null = OUT, lw = 1.2): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function rect(c: C, x: number, y: number, w: number, h: number, fill: string, r = 1.5, stroke: string | null = OUT, lw = 1.2): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function rivet(c: C, x: number, y: number, r = 0.9): void {
  ell(c, x, y, r, r, '#e8d090', '#5a4010', 0.4);
}

function goggles(c: C, x: number, y: number, s = 1): void {
  ell(c, x - 3 * s, y, 2.6 * s, 2.6 * s, '#c8a040', OUT, 0.9);
  ell(c, x + 3 * s, y, 2.6 * s, 2.6 * s, '#c8a040', OUT, 0.9);
  ell(c, x - 3 * s, y, 1.6 * s, 1.6 * s, '#9fe0ff', null);
  ell(c, x + 3 * s, y, 1.6 * s, 1.6 * s, '#9fe0ff', null);
  ell(c, x - 3.5 * s, y - 0.6 * s, 0.6 * s, 0.6 * s, '#ffffff', null);
  ell(c, x + 2.5 * s, y - 0.6 * s, 0.6 * s, 0.6 * s, '#ffffff', null);
}

/** A hero body, facing the viewer. The gun is drawn separately, rotated. */
export function heroSprite(d: HeroDef, frame: number): Sprite {
  return make(`hero:${d.id}:${frame}`, 18, 24, (c) => {
    const step = frame === 1 ? 1.6 : frame === 2 ? -1.6 : 0;
    // legs
    rect(c, -5.5, 8 + Math.max(0, step), 4.5, 7 - Math.max(0, step), '#2a2420', 1.5);
    rect(c, 1, 8 + Math.max(0, -step), 4.5, 7 - Math.max(0, -step), '#2a2420', 1.5);
    // coat
    c.beginPath();
    c.moveTo(-9, 10);
    c.quadraticCurveTo(-10, -2, -6, -5);
    c.lineTo(6, -5);
    c.quadraticCurveTo(10, -2, 9, 10);
    c.closePath();
    c.fillStyle = d.coat;
    c.fill();
    c.lineWidth = 1.3;
    c.strokeStyle = OUT;
    c.stroke();
    // belt and buckle
    rect(c, -8.6, 3, 17.2, 2.6, '#3a2618', 0.5, null);
    rect(c, -1.6, 2.6, 3.2, 3.4, '#e0b850', 0.6, OUT, 0.6);
    // buttons
    rivet(c, 0, -2, 0.8);
    rivet(c, 0, 0.6, 0.8);
    // head
    ell(c, 0, -10, 7, 6.8, '#f0c8a0');
    switch (d.id) {
      case 'nuohooja':
        // top hat, soot smudges
        rect(c, -9, -15.5, 18, 2.6, d.hat, 1);
        rect(c, -6, -25, 12, 10.5, d.hat, 1.2);
        rect(c, -6, -18, 12, 2, '#8a2a2a', 0, null);
        ell(c, -3.5, -8.5, 1.8, 1, 'rgba(30,30,30,0.5)', null);
        ell(c, 2.5, -10.5, 1.1, 1.1, '#1a1a1a', null);
        ell(c, -2.5, -10.5, 1.1, 1.1, '#1a1a1a', null);
        // brush over the shoulder
        c.strokeStyle = '#5a3a1a';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-8, 6);
        c.lineTo(-13, -12);
        c.stroke();
        ell(c, -13.5, -14, 3.4, 3.4, '#111', OUT, 0.8);
        break;
      case 'konemestari':
        // brass helmet with lamp, goggles
        c.beginPath();
        c.arc(0, -12, 7.8, Math.PI, 0);
        c.fillStyle = d.hat;
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1.2;
        c.stroke();
        rect(c, -9, -12.5, 18, 2.2, shade(d.hat, -0.3), 1);
        ell(c, 0, -17, 2.4, 2.2, '#fff6c0', OUT, 0.8);
        goggles(c, 0, -9.5, 0.9);
        // braid
        c.strokeStyle = '#a0502a';
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(6, -8);
        c.quadraticCurveTo(10, -2, 8, 3);
        c.stroke();
        break;
      case 'ilmalaivuri':
        // leather cap with flaps, goggles up, scarf
        c.beginPath();
        c.arc(0, -11, 7.6, Math.PI * 1.05, -0.05);
        c.lineTo(7.4, -6);
        c.lineTo(5, -6);
        c.lineTo(5.6, -10);
        c.lineTo(-5.6, -10);
        c.lineTo(-5, -6);
        c.lineTo(-7.4, -6);
        c.closePath();
        c.fillStyle = d.hat;
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1.2;
        c.stroke();
        goggles(c, 0, -15, 0.85);
        ell(c, -2.5, -9.5, 1, 1.2, '#1a1a1a', null);
        ell(c, 2.5, -9.5, 1, 1.2, '#1a1a1a', null);
        c.fillStyle = '#d83a3a';
        c.beginPath();
        c.moveTo(-6, -4.5);
        c.lineTo(6, -4.5);
        c.lineTo(5, -2);
        c.lineTo(-5, -2);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(4, -3);
        c.lineTo(11, 1);
        c.lineTo(9, 3);
        c.closePath();
        c.fill();
        break;
      case 'seppa':
        // bald, big beard, leather apron
        ell(c, 0, -12.5, 6.6, 4.6, '#e8b890', null);
        c.fillStyle = '#7a4a2a';
        c.beginPath();
        c.moveTo(-6.5, -9);
        c.quadraticCurveTo(-7, 0, 0, 1);
        c.quadraticCurveTo(7, 0, 6.5, -9);
        c.quadraticCurveTo(0, -5, -6.5, -9);
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1;
        c.stroke();
        ell(c, -2.5, -11, 1.1, 1.1, '#1a1a1a', null);
        ell(c, 2.5, -11, 1.1, 1.1, '#1a1a1a', null);
        rect(c, -4, -14.5, 3, 1.1, '#5a3a20', 0.4, null);
        rect(c, 1, -14.5, 3, 1.1, '#5a3a20', 0.4, null);
        rect(c, -6, 1, 12, 9, '#6a4a2a', 1.5, OUT, 0.9);
        break;
    }
  });
}

/** A gun, pointing right (+x), grip at the origin. */
export function gunSprite(type: GunType, maker: Maker, rarity: number): Sprite {
  return make(`gun:${type}:${maker}:${rarity}`, 24, 10, (c) => {
    const acc = MAKER_INFO[maker].color;
    const metal = maker === 'paukku' ? '#6a5a4a' : maker === 'rattaat' ? '#7a8088' : '#4a4e56';
    const wood = '#7a4a26';
    const glow = RARITY_COLOR[rarity];
    if (rarity >= 3) {
      c.shadowColor = glow;
      c.shadowBlur = 4;
    }
    switch (type) {
      case 'revolver':
        rect(c, -2, -1.5, 6, 6, wood, 1.5);
        rect(c, 2, -3.5, 7, 6, metal, 2);
        ell(c, 5.5, -0.5, 2.6, 2.6, acc, OUT, 0.8);
        rect(c, 8, -2.6, 9, 3.2, metal, 1);
        break;
      case 'scatter':
        rect(c, -4, -1.5, 8, 5, wood, 1.5);
        rect(c, 3, -4, 6, 7, acc, 1.5);
        rect(c, 8, -4, 12, 3.2, metal, 1);
        rect(c, 8, -0.4, 12, 3.2, metal, 1);
        break;
      case 'rifle':
        rect(c, -7, -1.5, 10, 4.5, wood, 1.5);
        rect(c, 2, -2.5, 8, 4.5, metal, 1);
        rect(c, 9, -1.6, 14, 2.4, metal, 0.8);
        rect(c, 2, -6, 9, 2.6, acc, 1);
        ell(c, 11, -4.7, 1.4, 1.4, '#9fe0ff', OUT, 0.6);
        break;
      case 'mortar':
        rect(c, -3, -1, 6, 5, wood, 1.5);
        rect(c, 2, -5.5, 15, 10, metal, 3);
        rect(c, 15, -6.5, 4, 12, acc, 1.5);
        rivet(c, 6, -3.5);
        rivet(c, 10, -3.5);
        rivet(c, 6, 3);
        rivet(c, 10, 3);
        break;
      case 'lance':
        ell(c, 1, 0, 5, 5.5, acc, OUT, 1.1);
        rect(c, 4, -2, 12, 4, metal, 1);
        c.beginPath();
        c.moveTo(16, -2);
        c.lineTo(21, -4.5);
        c.lineTo(21, 4.5);
        c.lineTo(16, 2);
        c.closePath();
        c.fillStyle = '#b8693a';
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1;
        c.stroke();
        break;
      case 'saw':
        rect(c, -3, -1.5, 6, 5, wood, 1.5);
        rect(c, 2, -3, 9, 6, metal, 1.5);
        ell(c, 14, 0, 6.5, 6.5, '#c8c8d0', OUT, 1);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.beginPath();
          c.moveTo(14 + Math.cos(a) * 6.5, Math.sin(a) * 6.5);
          c.lineTo(14 + Math.cos(a + 0.3) * 8.2, Math.sin(a + 0.3) * 8.2);
          c.lineTo(14 + Math.cos(a + 0.6) * 6.5, Math.sin(a + 0.6) * 6.5);
          c.fillStyle = '#e0e0e8';
          c.fill();
        }
        ell(c, 14, 0, 2, 2, acc, OUT, 0.6);
        break;
    }
    c.shadowBlur = 0;
  });
}

/** Enemies. Facing the viewer; the renderer flips them by direction. */
export function enemySprite(kind: string, color: string, frame: number, big = 1): Sprite {
  const R = 22 * big;
  return make(`enemy:${kind}:${frame}:${big}`, R, R, (c) => {
    c.scale(big, big);
    const step = frame === 1 ? 1.4 : frame === 2 ? -1.4 : 0;
    const eye = (x: number, y: number, r = 2) => {
      ell(c, x, y, r + 0.8, r + 0.8, '#2a0a06', null);
      ell(c, x, y, r, r, '#ff4a2a', null);
      ell(c, x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.35, '#ffe0c0', null);
    };
    switch (kind) {
      case 'rotta': {
        // a clockwork rat: brass body, cog ear, wire tail
        c.strokeStyle = '#8a7a6a';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(-6, 3);
        c.quadraticCurveTo(-12, 2 + step, -13, -4);
        c.stroke();
        ell(c, 0, 2, 8, 6, color);
        ell(c, 5, -1, 4.5, 4, shade(color, 0.15));
        cog(c, 2, -6, 3, '#c8a040');
        eye(7, -1.5, 1.2);
        rect(c, -5, 6 + step * 0.5, 2.2, 3, '#3a2a1a', 1, null);
        rect(c, 3, 6 - step * 0.5, 2.2, 3, '#3a2a1a', 1, null);
        break;
      }
      case 'niittari':
      case 'kaukoputki':
      case 'kipinakone':
      case 'pajapoika': {
        // a boxy automaton with a lamp eye; variants by headgear
        rect(c, -6, 9 + Math.max(0, step), 4.5, 6, '#2a2a2e', 1.5);
        rect(c, 1.5, 9 + Math.max(0, -step), 4.5, 6, '#2a2a2e', 1.5);
        rect(c, -9, -4, 18, 15, color, 3);
        rect(c, -6, -1, 12, 6, shade(color, -0.25), 1.5, null);
        rivet(c, -7, -2);
        rivet(c, 7, -2);
        rivet(c, -7, 9);
        rivet(c, 7, 9);
        rect(c, -7, -16, 14, 12, shade(color, 0.1), 3);
        if (kind === 'kaukoputki') {
          rect(c, -2, -13, 9, 5, '#2a2a2e', 1.5);
          ell(c, 7, -10.5, 2.8, 2.8, '#9fe0ff', OUT, 0.9);
          eye(-3, -10, 1.5);
        } else if (kind === 'kipinakone') {
          c.strokeStyle = '#7fd8ff';
          c.lineWidth = 1.4;
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.ellipse(0, -19 - i * 2.2, 4 - i, 1.4, 0, 0, Math.PI * 2);
            c.stroke();
          }
          eye(0, -10, 2.2);
        } else if (kind === 'pajapoika') {
          rect(c, -8, -19, 16, 4, '#3a3a3a', 2);
          rect(c, -4.5, -23, 9, 5, '#3a3a3a', 2);
          eye(-2.8, -10, 1.6);
          eye(2.8, -10, 1.6);
          rect(c, -5, 1, 10, 9, '#5a3a20', 1, OUT, 0.7);
        } else {
          eye(0, -10, 2.4);
          rect(c, -1, -20, 2, 4, '#3a3a3a', 0.5, null);
          ell(c, 0, -20.5, 1.6, 1.6, '#ff9a3a', null);
        }
        break;
      }
      case 'pommari': {
        // a bomb on legs
        c.strokeStyle = '#2a2a2a';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-5, 6);
        c.lineTo(-8, 12 + step);
        c.moveTo(5, 6);
        c.lineTo(8, 12 - step);
        c.stroke();
        ell(c, 0, 0, 10, 10, '#2a2a30');
        ell(c, -3.5, -3.5, 3, 2.2, 'rgba(255,255,255,0.25)', null);
        rect(c, -3, -13, 6, 4, '#8a8a90', 1);
        c.strokeStyle = '#c8a070';
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(0, -13);
        c.quadraticCurveTo(3, -17, 6, -16);
        c.stroke();
        ell(c, 6.5, -16, 2, 2, '#ffd040', null);
        eye(-3, 1, 1.5);
        eye(3, 1, 1.5);
        break;
      }
      case 'kattilamies': {
        // a walking boiler with a chimney
        rect(c, -9, 10 + Math.max(0, step), 7, 8, '#2a2a2e', 2);
        rect(c, 2, 10 + Math.max(0, -step), 7, 8, '#2a2a2e', 2);
        ell(c, 0, 0, 15, 14, color);
        ell(c, 0, 0, 10, 9, shade(color, -0.2), null);
        rect(c, -6, -2, 12, 7, '#2a1a10', 2, OUT, 1);
        rect(c, -4.5, -0.5, 9, 4, '#ff7a2a', 1, null);
        for (let i = 0; i < 6; i++) rivet(c, Math.cos((i / 6) * Math.PI * 2) * 12.5, Math.sin((i / 6) * Math.PI * 2) * 11.5, 1.1);
        rect(c, 5, -21, 5, 10, '#3a3a40', 1);
        rect(c, 4, -22, 7, 2.5, '#2a2a30', 1);
        eye(-5, -7, 1.8);
        eye(5, -7, 1.8);
        rect(c, -18, -3, 5, 10, color, 2);
        rect(c, 13, -3, 5, 10, color, 2);
        break;
      }
      case 'mortteli': {
        rect(c, -6, 9 + Math.max(0, step), 4.5, 6, '#2a2a2e', 1.5);
        rect(c, 1.5, 9 + Math.max(0, -step), 4.5, 6, '#2a2a2e', 1.5);
        rect(c, -9, -3, 18, 13, color, 3);
        c.beginPath();
        c.arc(0, -8, 8, Math.PI, 0);
        c.fillStyle = '#3a4a2a';
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1.2;
        c.stroke();
        rect(c, -9, -8.5, 18, 2.2, '#2a3a1a', 1);
        eye(-2.5, -5, 1.4);
        eye(2.5, -5, 1.4);
        // the tube on the back
        rect(c, 6, -16, 7, 16, '#4a4e56', 2);
        ell(c, 9.5, -16, 3.5, 1.6, '#1a1a1a', null);
        break;
      }
      case 'torni': {
        // a squat tower on a round base
        ell(c, 0, 6, 15, 9, '#3a3a40');
        rect(c, -11, -10, 22, 18, color, 3);
        for (let i = 0; i < 4; i++) rivet(c, -8 + i * 5.3, 5);
        rect(c, -7, -17, 14, 9, shade(color, 0.15), 2);
        eye(0, -12.5, 2.2);
        cog(c, -11, -10, 4, '#c8a040');
        break;
      }
      case 'boss':
        break;
    }
  });
}

function cog(c: C, x: number, y: number, r: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.beginPath();
  const n = 8;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 1.35;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 0.8;
  c.strokeStyle = OUT;
  c.stroke();
  ell(c, 0, 0, r * 0.4, r * 0.4, '#3a2a10', null);
  c.restore();
}

/** Bosses: big and named, one sprite each. */
export function bossSprite(id: string, color: string, frame: number): Sprite {
  return make(`boss:${id}:${frame}`, 46, 50, (c) => {
    const step = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    const eye = (x: number, y: number, r = 3) => {
      ell(c, x, y, r + 1.2, r + 1.2, '#2a0a06', null);
      ell(c, x, y, r, r, '#ff3a1a', null);
      ell(c, x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.35, '#fff0c0', null);
    };
    switch (id) {
      case 'kattilakuningas':
        rect(c, -18, 20 + Math.max(0, step), 12, 14, '#2a2a2e', 3);
        rect(c, 6, 20 + Math.max(0, -step), 12, 14, '#2a2a2e', 3);
        ell(c, 0, 2, 30, 26, color, OUT, 2);
        ell(c, 0, 4, 20, 16, shade(color, -0.25), null);
        rect(c, -12, 0, 24, 13, '#2a1a10', 3, OUT, 1.5);
        rect(c, -9, 3, 18, 7, '#ff7a2a', 2, null);
        for (let i = 0; i < 10; i++) rivet(c, Math.cos((i / 10) * Math.PI * 2) * 26, 2 + Math.sin((i / 10) * Math.PI * 2) * 22, 1.6);
        // the crown: three chimneys
        for (const [x, h] of [[-12, 14], [0, 20], [12, 14]] as const) {
          rect(c, x - 4, -24 - h + 4, 8, h, '#3a3a40', 1.5);
          rect(c, x - 5.5, -24 - h + 2, 11, 4, '#c8a040', 1.5);
        }
        eye(-9, -12, 3.4);
        eye(9, -12, 3.4);
        break;
      case 'mestarimorssari':
        rect(c, -14, 18 + Math.max(0, step), 10, 12, '#2a2a2e', 2.5);
        rect(c, 4, 18 + Math.max(0, -step), 10, 12, '#2a2a2e', 2.5);
        rect(c, -22, -10, 44, 32, color, 6, OUT, 2);
        c.beginPath();
        c.arc(0, -12, 16, Math.PI, 0);
        c.fillStyle = '#3a4a2a';
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 1.6;
        c.stroke();
        eye(-6, -6, 2.6);
        eye(6, -6, 2.6);
        for (const x of [-18, 18]) {
          rect(c, x - 6, -36, 12, 28, '#4a4e56', 3, OUT, 1.6);
          ell(c, x, -36, 6, 2.6, '#1a1a1a', null);
        }
        cog(c, 0, 10, 7, '#c8a040');
        break;
      case 'kellokoneisto':
        ell(c, 0, 0, 34, 34, '#5a3a1a', OUT, 2);
        ell(c, 0, 0, 29, 29, '#f2e6c8', OUT, 1.4);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          c.strokeStyle = OUT;
          c.lineWidth = i % 3 ? 1.2 : 2.4;
          c.beginPath();
          c.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
          c.lineTo(Math.cos(a) * 28, Math.sin(a) * 28);
          c.stroke();
        }
        cog(c, -26, -26, 8, '#c8a040');
        cog(c, 27, -24, 6, '#b8693a');
        eye(-9, -6, 3.6);
        eye(9, -6, 3.6);
        break;
      case 'tehtailija':
        rect(c, -12, 22 + Math.max(0, step), 9, 12, '#1a1a1e', 2.5);
        rect(c, 3, 22 + Math.max(0, -step), 9, 12, '#1a1a1e', 2.5);
        c.beginPath();
        c.moveTo(-22, 24);
        c.quadraticCurveTo(-26, -4, -14, -8);
        c.lineTo(14, -8);
        c.quadraticCurveTo(26, -4, 22, 24);
        c.closePath();
        c.fillStyle = color;
        c.fill();
        c.strokeStyle = OUT;
        c.lineWidth = 2;
        c.stroke();
        rect(c, -3, -8, 6, 26, '#f0f0f0', 1, OUT, 1);
        ell(c, 0, -20, 14, 13, '#f0c8a0', OUT, 1.6);
        rect(c, -16, -30, 32, 4, '#1a1a1e', 2);
        rect(c, -11, -48, 22, 19, '#1a1a1e', 2);
        rect(c, -11, -34, 22, 3, '#c8a040', 0, null);
        // monocle and moustache
        ell(c, 5, -21, 3.6, 3.6, 'rgba(180,230,255,0.4)', '#c8a040', 1.2);
        ell(c, -5, -21, 1.6, 1.6, '#1a1a1a', null);
        c.fillStyle = '#3a2a1a';
        c.beginPath();
        c.moveTo(0, -15);
        c.quadraticCurveTo(-9, -17, -12, -12);
        c.quadraticCurveTo(-5, -13, 0, -13);
        c.quadraticCurveTo(5, -13, 12, -12);
        c.quadraticCurveTo(9, -17, 0, -15);
        c.fill();
        break;
    }
  });
}

/** A turret the engineer sets down. */
export function turretSprite(): Sprite {
  return make('turret', 14, 14, (c) => {
    ell(c, 0, 4, 12, 7, '#4a4e56');
    rect(c, -8, -8, 16, 13, '#c8a040', 3);
    rivet(c, -5, -5);
    rivet(c, 5, -5);
    ell(c, 0, -2, 3, 3, '#9fe0ff', OUT, 0.8);
  });
}

export function coinSprite(): Sprite {
  return make('coin', 7, 7, (c) => cog(c, 0, 0, 4.2, '#e8c050'));
}

export function steamSprite(): Sprite {
  return make('steam', 8, 10, (c) => {
    rect(c, -5, -6, 10, 13, 'rgba(200,240,255,0.5)', 3);
    rect(c, -4, -1, 8, 7, '#7dffb0', 2, null);
    rect(c, -3, -9, 6, 3, '#c8a040', 1);
    ell(c, -1.5, -2, 1.2, 2.5, 'rgba(255,255,255,0.7)', null);
  });
}

/** The lift: a round brass platform. */
export function liftSprite(open: boolean): Sprite {
  return make(`lift:${open}`, 34, 34, (c) => {
    ell(c, 0, 0, 30, 30, '#3a3a40', OUT, 2);
    ell(c, 0, 0, 25, 25, '#c8a040', OUT, 1.5);
    c.strokeStyle = 'rgba(40,30,10,0.7)';
    c.lineWidth = 1.5;
    for (let i = -20; i <= 20; i += 5) {
      const h = Math.sqrt(Math.max(0, 25 * 25 - i * i));
      c.beginPath();
      c.moveTo(i, -h);
      c.lineTo(i, h);
      c.stroke();
    }
    for (let i = 0; i < 8; i++) rivet(c, Math.cos((i / 8) * Math.PI * 2) * 27.5, Math.sin((i / 8) * Math.PI * 2) * 27.5, 1.3);
    const light = open ? '#7dff7a' : '#ff4a3a';
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) ell(c, Math.cos(a) * 30, Math.sin(a) * 30, 3, 3, light, OUT, 0.8);
  });
}
