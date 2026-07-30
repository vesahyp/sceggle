import { useEffect, useRef } from 'react';
import { touch, type StickVisual } from './touch';

/**
 * DOM overlay for the virtual sticks: a base ring and a knob per side,
 * visible only while that thumb is down (per the usability rules — nothing
 * on screen invites a mis-tap when no finger is placed). Updated in a rAF
 * loop with direct style writes; React renders the four divs once and never
 * again. pointer-events: none throughout — the canvas underneath owns the
 * touches, this layer only shows them.
 */
export function TouchSticks() {
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
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="touch-sticks">
      <div ref={leftBase} className="stick-base" />
      <div ref={leftKnob} className="stick-knob" />
      <div ref={rightBase} className="stick-base stick-aim" />
      <div ref={rightKnob} className="stick-knob stick-aim" />
    </div>
  );
}
