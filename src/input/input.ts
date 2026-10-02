import { NO_INPUT, type HeroInput } from '../game/state';

/**
 * Two thumbs and a keyboard.
 *
 * Touch, the Brawl Stars way: a touch that starts on the left half of the
 * screen is the move stick, its base where the thumb lands. A touch on the
 * right half is the gun: lift without dragging and it fires at the nearest
 * enemy; drag and an aim line shows, lift and it fires along it. A touch
 * that starts on the super button is the same, for the super. Buttons
 * marked `data-ui` (swap, take, pause) are left to React.
 *
 * Keyboard and mouse: WASD or arrows walk, the mouse aims, the left button
 * fires while held, right button or space for the super, Q swaps, E takes.
 *
 * Fire and super are edges: `read` returns them once and clears them.
 */
export interface Stick {
  active: boolean;
  cx: number;
  cy: number;
  x: number;
  y: number;
  touchId: number | null;
  /** the touch moved far enough to count as aiming */
  dragged: boolean;
}

const newStick = (): Stick => ({ active: false, cx: 0, cy: 0, x: 0, y: 0, touchId: null, dragged: false });

export class InputController {
  readonly move = newStick();
  readonly aim = newStick();
  readonly sup = newStick();
  /** full stick at this offset, css px */
  readonly radius = 64;
  /** super button centre and radius, css px; set by the HUD layout */
  superBtn = { x: -999, y: -999, r: 0 };
  /** the hero's screen position in css px and css px per world unit, for mouse aim */
  heroScreen = { x: 0, y: 0, scale: 1 };
  /** the active gun's range in world units, so the mouse distance sets a lob's reach */
  range = 300;
  private keys = new Set<string>();
  private fireEdge = false;
  private superEdge = false;
  private fireAim = { x: 0, y: 0 };
  private superAim = { x: 0, y: 0 };
  private swapEdge = false;
  private takeEdge = false;
  private mouse = { x: 0, y: 0, down: false, seen: false };
  usedTouch = false;
  private el: HTMLElement | null = null;

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') {
      if (!this.keys.has(k)) {
        if (k === 'q') this.swapEdge = true;
        if (k === 'e' || k === 'f') this.takeEdge = true;
        if (k === ' ') this.fireSuperAtMouse();
      }
      this.keys.add(k);
    } else this.keys.delete(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  };

  private mouseAim(): { x: number; y: number } {
    const h = this.heroScreen;
    const dx = (this.mouse.x - h.x) / h.scale;
    const dy = (this.mouse.y - h.y) / h.scale;
    const d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, Math.max(0.25, d / this.range));
    return { x: (dx / d) * reach, y: (dy / d) * reach };
  }

  private fireSuperAtMouse() {
    if (!this.mouse.seen) {
      this.superEdge = true;
      this.superAim = { x: 0, y: 0 };
      return;
    }
    this.superEdge = true;
    this.superAim = this.mouseAim();
  }

  private onMouseMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.seen = true;
  };
  private onMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    this.onMouseMove(e);
    const b = this.superBtn;
    if (e.button === 2 || (e.button === 0 && Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r)) this.fireSuperAtMouse();
    else if (e.button === 0) this.mouse.down = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouse.down = false;
  };
  private onContext = (e: Event) => e.preventDefault();

  private onTouchStart = (e: TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    this.usedTouch = true;
    const w = this.el?.clientWidth || window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      const b = this.superBtn;
      let st: Stick;
      if (Math.hypot(t.clientX - b.x, t.clientY - b.y) < b.r + 14) st = this.sup;
      else if (t.clientX < w / 2) st = this.move;
      else st = this.aim;
      if (st.touchId !== null) continue;
      st.touchId = t.identifier;
      st.active = true;
      st.dragged = false;
      st.cx = st === this.sup ? b.x : t.clientX;
      st.cy = st === this.sup ? b.y : t.clientY;
      st.x = t.clientX;
      st.y = t.clientY;
    }
    e.preventDefault();
  };

  private onTouchMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      for (const st of [this.move, this.aim, this.sup]) {
        if (st.touchId !== t.identifier) continue;
        st.x = t.clientX;
        st.y = t.clientY;
        if (Math.hypot(st.x - st.cx, st.y - st.cy) > 16) st.dragged = true;
      }
    }
    e.preventDefault();
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      for (const st of [this.move, this.aim, this.sup]) {
        if (st.touchId !== t.identifier) continue;
        st.touchId = null;
        st.active = false;
        if (st === this.aim) {
          this.fireEdge = true;
          this.fireAim = st.dragged ? this.stickVec(st) : { x: 0, y: 0 };
        }
        if (st === this.sup) {
          this.superEdge = true;
          this.superAim = st.dragged ? this.stickVec(st) : { x: 0, y: 0 };
        }
        st.dragged = false;
      }
    }
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouse.down = false;
  };

  private stickVec(st: Stick): { x: number; y: number } {
    const dx = (st.x - st.cx) / this.radius;
    const dy = (st.y - st.cy) / this.radius;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) return { x: 0, y: 0 };
    const m = Math.min(1, d);
    return { x: (dx / d) * m, y: (dy / d) * m };
  }

  attach(el: HTMLElement): void {
    this.el = el;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd);
    el.addEventListener('touchcancel', this.onTouchEnd);
    el.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('blur', this.onBlur);
  }

  detach(el: HTMLElement): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    el.removeEventListener('touchstart', this.onTouchStart);
    el.removeEventListener('touchmove', this.onTouchMove);
    el.removeEventListener('touchend', this.onTouchEnd);
    el.removeEventListener('touchcancel', this.onTouchEnd);
    el.removeEventListener('mousemove', this.onMouseMove);
    el.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('blur', this.onBlur);
    this.el = null;
  }

  swap(): void {
    this.swapEdge = true;
  }
  take(): void {
    this.takeEdge = true;
  }

  /** One step of input. Edges are consumed. */
  read(): HeroInput {
    const inp: HeroInput = { ...NO_INPUT };
    if (this.move.active) {
      const v = this.stickVec(this.move);
      const d = Math.hypot(v.x, v.y);
      if (d > 0.12) {
        const m = Math.min(1, (d - 0.12) / 0.6);
        inp.mx = (v.x / d) * m;
        inp.my = (v.y / d) * m;
      }
    } else {
      const k = this.keys;
      let dx = 0;
      let dy = 0;
      if (k.has('a') || k.has('arrowleft')) dx -= 1;
      if (k.has('d') || k.has('arrowright')) dx += 1;
      if (k.has('w') || k.has('arrowup')) dy -= 1;
      if (k.has('s') || k.has('arrowdown')) dy += 1;
      const d = Math.hypot(dx, dy);
      if (d) {
        inp.mx = dx / d;
        inp.my = dy / d;
      }
    }
    if (this.aim.active && this.aim.dragged) {
      const v = this.stickVec(this.aim);
      inp.aiming = true;
      inp.aimX = v.x;
      inp.aimY = v.y;
    } else if (this.mouse.seen && !this.usedTouch) {
      const v = this.mouseAim();
      inp.aiming = true;
      inp.aimX = v.x;
      inp.aimY = v.y;
    }
    if (this.fireEdge) {
      inp.fire = true;
      inp.aimX = this.fireAim.x;
      inp.aimY = this.fireAim.y;
      this.fireEdge = false;
    } else if (this.mouse.down) inp.fire = true;
    if (this.sup.active && this.sup.dragged) {
      const v = this.stickVec(this.sup);
      inp.superAiming = true;
      inp.superAimX = v.x;
      inp.superAimY = v.y;
    }
    if (this.superEdge) {
      inp.superFire = true;
      inp.superAimX = this.superAim.x;
      inp.superAimY = this.superAim.y;
      this.superEdge = false;
    }
    inp.swap = this.swapEdge;
    inp.take = this.takeEdge;
    this.swapEdge = false;
    this.takeEdge = false;
    return inp;
  }

  pressed(key: string): boolean {
    return this.keys.has(key);
  }
}
