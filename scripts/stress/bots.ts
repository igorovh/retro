import './shims';
import { ClientSession } from '../../src/net';
import { hash } from '../../src/ui';

// Fills a real room with guests that write cards and vote, for trying the UI with a crowd.
// Usage: ROOM=ABC123 BOTS=20 MINUTES=60 node scripts/stress/.out/bots.mjs
const ROOM = (process.env.ROOM ?? '').toUpperCase();
const BOTS = Number(process.env.BOTS ?? 20);
const MINUTES = Number(process.env.MINUTES ?? 60);
if (!ROOM) throw new Error('set ROOM to the room code');

const NAMES = [
  'Bart', 'Sebastian', 'Wiktor', 'Tomek', 'Alan', 'Piotr', 'Maciej W.', 'Michał K.', 'Filip', 'Kasia',
  'Ola', 'Zuzia', 'Kuba', 'Ania', 'Paweł', 'Magda', 'Krzysiek', 'Ewa', 'Janek', 'Natalia',
  'Marta', 'Igor', 'Dominika', 'Łukasz', 'Agata', 'Robert', 'Iza', 'Szymon', 'Monika', 'Adam',
];
const CARDS = [
  'Deploy w piątek znowu się wysypał',
  'Za długie daily, często 30+ minut',
  'Super onboarding nowej osoby',
  'Code review czeka po 2 dni',
  'Brakuje testów e2e dla płatności',
  'Fajnie, że mamy demo co sprint',
  'Za dużo spotkań w środy',
  'Dokumentacja API jest nieaktualna',
  'Pair programming bardzo pomógł',
  'Niejasne priorytety w backlogu',
  'Pipeline CI trwa 25 minut',
  'Świetna współpraca z designem',
  'Hotfixy bez review to ryzyko',
  'Chcemy więcej czasu na refaktor',
  'Estymacje za optymistyczne',
  'Dobra komunikacja na Slacku',
  'Za mało info od klienta',
  'Retro co tydzień to za często',
  'Nowe narzędzie do retro działa :)',
  'Flaky testy blokują merge',
];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out = (s: string) => process.stdout.write(`${new Date().toLocaleTimeString()} ${s}\n`);
console.info = () => {};
console.warn = () => {};

interface Bot {
  id: string;
  name: string;
  s: ClientSession;
  wrote: boolean;
  voted: boolean;
}
const bots: Bot[] = [];

async function write(b: Bot) {
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    await sleep(5_000 + Math.random() * 40_000);
    const st = b.s.getSnapshot().state;
    if (st?.phase !== 'writing') return;
    b.s.send({ type: 'addCard', columnId: pick(st.columns).id, text: pick(CARDS) });
  }
}

async function vote(b: Bot) {
  for (let i = 0; i < 3; i++) {
    await sleep(3_000 + Math.random() * 20_000);
    const st = b.s.getSnapshot().state;
    if (st?.phase !== 'voting' || !st.groups.length) return;
    b.s.send({ type: 'vote', groupId: pick(st.groups).id });
  }
}

async function main() {
  out(`joining ${BOTS} bots to room ${ROOM} for ${MINUTES} min (Ctrl+C to stop)`);
  for (let i = 0; i < BOTS; i++) {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
    // A stable id, so restarting the script brings back the same people instead of new ones.
    const id = `bot${hash(ROOM + name).toString(36)}`;
    // Each bot reads its look from the shared storage when it starts.
    localStorage.removeItem('sketchretro:avatar');
    bots.push({ id, name, s: new ClientSession(ROOM, id, name), wrote: false, voted: false });
    await sleep(400);
  }
  const end = Date.now() + MINUTES * 60_000;
  let lastReport = 0;
  while (Date.now() < end) {
    for (const b of bots) {
      const snap = b.s.getSnapshot();
      // A guest gives up after a while without the host; a bot keeps knocking until the room is back.
      if (snap.status === 'failed' && snap.error !== 'err.kicked') {
        b.s.destroy();
        b.s = new ClientSession(ROOM, b.id, b.name);
        continue;
      }
      const phase = snap.state?.phase;
      if (phase === 'writing' && !b.wrote) {
        b.wrote = true;
        void write(b);
      }
      if (phase === 'voting' && !b.voted) {
        b.voted = true;
        void vote(b);
      }
      if (phase === 'lobby') b.wrote = b.voted = false;
    }
    if (Date.now() - lastReport > 30_000) {
      lastReport = Date.now();
      const by = new Map<string, number>();
      for (const b of bots) {
        const snap = b.s.getSnapshot();
        const k = `${snap.status}/${snap.state?.phase ?? '-'}`;
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      out([...by].map(([k, n]) => `${n}× ${k}`).join(', '));
    }
    await sleep(2_000);
  }
  stop();
}

function stop() {
  out('leaving');
  bots.forEach((b) => b.s.destroy());
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

void main();
