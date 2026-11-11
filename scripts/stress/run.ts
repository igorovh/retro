import './shims';
import { appendFileSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import mqtt from 'mqtt';
import { ClientSession, HostSession } from '../../src/net';
import { newRoomCode, uid } from '../../src/logic';
import type { Group, Phase } from '../../src/types';

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const GUESTS = env('GUESTS', 20);
const CARDS = env('CARDS', 6);
const REVIEW_MS = env('REVIEW_MS', 1000);
const REVIEW_STEPS = env('REVIEW_STEPS', Infinity);
const MOVES = env('MOVES', 30);
const MOVE_MS = env('MOVE_MS', 1500);
const SETTLE_MS = env('SETTLE_MS', 25_000);
const JOIN_GAP_MS = env('JOIN_GAP_MS', 300);
const REFRESH_PCT = env('REFRESH_PCT', 10);
const TIME_LIMIT_MS = env('TIME_LIMIT_MS', 0);
const LABEL = process.env.LABEL ?? 'run';
const LOG = process.env.LOG_FILE ?? 'stress-log.txt';
const SUMMARY = process.env.SUMMARY_FILE;

writeFileSync(LOG, '');
const counts = new Map<string, number>();
for (const level of ['info', 'warn'] as const) {
  console[level] = (line: string) => {
    appendFileSync(LOG, line + '\n');
    if (level === 'warn') {
      const key = line.replace(/^\[retro\] \S+ /, '').replace(/ \{.*$/, '');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  };
}

// Bytes handed to the brokers, by direction; works for any version of src/relay.ts.
const bytes = { toGuests: 0, toHost: 0, messagesToGuests: 0 };
const origPublish = mqtt.MqttClient.prototype.publish;
mqtt.MqttClient.prototype.publish = function (this: unknown, topic: string, payload: { length: number }, ...rest: unknown[]) {
  if (topic.endsWith('/h')) bytes.toHost += payload.length;
  else {
    bytes.toGuests += payload.length;
    bytes.messagesToGuests++;
  }
  return (origPublish as (...a: unknown[]) => unknown).call(this, topic, payload, ...rest);
} as typeof origPublish;

// Every guest shares this one process; a busy loop here delays them all, which real browsers would not.
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

const out = (s: string) => process.stdout.write(s + '\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

// Random syllables compress about as well as real notes; a small word list would flatter gzip.
const SYL = 'ka to mi re su no pa le wi dro sta ble prze kon ty zu ga fe lo ny bi ce chy rz'.split(' ');
const word = () => Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => SYL[Math.floor(Math.random() * SYL.length)]).join('');
const sentence = () => Array.from({ length: 8 + Math.floor(Math.random() * 14) }, word).join(' ');

const code = newRoomCode();
const host = new HostSession(code, 'host' + uid(10), 'Host');
const hs = () => host.getSnapshot().state!;
const guests: { name: string; id: string; s: ClientSession }[] = [];
const result: Record<string, unknown> = { label: LABEL, guests: GUESTS, cards: GUESTS * CARDS };

async function until(ok: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return true;
    await sleep(250);
  }
  return false;
}

function lagging() {
  const { phase, seq } = hs();
  return guests
    .map(({ name, s }) => ({ name, snap: s.getSnapshot() }))
    .filter(({ snap }) => snap.state?.phase !== phase || (snap.state?.seq ?? 0) < seq)
    .map(({ name, snap }) => `${name}(${snap.status}, ${snap.state?.phase ?? '-'}#${snap.state?.seq ?? '-'})`);
}

const wrongPhase = () => guests.filter(({ s }) => s.getSnapshot().state?.phase !== hs().phase).length;

async function phase(p: Phase) {
  host.send({ type: 'goPhase', phase: p });
  out(`${ts()} host -> ${p} (seq ${hs().seq})`);
}

/** Waits until every guest has the host's latest state and records how long it took, or who is stuck. */
async function settle(label: string) {
  const start = Date.now();
  const ok = await until(() => lagging().length === 0, SETTLE_MS);
  const late = lagging();
  const stuckPhase = wrongPhase();
  result[label] = ok ? { ms: Date.now() - start } : { stuck: late.length, wrongPhase: stuckPhase };
  const shown = late.length > 8 ? [...late.slice(0, 8), `+${late.length - 8} more`] : late;
  out(`${ts()} ${label}: ${ok ? `in sync after ${Date.now() - start} ms` : `${late.length}/${GUESTS} NOT in sync (${stuckPhase} in the wrong phase): ${shown.join(', ')}`}`);
  return late;
}

async function main() {
  out(`[${LABEL}] room ${code}, ${GUESTS} guests over the relay, log in ${LOG}`);
  await until(() => host.getSnapshot().status === 'online', 20_000);
  out(`${ts()} host online`);

  const joinStart = Date.now();
  for (let i = 0; i < GUESTS; i++) {
    const name = `G${String(i + 1).padStart(3, '0')}`;
    const id = 'g' + uid(12);
    guests.push({ name, id, s: new ClientSession(code, id, name) });
    await sleep(JOIN_GAP_MS);
  }
  await until(() => guests.every((g) => g.s.getSnapshot().state), 60_000);
  const joined = guests.filter((g) => g.s.getSnapshot().state).length;
  result.joined = joined;
  result.joinMs = Date.now() - joinStart;
  out(`${ts()} joined: ${joined}/${GUESTS}`);
  await settle('lobby');

  await phase('writing');
  await settle('writing');
  const cols = hs().columns;
  await Promise.all(
    guests.map(async ({ s }) => {
      for (let i = 0; i < CARDS; i++) {
        await sleep(200 + Math.random() * 1500);
        s.send({ type: 'addCard', columnId: cols[Math.floor(Math.random() * cols.length)].id, text: sentence() });
      }
    }),
  );
  await until(() => hs().cards.length >= GUESTS * CARDS, 30_000);
  result.cardsAtHost = hs().cards.length;
  result.stateKb = Math.round(JSON.stringify(hs()).length / 1024);
  out(`${ts()} cards at host: ${hs().cards.length}/${GUESTS * CARDS}, state ${result.stateKb} kB`);
  await settle('writingDone');

  await phase('review');
  const steps = Math.min(hs().reviewOrder.length - 1, REVIEW_STEPS);
  for (let i = 1; i <= steps; i++) {
    host.send({ type: 'reviewGo', index: i });
    await sleep(REVIEW_MS);
  }
  await settle('reviewDone');

  await phase('grouping');
  await settle('grouping');
  for (let i = 0; i < MOVES; i++) {
    const gs: Group[] = structuredClone(hs().groups);
    const inCol = gs.filter((g) => g.columnId === cols[i % cols.length].id);
    if (inCol.length >= 2) {
      inCol[0].cardIds.push(...inCol[1].cardIds);
      host.send({ type: 'setGroups', groups: gs.filter((g) => g !== inCol[1]) });
    }
    await sleep(MOVE_MS);
  }
  await settle('groupingDone');

  await phase('voting');
  await settle('voting');
  let votesSent = 0;
  await Promise.all(
    guests.map(async ({ s }) => {
      for (let i = 0; i < 3; i++) {
        await sleep(300 + Math.random() * 3000);
        const st = s.getSnapshot().state;
        if (st?.phase !== 'voting') return;
        s.send({ type: 'vote', groupId: st.groups[Math.floor(Math.random() * st.groups.length)].id });
        votesSent++;
      }
    }),
  );
  await settle('votingDone');
  await sleep(2000);
  const votesAtHost = Object.values(hs().votesUsed).reduce((a, b) => a + b, 0);
  result.votes = { sent: votesSent, counted: votesAtHost, possible: GUESTS * 3 };
  out(`${ts()} votes: ${votesSent} sent by guests in the voting phase, ${votesAtHost} counted, ${GUESTS * 3} possible`);

  // A refresh keeps the tab's id, so the guest comes back as the same person.
  const n = Math.max(1, Math.round((GUESTS * REFRESH_PCT) / 100));
  out(`${ts()} refreshing ${n} guests`);
  for (const g of guests.slice(0, n)) {
    g.s.destroy();
    g.s = new ClientSession(code, g.id, g.name);
  }
  await settle('afterRefresh');
  await phase('summary');
  await settle('summary');

  await finish();
}

async function finish() {
  result.seconds = Math.round((Date.now() - t0) / 1000);
  result.kbToGuests = Math.round(bytes.toGuests / 1024);
  result.messagesToGuests = bytes.messagesToGuests;
  result.loopLagMs = { p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(loop.max / 1e6) };
  result.warnings = Object.fromEntries(counts);
  out(`${ts()} host sent ${result.kbToGuests} kB in ${bytes.messagesToGuests} messages; test process lag p99 ${result.loopLagMs.p99} ms, max ${result.loopLagMs.max} ms`);
  if (counts.size) {
    out('warnings by type:');
    for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) out(`  ${String(c).padStart(5)}  ${k}`);
  }
  if (SUMMARY) appendFileSync(SUMMARY, JSON.stringify(result) + '\n');
  host.destroy();
  guests.forEach((g) => g.s.destroy());
  await sleep(1000);
  process.exit(0);
}

if (TIME_LIMIT_MS)
  setTimeout(() => {
    out(`${ts()} time limit reached, stopping`);
    result.timedOut = true;
    void finish();
  }, TIME_LIMIT_MS);

void main();
