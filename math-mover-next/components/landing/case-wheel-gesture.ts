// Read raw wheel samples so a fading trackpad tail cannot become another page.
export function createCaseWheelGesture() {
  let lastAt = -Infinity;
  let lastMagnitude = 0;
  let lastTurnAt = -Infinity;
  let usedDirection = 0;
  let accumulated = 0;

  const reset = () => {
    lastAt = lastTurnAt = -Infinity;
    lastMagnitude = usedDirection = accumulated = 0;
  };

  return {
    reset,
    read(delta: number, now: number) {
      const magnitude = Math.abs(delta);
      const direction = Math.sign(delta);
      const freshBurst = now - lastAt >= 140
        || (now - lastTurnAt >= 180 && lastMagnitude <= 16 && magnitude >= Math.max(20, lastMagnitude * 2.2));
      if (freshBurst) { usedDirection = 0; accumulated = 0; }
      lastAt = now;
      lastMagnitude = magnitude;

      if (direction === usedDirection) {
        accumulated = 0;
        return { direction: 0, consumed: true };
      }
      accumulated = accumulated * delta < 0 ? delta : accumulated + delta;
      if (Math.abs(accumulated) < 32) return { direction: 0, consumed: usedDirection !== 0 };
      usedDirection = direction;
      lastTurnAt = now;
      accumulated = 0;
      return { direction, consumed: true };
    },
  };
}
