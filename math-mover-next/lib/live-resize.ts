interface FrameScheduler {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  now?: () => number;
}

/** Follow a moving boundary, coalescing events without waiting for it to stop. */
export function createLiveResize(resize: () => void, interval = 32, frames: FrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
  now: () => performance.now(),
}) {
  let frame: number | undefined;
  let nextUpdate: number | undefined;
  const update: FrameRequestCallback = time => {
    frame = undefined;
    if (nextUpdate !== undefined && time < nextUpdate) {
      frame = frames.request(update);
      return;
    }
    const start = frames.now?.() ?? time;
    resize();
    const end = frames.now?.() ?? time;
    // A costly synchronous applet redraw must not be followed immediately by
    // another. Leave input/paint time after it finishes; fast applets stay at
    // the normal cadence, slower ones coalesce more intermediate sizes.
    const duration = Math.max(0, end - start);
    const recovery = duration > interval * 1.5 ? Math.min(200, duration * 2) : 0;
    nextUpdate = Math.max(time + interval, end + recovery);
  };
  return {
    schedule() {
      // New size notifications never push an already scheduled update back.
      if (frame === undefined) frame = frames.request(update);
    },
    cancel() {
      if (frame !== undefined) frames.cancel(frame);
      frame = undefined;
      nextUpdate = undefined;
    },
  };
}
