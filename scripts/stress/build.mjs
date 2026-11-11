// Bundles the stress test with the real src/net.ts and src/relay.ts, with PeerJS stubbed out.
// Usage: node build.mjs [root] [outfile]; root holds src/ and scripts/stress/ (defaults to this repo).
// STRESS_ENTRY=bots.ts builds the crowd script instead of the stress test.
import { build } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = resolve(process.argv[2] ?? here('../..'));

await build({
  input: resolve(root, 'scripts/stress', process.env.STRESS_ENTRY ?? 'run.ts'),
  platform: 'node',
  resolve: { alias: { peerjs: here('./peerjs-stub.ts') } },
  external: ['mqtt'],
  // Same variables as the Vite build, so the test can target our own broker.
  transform: {
    define: {
      'import.meta.env': JSON.stringify(
        Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_MQTT_'))),
      ),
    },
  },
  output: { file: resolve(process.argv[3] ?? here('./.out/run.mjs')), format: 'esm' },
  logLevel: 'warn',
});
