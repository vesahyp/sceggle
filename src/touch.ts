/**
 * Twin-stick touch input, following the tested twin-stick usability rules:
 * sticks are DYNAMIC (base spawns at the touch point — adapts to any grip),
 * render only while touched (the overlay reads `sticks`), keep tracking a
 * finger that drifts far outside the stick radius (output clamps, the stick
 * never "drops"), and never shift inward at screen edges.
 *
 * Left half of the screen owns movement, right half owns aim — deflecting
 * the aim stick past FIRE_DEFLECT holds the trigger, releasing ceases fire.
 * Pointer events (not touch events) give per-id tracking for free and skip
 * the classic stuck-second-touchstart quirk; mouse pointers are ignored so
 * desktop input is untouched.
 *
 * Screen → world mapping: the camera looks down with no yaw, so screen
 * right = world +X and screen down = world +Z, for both sticks.
 */

/** Stick visual state for the DOM overlay (CSS pixels). */
export interface StickVisual {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
}

const RADIUS = 70; // px from base to full deflection
const DEAD_ZONE = 0.18; // fraction of RADIUS
/** Trigger hysteresis: firing starts past ON and keeps going until the
 *  stick drops under OFF (or the thumb lifts). A single threshold made
 *  fire flicker off whenever the thumb eased toward center mid-hold. */
const FIRE_ON = 0.22;
const FIRE_OFF = 0.1;

export const touch = {
  /** Latched on the first touch — the input layer is in use. */
  used: false,
  /** Movement intent, unit-clamped, analog (magnitude scales speed). */
  move: { x: 0, z: 0, active: false },
  /** Aim direction + trigger. Direction persists after release so the
   *  player keeps facing their last aim, like the mouse cursor does. */
  aim: { x: 0, z: 1, active: false, fire: false },
  sticks: {
    left: { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 } as StickVisual,
    right: { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 } as StickVisual,
  },
};

interface Tracker {
  id: number | null;
  baseX: number;
  baseY: number;
}
const left: Tracker = { id: null, baseX: 0, baseY: 0 };
const right: Tracker = { id: null, baseX: 0, baseY: 0 };

function update(side: 'left' | 'right', px: number, py: number): void {
  const t = side === 'left' ? left : right;
  const dx = px - t.baseX;
  const dy = py - t.baseY;
  const dist = Math.hypot(dx, dy);
  const mag = Math.min(1, dist / RADIUS);
  const nx = dist > 0 ? dx / dist : 0;
  const ny = dist > 0 ? dy / dist : 0;

  const vis = touch.sticks[side];
  vis.active = true;
  vis.baseX = t.baseX;
  vis.baseY = t.baseY;
  // The knob pins to the rim when the finger roams beyond it.
  vis.knobX = t.baseX + nx * mag * RADIUS;
  vis.knobY = t.baseY + ny * mag * RADIUS;

  if (side === 'left') {
    const m = mag < DEAD_ZONE ? 0 : (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    touch.move.x = nx * m;
    touch.move.z = ny * m;
    touch.move.active = true;
  } else {
    touch.aim.active = true;
    if (mag >= DEAD_ZONE) {
      touch.aim.x = nx;
      touch.aim.z = ny;
    }
    touch.aim.fire = touch.aim.fire ? mag > FIRE_OFF : mag >= FIRE_ON;
  }
}

function release(side: 'left' | 'right'): void {
  const t = side === 'left' ? left : right;
  t.id = null;
  touch.sticks[side].active = false;
  if (side === 'left') {
    touch.move.x = 0;
    touch.move.z = 0;
    touch.move.active = false;
  } else {
    touch.aim.active = false;
    touch.aim.fire = false;
  }
}

/** Attach the listeners; returns the detach cleanup. */
export function initTouch(): () => void {
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    // UI elements (the pack sheet, buttons) handle their own touches.
    if (!(e.target instanceof HTMLCanvasElement)) return;
    e.preventDefault();
    touch.used = true;
    const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    const t = side === 'left' ? left : right;
    // If the side looks claimed, the old pointer is a leak (mobile browsers
    // sometimes drop pointerup on gesture interruptions). The real thumb is
    // the one touching now — steal the slot, or the stick is dead forever.
    if (t.id !== null) release(side);
    t.id = e.pointerId;
    t.baseX = e.clientX;
    t.baseY = e.clientY;
    update(side, e.clientX, e.clientY);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === left.id) update('left', e.clientX, e.clientY);
    else if (e.pointerId === right.id) update('right', e.clientX, e.clientY);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === left.id) release('left');
    else if (e.pointerId === right.id) release('right');
  };

  window.addEventListener('pointerdown', down, { passive: false });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => {
    window.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    release('left');
    release('right');
  };
}
