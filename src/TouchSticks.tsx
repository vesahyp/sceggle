import { useEffect, useRef } from 'react';
import { touch, type StickVisual } from './touch';

/**
 * DOM overlay for the virtual sticks: a base ring and a knob per side,
 * visible only while that thumb is down (per the usability rules — nothing
 * on screen invites a mis-tap when no finger is placed). Updated in a rAF
 * loop with direct style writes; React renders the four divs once and never
 * again. pointer-events: none throughout — the canvas underneath owns the
 * touches, this layer only shows them.
 *
 * `cancelable` (a lob is equipped, where the trigger fires on RELEASE) puts
 * the aim stick into the cancel language: red while the thumb is down but
 * inside the dead zone, matching the red flight arc out in the world —
 * let go here and nothing is thrown.
 */
export function TouchSticks({ cancelable = false }: { cancelable?: boolean }) {
  const leftBase = useRef<HTMLDivElement>(null);
  const leftKnob = useRef<HTMLDivElement>(null);
  const rightBase = useRef<HTMLDivElement>(null);
  const rightKnob = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const apply = (s: StickVisual, base: HTMLDivElement | null, knob: HTMLDivElement | null) => {
      if (!base || !knob) return;
      base.style.display = s.active ? 'block' : 'none';
      knob.style.display = s.active ? 'block' : 'none';
      if (!s.active) return;
      base.style.transform = `translate(${s.baseX}px, ${s.baseY}px) translate(-50%, -50%)`;
      knob.style.transform = `translate(${s.knobX}px, ${s.knobY}px) translate(-50%, -50%)`;
    };
    const tick = () => {
      apply(touch.sticks.left, leftBase.current, leftKnob.current);
      apply(touch.sticks.right, rightBase.current, rightKnob.current);
      const dead = cancelable && touch.aim.active && !touch.aim.fire;
      rightBase.current?.classList.toggle('stick-dead', dead);
      rightKnob.current?.classList.toggle('stick-dead', dead);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cancelable]);

  return (
    <div className="touch-sticks">
      <div ref={leftBase} className="stick-base" />
      <div ref={leftKnob} className="stick-knob" />
      <div ref={rightBase} className="stick-base stick-aim" />
      <div ref={rightKnob} className="stick-knob stick-aim" />
    </div>
  );
}
