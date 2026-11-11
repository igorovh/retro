/** Network diagnostics: printed to the console and kept in memory so people can send them after a failed session. */
const MAX = 5_000;
const lines: string[] = [];
const t0 = Date.now();

const stamp = () => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export function log(scope: string, msg: string, data?: Record<string, unknown>, level: 'info' | 'warn' = 'info') {
  const line = `${stamp()} [${scope}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  lines.push(line);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  console[level]('[retro] ' + line);
}

export const warn = (scope: string, msg: string, data?: Record<string, unknown>) => log(scope, msg, data, 'warn');

export const short = (id: string) => id.slice(0, 6);

/** `retroLogs()` in the console copies the whole log to the clipboard. */
export function installLogTools() {
  const g = globalThis as Record<string, unknown>;
  if (g.retroLogs) return;
  g.retroLogs = () => {
    const text = [`retro log, ${navigator.userAgent}, page age ${Math.round((Date.now() - t0) / 1000)} s`, ...lines].join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => console.info(`[retro] copied ${lines.length} lines to the clipboard`),
      () => console.info(text),
    );
    return `${lines.length} lines`;
  };
  addEventListener('online', () => log('env', 'browser online'));
  addEventListener('offline', () => warn('env', 'browser offline'));
  document.addEventListener('visibilitychange', () => log('env', `tab ${document.visibilityState}`));
  log('env', 'page loaded', { url: location.href.replace(/#.*/, ''), visible: document.visibilityState });
}
