// Minimal pub/sub used across modules: bus.on('sync', fn) → unsubscribe().

const handlers = new Map();

export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => handlers.get(evt).delete(fn);
}

export function emit(evt, payload) {
  for (const fn of handlers.get(evt) || []) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[bus:${evt}]`, e);
    }
  }
}

export default { on, emit };
