/** Batch display updates, never the underlying stream or final persisted text. */
export function createStreamTextBatch(append: (text: string) => void, interval = 40) {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const text = pending;
    pending = '';
    append(text);
  };
  return {
    push(text: string) {
      pending += text;
      if (pending && timer === undefined) timer = setTimeout(flush, interval);
    },
    flush,
  };
}
