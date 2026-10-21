'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import styles from '@/app/landing.module.css';

type Point = [number, number];

export function GraphHandle({ position, label, value, min, max, step, valueText, onChange, toValue, children }: {
  position: Point; label: string; value: number; min: number; max: number; step: number; valueText: string;
  onChange: (value: number) => void; toValue: (point: Point) => number; children: ReactNode;
}) {
  const drag = useRef<{ id: number; offset: Point } | null>(null);
  const toPoint = (event: PointerEvent<SVGGElement>): Point | null => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  };
  const update = (next: number) => onChange(Number(Math.max(min, Math.min(max, Math.round(next / step) * step)).toFixed(2)));
  const endDrag = (event: PointerEvent<SVGGElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <g className={styles.graphHandle} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        const point = toPoint(event);
        if (!point) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = { id: event.pointerId, offset: [point[0] - position[0], point[1] - position[1]] };
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(value);
      }}
      onPointerMove={event => {
        if (drag.current?.id !== event.pointerId) return;
        const point = toPoint(event);
        if (point) update(toValue([point[0] - drag.current.offset[0], point[1] - drag.current.offset[1]]));
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        update(event.key === 'Home' ? min : event.key === 'End' ? max : value + direction * step * (event.shiftKey ? 10 : 1));
      }}>
      <circle cx={position[0]} cy={position[1]} r="8" fill="transparent" stroke="transparent" strokeWidth="36" vectorEffect="non-scaling-stroke" className={styles.graphHandleHit} />
      <circle cx={position[0]} cy={position[1]} r="15" fill="none" stroke="var(--lp-green)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={styles.graphHandleFocus} />
      {children}
    </g>
  );
}
