/**
 * Warning filter.
 *
 * node:sqlite emits an ExperimentalWarning on every start. It is expected —
 * the module is a release candidate and we use it on purpose — and printing it
 * at every boot and every CLI invocation trains the operator to skim past
 * warnings, which is exactly the habit you do not want on a server.
 *
 * Every other warning is still printed, unchanged.
 */
export function silenceSqliteWarning() {
  const defaults = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
    for (const listener of defaults) listener(warning);
  });
}
