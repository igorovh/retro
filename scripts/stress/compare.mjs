// Runs the stress test against an older commit and the working tree, on public brokers and on our own.
// Usage: OLD_REF=<commit> CASES="old-public:20,new-own:200" node scripts/stress/compare.mjs
// Our own broker comes from VITE_MQTT_URL, VITE_MQTT_USER and VITE_MQTT_PASS.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = here('../..');
const out = here('./.out');
const { OLD_REF, VITE_MQTT_URL: url, VITE_MQTT_USER: user = '', VITE_MQTT_PASS: pass = '' } = process.env;
const cases = (process.env.CASES ?? 'old-public:20,new-public:20').split(',').map((c) => c.split(':'));
const summary = resolve(out, process.env.SUMMARY_NAME ?? 'compare.jsonl');
mkdirSync(out, { recursive: true });
writeFileSync(summary, '');

function oldRoot(own) {
  if (!OLD_REF) throw new Error('set OLD_REF to the commit to compare against');
  const dir = resolve(out, `old-${own ? 'own' : 'public'}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(resolve(dir, 'scripts/stress'), { recursive: true });
  const files = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', OLD_REF, 'src'], { encoding: 'utf8' }).trim().split('\n');
  for (const f of files) {
    mkdirSync(dirname(resolve(dir, f)), { recursive: true });
    writeFileSync(resolve(dir, f), execFileSync('git', ['-C', repo, 'show', `${OLD_REF}:${f}`]));
  }
  for (const f of ['run.ts', 'shims.ts']) cpSync(here(`./${f}`), resolve(dir, 'scripts/stress', f));
  if (own) {
    // Before VITE_MQTT_URL existed the brokers were hard-coded; point them at ours only.
    const relay = resolve(dir, 'src/relay.ts');
    const src = readFileSync(relay, 'utf8');
    const patched = src
      .replace(/const BROKERS = \[[^\]]*\];/, `const BROKERS = [${JSON.stringify(url)}];`)
      .replace("clientId: 'sr_' + uid(16),", `clientId: 'sr_' + uid(16), username: ${JSON.stringify(user)}, password: ${JSON.stringify(pass)},`);
    if (patched === src || !patched.includes(url)) throw new Error('could not point the old relay at our broker');
    writeFileSync(relay, patched);
  }
  return dir;
}

function bundle(version, brokers) {
  const file = resolve(out, `${version}-${brokers}.mjs`);
  const own = brokers === 'own';
  if (own && !url) throw new Error('set VITE_MQTT_URL for the "own" cases');
  const root = version === 'old' ? oldRoot(own) : repo;
  const env = { ...process.env, VITE_MQTT_URL: '', VITE_MQTT_ONLY: '' };
  if (version === 'new' && own) Object.assign(env, { VITE_MQTT_URL: url, VITE_MQTT_ONLY: '1' });
  execFileSync(process.execPath, [here('./build.mjs'), root, file], { env, stdio: 'inherit' });
  return file;
}

const built = new Map();
for (const [kind, guests] of cases) {
  const [version, brokers] = kind.split('-');
  if (!built.has(kind)) built.set(kind, bundle(version, brokers));
  const label = `${kind}-${guests}`;
  spawnSync(process.execPath, [built.get(kind)], {
    stdio: 'inherit',
    cwd: out,
    env: { ...process.env, GUESTS: guests, LABEL: label, LOG_FILE: resolve(out, `log-${label}.txt`), SUMMARY_FILE: summary },
  });
}
if (existsSync(summary)) process.stdout.write('\n' + readFileSync(summary, 'utf8'));
