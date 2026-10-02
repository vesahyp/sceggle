import { BARREL, BUSH, CRATE, CRATE_HP, PIT, T, VENT, WALL, type Arena } from '../game/arena';
import { BOSSES, ENEMIES } from '../game/content/enemies';
import { ELEMENT_COLOR, MAKER_INFO, RARITY_COLOR } from '../game/guns';
import { hash2 } from '../game/rng';
import type { Hero, SimState } from '../game/state';
import type { Enemy, Projectile } from '../game/types';
import { maxAmmo } from '../game/weapons';
import { bossSprite, blit, coinSprite, enemySprite, gunSprite, heroSprite, liftSprite, setSpriteResolution, steamSprite, turretSprite } from './sprites';

/** How tall a wall stands above its tile, in world units: the 3/4 view. */
const WH = 16;

interface Palette {
  floor: string;
  floor2: string;
  seam: string;
  wallTop: string;
  wallFront: string;
  mortar: string;
  bush: string;
  bush2: string;
}

const PALETTES: Palette[] = [
  // the mill: iron plates and red brick
  { floor: '#3a3632', floor2: '#423d37', seam: '#24211e', wallTop: '#a0503a', wallFront: '#6a2e22', mortar: '#3a1810', bush: '#4a7a3a', bush2: '#2f5a2a' },
  // the rapids station: wet stone and verdigris
  { floor: '#2e3a3a', floor2: '#344242', seam: '#1a2424', wallTop: '#6a8a80', wallFront: '#3a5a52', mortar: '#1a2a26', bush: '#3a8a5a', bush2: '#22603a' },
  // the rooftops: tar paper and copper
  { floor: '#2a2630', floor2: '#322d38', seam: '#18151c', wallTop: '#b8693a', wallFront: '#7a3a1a', mortar: '#3a1a0a', bush: '#5a7a3a', bush2: '#3a5a22' },
  // the counting house: parquet and dark panelling
  { floor: '#4a3424', floor2: '#523a28', seam: '#2a1a10', wallTop: '#5a2a3a', wallFront: '#3a1622', mortar: '#1a0a10', bush: '#4a6a3a', bush2: '#2a4a22' },
];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private scale = 1;
  private t = 0;
  private floorFor: Arena | null = null;
  private floorImg: HTMLCanvasElement | null = null;
  private floorRes = 1;
  camX = 0;
  camY = 0;
  private camInit = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize(): void {
    const c = this.canvas;
    this.cssW = c.clientWidth || window.innerWidth;
    this.cssH = c.clientHeight || window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(this.cssW * this.dpr);
    c.height = Math.round(this.cssH * this.dpr);
    // About 330k square units in view, whatever the shape: 12 tiles across a
    // portrait phone, 26 across a landscape one.
    const cssScale = Math.max(0.75, Math.sqrt((this.cssW * this.cssH) / 330000));
    this.scale = cssScale * this.dpr;
    setSpriteResolution(this.scale);
    this.floorFor = null;
  }

  needsResize(): boolean {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    return w !== this.cssW || h !== this.cssH || Math.min(2, window.devicePixelRatio || 1) !== this.dpr;
  }

  view(): { w: number; h: number } {
    return { w: this.canvas.width / this.scale, h: this.canvas.height / this.scale };
  }

  /** World to css px, for the input's mouse aim and the HUD. */
  toScreen(x: number, y: number): { x: number; y: number; scale: number } {
    const s = this.scale / this.dpr;
    return { x: (x - this.camX) * s + this.cssW / 2, y: (y - this.camY) * s + this.cssH / 2, scale: s };
  }

  private floorLayer(a: Arena): HTMLCanvasElement {
    if (this.floorFor === a && this.floorImg) return this.floorImg;
    const p = PALETTES[a.style];
    const r = Math.min(this.scale, 1.6);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(a.w * T * r);
    cv.height = Math.ceil(a.h * T * r);
    const c = cv.getContext('2d')!;
    c.scale(r, r);
    for (let ty = 0; ty < a.h; ty++) {
      for (let tx = 0; tx < a.w; tx++) {
        const x = tx * T;
        const y = ty * T;
        const tt = a.tiles[ty * a.w + tx];
        const hv = hash2(tx, ty, a.style);
        c.fillStyle = (tx + ty) % 2 ? p.floor : p.floor2;
        c.fillRect(x, y, T, T);
        if (tt === PIT) continue;
        // plate seams and rivets
        c.strokeStyle = p.seam;
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
        c.fillStyle = 'rgba(255,230,180,0.12)';
        for (const [rx, ry] of [[4, 4], [T - 4, 4], [4, T - 4], [T - 4, T - 4]]) {
          c.beginPath();
          c.arc(x + rx, y + ry, 1.2, 0, Math.PI * 2);
          c.fill();
        }
        if (hv < 0.08) {
          // a grate
          c.fillStyle = 'rgba(0,0,0,0.35)';
          c.fillRect(x + 6, y + 6, T - 12, T - 12);
          c.strokeStyle = 'rgba(150,140,120,0.35)';
          for (let i = 8; i < T - 6; i += 4) {
            c.beginPath();
            c.moveTo(x + i, y + 6);
            c.lineTo(x + i, y + T - 6);
            c.stroke();
          }
        } else if (hv < 0.2) {
          // oil and soot
          c.fillStyle = 'rgba(0,0,0,0.18)';
          c.beginPath();
          c.ellipse(x + T * hash2(tx, ty, 9), y + T * hash2(tx, ty, 8), 6 + hv * 40, 4 + hv * 20, hv * 9, 0, Math.PI * 2);
          c.fill();
        }
        if (tt === VENT) {
          c.fillStyle = '#1a1816';
          c.beginPath();
          c.arc(x + T / 2, y + T / 2, 12, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#8a7a5a';
          c.lineWidth = 2;
          c.stroke();
          for (let i = 0; i < 6; i++) {
            const an = (i / 6) * Math.PI;
            c.beginPath();
            c.moveTo(x + T / 2 + Math.cos(an) * 10, y + T / 2 + Math.sin(an) * 10);
            c.lineTo(x + T / 2 - Math.cos(an) * 10, y + T / 2 - Math.sin(an) * 10);
            c.stroke();
          }
        }
      }
    }
    // Shadows cast by blocks onto the floor south of them.
    for (let ty = 0; ty < a.h - 1; ty++) {
      for (let tx = 0; tx < a.w; tx++) {
        const tt = a.tiles[ty * a.w + tx];
        if (tt !== WALL) continue;
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.fillRect(tx * T, (ty + 1) * T, T, 8);
      }
    }
    this.floorImg = cv;
    this.floorRes = r;
    this.floorFor = a;
    return cv;
  }

  render(s: SimState, dt: number, local: Hero | null): void {
    this.t += dt;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sc = this.scale;
    const a = s.arena;
    const viewW = W / sc;
    const viewH = H / sc;
    // The camera eases after the heroes and leans toward the aim a little.
    let tx = s.cam.x;
    let ty = s.cam.y;
    if (local && local.aimShow.on) {
      tx += local.aimShow.x * 60;
      ty += local.aimShow.y * 60;
    }
    const minX = Math.min(viewW / 2, (a.w * T) / 2);
    const maxX = Math.max(a.w * T - viewW / 2, (a.w * T) / 2);
    const minY = Math.min(viewH / 2 - WH, (a.h * T) / 2);
    const maxY = Math.max(a.h * T - viewH / 2, (a.h * T) / 2);
    tx = Math.max(minX, Math.min(maxX, tx));
    ty = Math.max(minY, Math.min(maxY, ty));
    if (!this.camInit || s.floorTime < 0.05) {
      this.camX = tx;
      this.camY = ty;
      this.camInit = true;
    }
    const k = 1 - Math.pow(0.0005, dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const shake = s.shake > 0 ? Math.min(1, s.shake) * 9 : 0;
    const camX = this.camX + (shake ? (Math.random() - 0.5) * shake : 0);
    const camY = this.camY + (shake ? (Math.random() - 0.5) * shake : 0);
    const left = camX - viewW / 2;
    const top = camY - viewH / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e0c0a';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(sc, 0, 0, sc, -left * sc, -top * sc);
    const p = PALETTES[a.style];

    // Floor.
    const fl = this.floorLayer(a);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fl, 0, 0, fl.width / this.floorRes, fl.height / this.floorRes);

    const x0 = Math.max(0, Math.floor(left / T) - 1);
    const x1 = Math.min(a.w - 1, Math.floor((left + viewW) / T) + 1);
    const y0 = Math.max(0, Math.floor(top / T) - 1);
    const y1 = Math.min(a.h - 1, Math.floor((top + viewH + WH) / T) + 1);

    // The rapids: dark water with moving foam.
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (a.tiles[yy * a.w + xx] !== PIT) continue;
        const x = xx * T;
        const y = yy * T;
        ctx.fillStyle = '#10243a';
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = 'rgba(120,180,220,0.35)';
        for (let i = 0; i < 3; i++) {
          const fx = x + ((hash2(xx, yy, i) * T + this.t * 70) % T);
          const fy = y + 6 + i * 9 + Math.sin(this.t * 3 + xx + i) * 2;
          ctx.fillRect(fx, fy, 8, 2);
        }
        // banks
        if (yy > 0 && a.tiles[(yy - 1) * a.w + xx] !== PIT) {
          ctx.fillStyle = '#1a1612';
          ctx.fillRect(x, y, T, 5);
        }
      }
    }

    // Ground zones.
    for (const z of s.zones) {
      const f = Math.min(1, z.life / 0.4, (z.maxLife - z.life) / 0.2 + 0.2);
      ctx.globalAlpha = Math.max(0, f);
      if (z.kind === 'fire') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
        g.addColorStop(0, z.team === 1 ? 'rgba(255,80,40,0.55)' : 'rgba(255,150,40,0.5)');
        g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          const an = hash2(z.id, i) * Math.PI * 2;
          const rr = hash2(z.id, i + 9) * z.r * 0.7;
          const fh = 4 + Math.sin(this.t * 12 + i) * 2;
          ctx.fillStyle = '#ffb040';
          ctx.beginPath();
          ctx.ellipse(z.x + Math.cos(an) * rr, z.y + Math.sin(an) * rr - fh / 2, 2.5, fh, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (z.kind === 'soot') {
        for (let i = 0; i < 7; i++) {
          const an = hash2(z.id, i) * Math.PI * 2 + this.t * 0.3;
          const rr = hash2(z.id, i + 9) * z.r * 0.6;
          ctx.fillStyle = 'rgba(20,20,24,0.55)';
          ctx.beginPath();
          ctx.arc(z.x + Math.cos(an) * rr, z.y + Math.sin(an) * rr, z.r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (z.kind === 'steam') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
        const heal = z.team === 0;
        g.addColorStop(0, heal ? 'rgba(200,255,220,0.6)' : 'rgba(240,240,250,0.75)');
        g.addColorStop(1, 'rgba(240,240,250,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y - (1 - z.life / z.maxLife) * 10, z.r * (1.1 - z.life / z.maxLife * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Vents about to blow hiss a little first.
    for (const v of a.vents) {
      if (v.t > 0.8) continue;
      const x = ((v.i % a.w) + 0.5) * T;
      const y = (Math.floor(v.i / a.w) + 0.5) * T;
      ctx.strokeStyle = `rgba(255,240,220,${0.6 - v.t * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 44 * (1 - v.t / 0.8) + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The lift.
    const open = s.phase !== 'fight';
    blit(ctx, liftSprite(open), a.liftX, a.liftY);
    if (open) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
      const g = ctx.createLinearGradient(0, a.liftY - 120, 0, a.liftY);
      g.addColorStop(0, 'rgba(120,255,120,0)');
      g.addColorStop(1, `rgba(120,255,120,${0.25 + 0.2 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(a.liftX - 26, a.liftY - 120, 52, 120);
      if (s.liftT > 0) {
        ctx.strokeStyle = '#9fff9a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(a.liftX, a.liftY, 36, -Math.PI / 2, -Math.PI / 2 + (s.liftT / 0.8) * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Spawn hatches: steam rising where something is about to climb out.
    for (const m of s.marks) {
      const f = Math.max(0, 1 - m.t);
      ctx.strokeStyle = m.boss >= 0 ? `rgba(255,80,60,${0.4 + f * 0.5})` : `rgba(255,200,140,${0.25 + f * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, (m.boss >= 0 ? 34 : 14) * (0.5 + f * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(230,230,230,${0.15 + f * 0.3})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y - f * 10, 8 + f * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Enemy telegraphs on the ground: where shells will land, where a brute will charge.
    for (const pr of s.projectiles) {
      if (pr.team !== 1 || !pr.lob) continue;
      const f = pr.lob.t / pr.lob.dur;
      ctx.fillStyle = `rgba(255,60,40,${0.12 + f * 0.25})`;
      ctx.strokeStyle = 'rgba(255,80,60,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pr.lob.tx, pr.lob.ty, pr.blast, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,40,0.35)';
      ctx.beginPath();
      ctx.arc(pr.lob.tx, pr.lob.ty, pr.blast * f, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const e of s.enemies) {
      if (e.mode !== 'windup') continue;
      const h = nearestHero(s, e);
      if (!h) continue;
      const an = Math.atan2(h.y - e.y, h.x - e.x);
      if (e.behaviour === 'brute' || e.boss) {
        ctx.fillStyle = 'rgba(255,60,40,0.22)';
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(an);
        ctx.fillRect(0, -e.r, 300, e.r * 2);
        ctx.restore();
      } else if (e.held) {
        const len = e.held.gun.type === 'mortar' ? 0 : Math.min(e.held.gun.range, 400);
        if (len) {
          ctx.strokeStyle = 'rgba(255,70,50,0.5)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(an) * len, e.y + Math.sin(an) * len);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Aim guides for the local hero.
    if (local && local.alive) this.drawAim(s, local);

    // Drops.
    for (const d of s.drops) {
      const bob = Math.sin(this.t * 4 + d.id) * 2;
      if (d.kind === 'coin') blit(ctx, coinSprite(), d.x, d.y + bob * 0.5);
      else if (d.kind === 'steam') blit(ctx, steamSprite(), d.x, d.y + bob);
      else if (d.gun) {
        const g = d.gun;
        const col = RARITY_COLOR[g.rarity];
        if (g.rarity >= 2) {
          // a beam of light, taller for better guns
          const hgt = 60 + g.rarity * 50;
          const gr = ctx.createLinearGradient(0, d.y - hgt, 0, d.y);
          gr.addColorStop(0, 'rgba(0,0,0,0)');
          gr.addColorStop(1, col);
          ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 3 + d.id);
          ctx.fillStyle = gr;
          ctx.fillRect(d.x - 7, d.y - hgt, 14, hgt);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 4 + d.id);
        ctx.beginPath();
        ctx.ellipse(d.x, d.y + 4, 16, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(d.x - 8, d.y + bob - 4);
        ctx.rotate(-0.3);
        blit(ctx, gunSprite(g.type, g.maker, g.rarity), 0, 0);
        ctx.restore();
      }
    }

    // Shadows under bodies.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const h of s.heroes) if (h.alive) shadow(ctx, h.x, h.y + 10, h.leap ? 10 : 11, 4);
    for (const e of s.enemies) shadow(ctx, e.x, e.y + e.r * 0.8, e.r * 0.95, e.r * 0.38);

    // Row by row: blocks of the row, then the bodies standing in it, then the weeds over them.
    const rows: (Hero | Enemy | SimState['turrets'][number])[][] = [];
    for (let r = y0; r <= y1 + 1; r++) rows.push([]);
    const rowOf = (y: number) => Math.max(0, Math.min(rows.length - 1, Math.floor(y / T) - y0));
    for (const h of s.heroes) rows[rowOf(h.y)].push(h);
    for (const e of s.enemies) rows[rowOf(e.y)].push(e);
    for (const tu of s.turrets) rows[rowOf(tu.y)].push(tu);
    const hiddenHeroes: Hero[] = [];
    for (let r = y0; r <= y1; r++) {
      for (let xx = x0; xx <= x1; xx++) {
        const tt = a.tiles[r * a.w + xx];
        if (tt === WALL) this.wall(ctx, a, xx, r, p);
        else if (tt === CRATE) this.crate(ctx, xx, r, a.hp[r * a.w + xx]);
        else if (tt === BARREL) this.barrel(ctx, xx, r);
      }
      const bodies = rows[r - y0];
      bodies.sort((m, n) => m.y - n.y);
      for (const b of bodies) {
        if ('def' in b) {
          this.hero(ctx, s, b);
          if (b.hidden && b === local) hiddenHeroes.push(b);
        } else if ('behaviour' in b) this.enemy(ctx, s, b, local);
        else {
          blit(ctx, turretSprite(), b.x, b.y);
          ctx.save();
          ctx.translate(b.x, b.y - 4);
          ctx.rotate(b.facing);
          if (Math.cos(b.facing) < 0) ctx.scale(1, -1);
          blit(ctx, gunSprite(b.held.gun.type, b.held.gun.maker, b.held.gun.rarity), 4, 0);
          ctx.restore();
        }
      }
      for (let xx = x0; xx <= x1; xx++) if (a.tiles[r * a.w + xx] === BUSH) this.bush(ctx, xx, r, p, s);
    }
    // You can see yourself through the weeds; nobody else can.
    for (const h of hiddenHeroes) this.hero(ctx, s, h, 0.55);

    // Projectiles.
    ctx.globalCompositeOperation = 'lighter';
    for (const pr of s.projectiles) this.projectile(ctx, pr);
    ctx.globalCompositeOperation = 'source-over';
    for (const pr of s.projectiles) if (pr.team === 1 && !pr.lob) this.enemyBullet(ctx, pr);

    // Effects.
    for (const ef of s.effects) {
      const f = ef.life / ef.maxLife;
      switch (ef.kind) {
        case 'blast': {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(ef.x, ef.y, 0, ef.x, ef.y, ef.r);
          g.addColorStop(0, `rgba(255,255,220,${f})`);
          g.addColorStop(0.4, hexA(ef.color, f * 0.8));
          g.addColorStop(1, hexA(ef.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, ef.r * (1.1 - f * 0.3), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = `rgba(255,240,200,${f})`;
          ctx.lineWidth = 3 * f;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, ef.r * (1.2 - f * 0.4), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'ring':
          ctx.strokeStyle = hexA(ef.color, f);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, ef.r * (1 - f * 0.7), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'spark':
          ctx.fillStyle = hexA(ef.color, f);
          for (let i = 0; i < 4; i++) {
            const an = hash2(Math.floor(ef.x), Math.floor(ef.y), i) * Math.PI * 2;
            const rr = ef.r * (1.6 - f);
            ctx.fillRect(ef.x + Math.cos(an) * rr - 1, ef.y + Math.sin(an) * rr - 1, 2.4, 2.4);
          }
          break;
        case 'muzzle': {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(ef.x, ef.y, 0, ef.x, ef.y, ef.r);
          g.addColorStop(0, hexA(ef.color, f));
          g.addColorStop(1, hexA(ef.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, ef.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'puff':
          ctx.fillStyle = `rgba(220,220,220,${f * 0.5})`;
          for (let i = 0; i < 4; i++) {
            const an = (i / 4) * Math.PI * 2 + ef.x;
            const rr = ef.r * (1 - f) * 0.8;
            ctx.beginPath();
            ctx.arc(ef.x + Math.cos(an) * rr, ef.y + Math.sin(an) * rr - (1 - f) * 12, ef.r * 0.35 * (0.6 + f * 0.4), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'debris':
          ctx.fillStyle = hexA(ef.color, Math.min(1, f * 1.5));
          for (let i = 0; i < 7; i++) {
            const an = hash2(Math.floor(ef.x * 3), Math.floor(ef.y), i) * Math.PI * 2;
            const sp = 0.5 + hash2(i, Math.floor(ef.x)) * 0.8;
            const rr = ef.r * (1 - f) * sp * 1.4;
            const z = Math.sin((1 - f) * Math.PI) * 14 * sp;
            ctx.fillRect(ef.x + Math.cos(an) * rr - 1.5, ef.y + Math.sin(an) * rr * 0.6 - z - 1.5, 3, 3);
          }
          break;
        case 'chain': {
          ctx.strokeStyle = hexA(ef.color, f);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(ef.x, ef.y);
          const n = 6;
          for (let i = 1; i < n; i++) {
            const fx = ef.x + ((ef.x2 - ef.x) * i) / n + (Math.random() - 0.5) * 12;
            const fy = ef.y + ((ef.y2 - ef.y) * i) / n + (Math.random() - 0.5) * 12;
            ctx.lineTo(fx, fy);
          }
          ctx.lineTo(ef.x2, ef.y2);
          ctx.stroke();
          break;
        }
        case 'dash':
          ctx.strokeStyle = hexA('#202024', f * 0.7);
          ctx.lineWidth = ef.r * 2 * f;
          ctx.beginPath();
          ctx.moveTo(ef.x, ef.y);
          ctx.lineTo(ef.x2, ef.y2);
          ctx.stroke();
          break;
        default:
          break;
      }
    }

    // Bars over the heroes: health, ammo, super ready.
    for (const h of s.heroes) if (h.alive) this.heroBars(ctx, s, h);

    // Damage numbers.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tx2 of s.texts) {
      const f = Math.min(1, tx2.life * 3);
      ctx.globalAlpha = f;
      ctx.font = `900 ${tx2.big ? 15 : 11}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(tx2.text, tx2.x, tx2.y);
      ctx.fillStyle = tx2.color;
      ctx.fillText(tx2.text, tx2.x, tx2.y);
    }
    ctx.globalAlpha = 1;

    // Screen space: the lift arrow when it is off screen, a vignette, the hurt flash.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (open) {
      const sx = (a.liftX - left) * sc;
      const sy = (a.liftY - top) * sc;
      if (sx < 0 || sy < 0 || sx > W || sy > H) this.edgeArrow(ctx, sx, sy, W, H, '#7dff7a');
    }
    for (const d of s.drops) {
      if (d.kind !== 'gun' || !d.gun || d.gun.rarity < 3) continue;
      const sx = (d.x - left) * sc;
      const sy = (d.y - top) * sc;
      if (sx < 0 || sy < 0 || sx > W || sy > H) this.edgeArrow(ctx, sx, sy, W, H, RARITY_COLOR[d.gun.rarity]);
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,6,2,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    if (local && local.hurtFlash > 0) {
      ctx.fillStyle = `rgba(200,30,20,${local.hurtFlash * 0.9})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (local && local.alive && local.hp < local.stats.maxHp * 0.3) {
      const pulse = 0.25 + 0.15 * Math.sin(this.t * 6);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(180,20,10,${pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private edgeArrow(ctx: CanvasRenderingContext2D, sx: number, sy: number, W: number, H: number, color: string): void {
    const cx = W / 2;
    const cy = H / 2;
    const an = Math.atan2(sy - cy, sx - cx);
    const m = 34 * this.dpr;
    const kx = (W / 2 - m) / Math.abs(Math.cos(an) || 1e-6);
    const ky = (H / 2 - m) / Math.abs(Math.sin(an) || 1e-6);
    const k = Math.min(kx, ky);
    const x = cx + Math.cos(an) * k;
    const y = cy + Math.sin(an) * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(an);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2 * this.dpr;
    const s = (10 + 2 * Math.sin(this.t * 6)) * this.dpr;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, -s * 0.8);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.7, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private wall(ctx: CanvasRenderingContext2D, a: Arena, tx: number, ty: number, p: Palette): void {
    const x = tx * T;
    const y = ty * T;
    const below = ty + 1 < a.h ? a.tiles[(ty + 1) * a.w + tx] : WALL;
    // front face, only where the floor shows below
    if (below !== WALL) {
      ctx.fillStyle = p.wallFront;
      ctx.fillRect(x, y + T - WH, T, WH);
      ctx.fillStyle = p.mortar;
      for (let r = 0; r < 3; r++) {
        const yy = y + T - WH + r * (WH / 3);
        ctx.fillRect(x, yy, T, 1);
        const off = (r % 2) * 8;
        for (let bx = off; bx < T; bx += 16) ctx.fillRect(x + bx, yy, 1, WH / 3);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + T - 3, T, 3);
    }
    // top
    ctx.fillStyle = p.wallTop;
    ctx.fillRect(x, y - WH, T, T);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y - WH, T, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    if (hash2(tx, ty, 3) < 0.5) ctx.fillRect(x + 4, y - WH + 8, T - 8, 2);
    else ctx.fillRect(x + 8, y - WH + 6, 2, T - 12);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - WH + 0.5, T - 1, T - 1);
  }

  private crate(ctx: CanvasRenderingContext2D, tx: number, ty: number, hp: number): void {
    const x = tx * T + 2;
    const y = ty * T + 2;
    const s = T - 4;
    const h = 12;
    const dmg = 1 - hp / CRATE_HP;
    ctx.fillStyle = '#6a4224';
    ctx.fillRect(x, y + s - h, s, h);
    ctx.fillStyle = '#9a6a3a';
    ctx.fillRect(x, y - h, s, s);
    ctx.strokeStyle = '#4a2a14';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y - h + 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(x + 2, y - h + 2);
    ctx.lineTo(x + s - 2, y - h + s - 2);
    ctx.moveTo(x + s - 2, y - h + 2);
    ctx.lineTo(x + 2, y - h + s - 2);
    ctx.stroke();
    if (dmg > 0.3) {
      ctx.strokeStyle = 'rgba(30,15,5,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 6, y - h + 4);
      ctx.lineTo(x + 12, y - h + 12);
      ctx.lineTo(x + 9, y - h + 20);
      if (dmg > 0.6) {
        ctx.moveTo(x + s - 5, y - h + 6);
        ctx.lineTo(x + s - 12, y - h + 14);
      }
      ctx.stroke();
    }
  }

  private barrel(ctx: CanvasRenderingContext2D, tx: number, ty: number): void {
    const x = tx * T + T / 2;
    const y = ty * T + T / 2;
    ctx.fillStyle = '#8a1a14';
    ctx.fillRect(x - 11, y - 14, 22, 22);
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 11, 4, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#c8302a';
    ctx.beginPath();
    ctx.ellipse(x, y - 14, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x - 11, y - 7, 22, 2.5);
    ctx.fillRect(x - 11, y + 2, 22, 2.5);
    // hazard mark
    ctx.fillStyle = '#ffd040';
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 5, y + 2);
    ctx.lineTo(x - 5, y + 2);
    ctx.closePath();
    ctx.fill();
    const glow = 0.5 + 0.5 * Math.sin(this.t * 4 + tx);
    ctx.fillStyle = `rgba(255,220,120,${0.3 + glow * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x - 4, y - 15, 3, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private bush(ctx: CanvasRenderingContext2D, tx: number, ty: number, p: Palette, s: SimState): void {
    const x = tx * T;
    const y = ty * T;
    // Weeds sway, part around a body right inside them, and go a little
    // see-through within 2 tiles so a fight in or behind them stays readable.
    let part = 0;
    let near = false;
    for (const h of s.heroes) {
      const dx = Math.abs(h.x - (x + T / 2));
      const dy = Math.abs(h.y - (y + T / 2));
      if (dx < T && dy < T) part = 1;
      if (dx < T * 2 && dy < T * 2) near = true;
    }
    ctx.globalAlpha = near ? 0.55 : 1;
    for (let i = 0; i < 7; i++) {
      const bx = x + 3 + hash2(tx, ty, i) * (T - 6);
      const by = y + T - 2 - hash2(tx, ty, i + 7) * 10;
      // Shorter than before (about two thirds), so what is in or behind them reads.
      const hgt = (18 + hash2(tx, ty, i + 3) * 14) * 0.65 - part * 4;
      const sway = Math.sin(this.t * 1.8 + tx * 0.7 + i) * 2.5;
      ctx.fillStyle = i % 2 ? p.bush : p.bush2;
      ctx.beginPath();
      ctx.moveTo(bx - 4, by);
      ctx.quadraticCurveTo(bx - 3 + sway * 0.5, by - hgt * 0.6, bx + sway, by - hgt);
      ctx.quadraticCurveTo(bx + 3 + sway * 0.5, by - hgt * 0.6, bx + 4, by);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private hero(ctx: CanvasRenderingContext2D, s: SimState, h: Hero, alpha = 1): void {
    if (!h.alive) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#3a2a20';
      ctx.beginPath();
      ctx.ellipse(h.x, h.y + 6, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    const lift = h.leap ? Math.sin((h.leap.t / h.leap.dur) * Math.PI) * 60 : 0;
    const frame = h.moving ? 1 + (Math.floor(h.walk) % 2) : 0;
    const faceLeft = Math.cos(h.facing) < -0.1;
    const y = h.y - lift;
    if (h.shield > 0) {
      ctx.strokeStyle = `rgba(255,220,140,${0.5 + 0.3 * Math.sin(this.t * 10)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(h.x, y - 4, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Ring under the hero, so you always know which one is you.
    ctx.strokeStyle = h.index === 0 ? 'rgba(110,190,255,0.8)' : 'rgba(255,180,80,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + 10, 14, 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    const gunBehind = Math.sin(h.facing) < -0.3;
    if (gunBehind) this.heroGun(ctx, h, y, alpha);
    const flash = h.hurtFlash > 0.1;
    blit(ctx, heroSprite(h.def, frame), h.x, y - 4, faceLeft, flash ? 0.5 * alpha : alpha);
    if (!gunBehind) this.heroGun(ctx, h, y, alpha);
    void s;
  }

  private heroGun(ctx: CanvasRenderingContext2D, h: Hero, y: number, alpha: number): void {
    const held = h.guns[h.active];
    if (!held) return;
    const g = held.gun;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(h.x + Math.cos(h.facing) * 6, y + 1 + Math.sin(h.facing) * 4);
    ctx.rotate(h.facing);
    if (Math.cos(h.facing) < 0) ctx.scale(1, -1);
    const kick = held.lock > g.lockout - 0.08 ? -3 : 0;
    blit(ctx, gunSprite(g.type, g.maker, g.rarity), 6 + kick, 0);
    ctx.restore();
  }

  private heroBars(ctx: CanvasRenderingContext2D, s: SimState, h: Hero): void {
    const lift = h.leap ? Math.sin((h.leap.t / h.leap.dur) * Math.PI) * 60 : 0;
    const x = h.x;
    const y = h.y - 40 - lift;
    const w = 40;
    // health
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 7);
    const f = Math.max(0, h.hp / h.stats.maxHp);
    ctx.fillStyle = f > 0.5 ? '#5fe35a' : f > 0.25 ? '#ffc040' : '#ff4a3a';
    ctx.fillRect(x - w / 2, y, w * f, 5);
    ctx.font = '800 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 2.5;
    const hpText = String(Math.ceil(h.hp));
    ctx.strokeText(hpText, x, y - 1);
    ctx.fillText(hpText, x, y - 1);
    // ammo segments, the way Brawl Stars shows them
    const held = h.guns[h.active];
    const max = maxAmmo(held, h);
    const segW = (w - (max - 1) * 2) / max;
    for (let i = 0; i < max; i++) {
      const sx = x - w / 2 + i * (segW + 2);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(sx - 0.5, y + 7.5, segW + 1, 4);
      const fill = i < Math.floor(held.ammo) ? 1 : i === Math.floor(held.ammo) ? held.refill : 0;
      ctx.fillStyle = h.afterburn > 0 ? '#ff9a2a' : '#ffb020';
      if (fill > 0) ctx.fillRect(sx, y + 8, segW * fill, 3);
    }
    if (h.superCharge >= 1) {
      ctx.strokeStyle = `rgba(255,220,80,${0.6 + 0.4 * Math.sin(this.t * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y - 4 - lift, 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    void s;
  }

  private drawAim(s: SimState, h: Hero): void {
    const ctx = this.ctx;
    const held = h.guns[h.active];
    const g = held.gun;
    const range = g.range * h.stats.rangeMul;
    const show = h.aimShow;
    if (show.on) {
      const an = Math.atan2(show.y, show.x);
      const ready = held.ammo >= 1 && held.lock <= 0;
      const col = ready ? 'rgba(255,255,255,' : 'rgba(255,120,100,';
      if (g.type === 'mortar') {
        const reach = Math.max(0.2, Math.min(1, Math.hypot(show.x, show.y)));
        const tx = h.x + Math.cos(an) * reach * range;
        const ty = h.y + Math.sin(an) * reach * range;
        ctx.strokeStyle = col + '0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.quadraticCurveTo((h.x + tx) / 2, (h.y + ty) / 2 - 70 * reach, tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col + '0.18)';
        ctx.beginPath();
        ctx.arc(tx, ty, g.blast * h.stats.blastMul, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        const spread = Math.max(0.05, g.spread + (g.count + h.stats.count > 1 ? 0.04 : 0));
        ctx.fillStyle = col + '0.16)';
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.arc(h.x, h.y, range, an - spread / 2, an + spread / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = col + '0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    if (show.superOn) {
      const an = Math.atan2(show.sy, show.sx);
      const reach = Math.max(0.2, Math.min(1, Math.hypot(show.sx, show.sy)));
      ctx.strokeStyle = 'rgba(255,210,60,0.85)';
      ctx.fillStyle = 'rgba(255,210,60,0.2)';
      ctx.lineWidth = 2.5;
      switch (h.def.super) {
        case 'dash': {
          const len = 820 * 0.24;
          ctx.save();
          ctx.translate(h.x, h.y);
          ctx.rotate(an);
          ctx.fillRect(0, -14, len, 28);
          ctx.strokeRect(0, -14, len, 28);
          ctx.restore();
          break;
        }
        case 'leap': {
          const dist = 80 + 230 * reach;
          const tx = h.x + Math.cos(an) * dist;
          const ty = h.y + Math.sin(an) * dist;
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          ctx.quadraticCurveTo((h.x + tx) / 2, (h.y + ty) / 2 - 90, tx, ty);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(tx, ty, 120, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'turret':
          ctx.beginPath();
          ctx.arc(h.x + Math.cos(an) * 30, h.y + Math.sin(an) * 30, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        case 'slam':
          ctx.beginPath();
          ctx.arc(h.x, h.y, 130, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
      }
    }
    void s;
  }

  private enemy(ctx: CanvasRenderingContext2D, s: SimState, e: Enemy, local: Hero | null): void {
    // In the weeds and not close: unseen.
    if (local && s.arena.tiles[Math.floor(e.y / T) * s.arena.w + Math.floor(e.x / T)] === BUSH && Math.hypot(e.x - local.x, e.y - local.y) > 90 && e.flash <= 0) {
      return;
    }
    const spawn = Math.min(1, e.age / 0.35);
    const moving = e.mode !== 'windup';
    const frame = moving ? 1 + (Math.floor(e.age * 6 + e.id) % 2) : 0;
    const h = nearestHero(s, e);
    const faceLeft = h ? h.x < e.x : false;
    let sp;
    let bodyY = e.y - e.r * 0.4;
    if (e.boss) {
      const b = BOSSES[(s.floor / 5 - 1) % BOSSES.length] ?? BOSSES[0];
      sp = bossSprite(b.id, b.color, frame);
      bodyY = e.y - 14;
    } else {
      const d = ENEMIES[e.kind];
      const big = e.r / d.r;
      sp = enemySprite(e.kind, d.color, frame, Math.round(big * 10) / 10);
    }
    const shakeX = e.mode === 'windup' || e.mode === 'fuse' ? (Math.random() - 0.5) * 3 : 0;
    ctx.save();
    ctx.translate(e.x + shakeX, bodyY + (1 - spawn) * 10);
    if (spawn < 1) ctx.scale(spawn, spawn);
    if (e.elite.length) {
      ctx.strokeStyle = `rgba(255,200,40,${0.6 + 0.3 * Math.sin(this.t * 6)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, e.r * 1.1, e.r * 1.2, e.r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    blit(ctx, sp, 0, 0, faceLeft);
    if (e.flash > 0 || (e.mode === 'fuse' && Math.floor(this.t * 14) % 2 === 0)) {
      ctx.globalCompositeOperation = 'lighter';
      blit(ctx, sp, 0, 0, faceLeft, 0.7);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    if (e.held && !e.boss && e.behaviour !== 'mortar') {
      const an = h ? Math.atan2(h.y - e.y, h.x - e.x) : e.facing;
      ctx.save();
      ctx.translate(e.x, e.y - 2);
      ctx.rotate(an);
      if (Math.cos(an) < 0) ctx.scale(1, -1);
      blit(ctx, gunSprite(e.held.gun.type, e.held.gun.maker, 0), 8, 0);
      ctx.restore();
    }
    if (e.burn > 0) {
      ctx.fillStyle = `rgba(255,120,30,${0.5 + 0.3 * Math.sin(this.t * 20)})`;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y - e.r, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.slow > 0) {
      ctx.strokeStyle = 'rgba(180,240,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.3, e.r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.blind > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = '900 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('?', e.x, e.y - e.r * 2 - 4);
    }
    // health bar once hurt; elites always, with their name
    if (!e.boss && (e.hp < e.maxHp || e.elite.length)) {
      const w = Math.max(20, e.r * 2.2);
      const y = e.y - e.r * 2 - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = e.elite.length ? '#ffc030' : '#ff5a3a';
      ctx.fillRect(e.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 3);
    }
  }

  private projectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    if (p.team === 1 && !p.lob) return;
    const col = p.legend === 'cuckoo' ? '#ffd8a0' : p.element !== 'none' ? ELEMENT_COLOR[p.element] : p.team === 1 ? '#ff6040' : MAKER_INFO[p.maker].color;
    if (p.lob) {
      const f = p.lob.t / p.lob.dur;
      const hgt = Math.sin(f * Math.PI) * (40 + Math.hypot(p.lob.tx - p.lob.sx, p.lob.ty - p.lob.sy) * 0.25);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      if (p.legend === 'thrown') {
        ctx.save();
        ctx.translate(p.x, p.y - hgt);
        ctx.rotate(p.spin);
        blit(ctx, gunSprite(p.gunType, p.maker, p.rarity), 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = p.team === 1 ? '#3a2a2a' : '#2a2a2e';
        ctx.strokeStyle = p.team === 1 ? '#ff6040' : col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y - hgt, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      return;
    }
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dx = p.vx / sp;
    const dy = p.vy / sp;
    if (p.gunType === 'lance') {
      ctx.fillStyle = p.element === 'fire' ? 'rgba(255,140,60,0.22)' : 'rgba(230,240,255,0.22)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (p.gunType === 'saw') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = '#d8d8e0';
      ctx.strokeStyle = '#2a2a2e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const an = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? p.r : p.r * 0.75;
        ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      return;
    }
    if (p.legend === 'cuckoo') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#8a5a2a';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0c040';
      ctx.beginPath();
      ctx.moveTo(p.r, -2);
      ctx.lineTo(p.r + 6, 0);
      ctx.lineTo(p.r, 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.r * 0.5, -2, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      return;
    }
    // A tracer: a streak behind a bright head.
    const len = Math.min(26, sp * 0.035) + p.r;
    ctx.strokeStyle = hexA(col, 0.5);
    ctx.lineWidth = p.r * 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x - dx * len, p.y - dy * len);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(col, 0.35);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Enemy shots: big, red-ringed and dark in the middle, so they read against anything. */
  private enemyBullet(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const pulse = 1 + 0.12 * Math.sin(this.t * 18 + p.id);
    ctx.fillStyle = 'rgba(255,60,30,0.3)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.7 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff4a2a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function nearestHero(s: SimState, e: Enemy): Hero | null {
  let best: Hero | null = null;
  let bd = Infinity;
  for (const h of s.heroes) {
    if (!h.alive) continue;
    const d = (h.x - e.x) ** 2 + (h.y - e.y) ** 2;
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function hexA(hex: string, a: number): string {
  if (hex.startsWith('rgba')) return hex;
  if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
