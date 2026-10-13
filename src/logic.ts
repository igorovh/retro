import { NOTE_COLORS, PHASES } from './types';
import type { Action, Card, Column, Group, NoteColor, Phase, RoomState, Settings } from './types';

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function uid(len = 10): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return s;
}

export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Accepts a bare code or a full invite link. */
export function normalizeCode(raw: string): string {
  const t = raw.trim();
  const m = t.match(/#\/?([A-Za-z0-9]{4,12})\s*$/);
  return (m ? m[1] : t).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

export function clean(t: unknown, max = 500): string {
  return typeof t === 'string' ? t.replace(/\r/g, '').trim().slice(0, max) : '';
}

export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export interface Preset {
  id: string;
  name: string;
  columns: [string, string, NoteColor][];
}

export const PRESETS: Preset[] = [
  {
    id: 'daki',
    name: 'Drop · Add · Keep · Improve',
    columns: [
      ['Drop', 'Co porzucamy?', 'pink'],
      ['Add', 'Co dodajemy?', 'green'],
      ['Keep', 'Co zostawiamy?', 'blue'],
      ['Improve', 'Co poprawiamy?', 'yellow'],
    ],
  },
  {
    id: 'wwa',
    name: 'Dobrze · Słabo · Akcje',
    columns: [
      ['Co poszło dobrze', 'Z czego jesteśmy dumni?', 'green'],
      ['Co poszło słabo', 'Co bolało?', 'pink'],
      ['Akcje', 'Konkretne kroki na kolejny sprint', 'yellow'],
    ],
  },
  {
    id: 'ssc',
    name: 'Start · Stop · Continue',
    columns: [
      ['Start', 'Co zacząć robić?', 'green'],
      ['Stop', 'Co przestać robić?', 'pink'],
      ['Continue', 'Co dalej robić?', 'blue'],
    ],
  },
  {
    id: 'msg',
    name: 'Mad · Sad · Glad',
    columns: [
      ['Mad', 'Co wkurzało?', 'orange'],
      ['Sad', 'Co rozczarowało?', 'blue'],
      ['Glad', 'Co cieszyło?', 'yellow'],
    ],
  },
  {
    id: '4l',
    name: '4L',
    columns: [
      ['Liked', 'Co się podobało?', 'green'],
      ['Learned', 'Czego się nauczyliśmy?', 'blue'],
      ['Lacked', 'Czego brakowało?', 'pink'],
      ['Longed for', 'Czego byśmy chcieli?', 'purple'],
    ],
  },
  {
    id: 'boat',
    name: 'Żaglówka',
    columns: [
      ['Wiatr', 'Co nas napędza?', 'green'],
      ['Kotwica', 'Co nas spowalnia?', 'orange'],
      ['Skały', 'Jakie widzimy ryzyka?', 'pink'],
      ['Wyspa', 'Dokąd płyniemy?', 'blue'],
    ],
  },
];

export const presetColumns = (p: Preset): Column[] =>
  p.columns.map(([title, hint, color]) => ({ id: uid(6), title, hint, color }));

export const DEFAULT_SETTINGS: Settings = { minutes: 5, votesPerPerson: 3 };

export function createRoom(code: string, hostId: string, hostName: string): RoomState {
  const now = Date.now();
  const ms = DEFAULT_SETTINGS.minutes * 60_000;
  return {
    v: 1,
    code,
    hostId,
    phase: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    columns: presetColumns(PRESETS[0]),
    members: { [hostId]: { id: hostId, name: hostName, online: true, joinedAt: now } },
    cards: [],
    timer: { started: false, running: false, endsAt: 0, remainingMs: ms, totalMs: ms },
    reviewOrder: [],
    reviewIndex: 0,
    groups: [],
    votes: {},
    votesUsed: {},
    now,
    seq: 0,
  };
}

const columnIds = (s: RoomState) => new Set(s.columns.map((c) => c.id));

/** Column by column, then person by person, so each author presents their cards together. */
export function reviewOrderOf(s: RoomState): string[] {
  const colIdx = new Map(s.columns.map((c, i) => [c.id, i]));
  const joined = (id: string) => s.members[id]?.joinedAt ?? Number.MAX_SAFE_INTEGER;
  return [...s.cards]
    .sort(
      (a, b) =>
        (colIdx.get(a.columnId) ?? 99) - (colIdx.get(b.columnId) ?? 99) ||
        joined(a.authorId) - joined(b.authorId) ||
        a.authorId.localeCompare(b.authorId) ||
        a.createdAt - b.createdAt,
    )
    .map((c) => c.id);
}

/** Every card ends up in exactly one group; unknown ids and empty groups are dropped. */
export function normalizeGroups(cards: Card[], groups: unknown, colIds: Set<string>): Group[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const used = new Set<string>();
  const out: Group[] = [];
  for (const raw of Array.isArray(groups) ? groups : []) {
    const g = raw as Partial<Group>;
    const ids = (Array.isArray(g.cardIds) ? g.cardIds : []).filter(
      (id): id is string => typeof id === 'string' && byId.has(id) && !used.has(id),
    );
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    const columnId = typeof g.columnId === 'string' && colIds.has(g.columnId) ? g.columnId : byId.get(ids[0])!.columnId;
    out.push({ id: clean(g.id, 20) || uid(), title: clean(g.title, 120), columnId, cardIds: ids });
  }
  for (const c of cards) {
    if (!used.has(c.id)) out.push({ id: uid(), title: '', columnId: c.columnId, cardIds: [c.id] });
  }
  return out;
}

function pauseIfRunning(s: RoomState, now: number) {
  if (!s.timer.running) return;
  s.timer.remainingMs = Math.max(0, s.timer.endsAt - now);
  s.timer.running = false;
}

function enterPhase(s: RoomState, phase: Phase, now: number) {
  if (phase !== 'writing') pauseIfRunning(s, now);
  if (phase === 'lobby') {
    const ms = s.settings.minutes * 60_000;
    s.timer = { started: false, running: false, endsAt: 0, remainingMs: ms, totalMs: ms };
  }
  if (phase === 'writing' && !s.timer.started) {
    const ms = s.settings.minutes * 60_000;
    s.timer = { started: true, running: true, endsAt: now + ms, remainingMs: ms, totalMs: ms };
  }
  if (phase === 'review') {
    const order = reviewOrderOf(s);
    if (order.join() !== s.reviewOrder.join()) s.reviewIndex = 0;
    s.reviewOrder = order;
    s.reviewIndex = clamp(s.reviewIndex, 0, Math.max(0, order.length - 1));
  }
  if (phase === 'grouping' || phase === 'voting' || phase === 'summary') {
    s.groups = normalizeGroups(s.cards, s.groups, columnIds(s));
    const ids = new Set(s.groups.map((g) => g.id));
    for (const k of Object.keys(s.votes)) s.votes[k] = s.votes[k].filter((g) => ids.has(g));
  }
  s.phase = phase;
}

/** Host-side state machine. Returns `prev` unchanged when the action is rejected. */
export function reduce(prev: RoomState, sender: string, a: Action): RoomState {
  if (!a || typeof a !== 'object' || !prev.members[sender]) return prev;
  const s: RoomState = structuredClone(prev);
  const now = Date.now();

  switch (a.type) {
    case 'addCard': {
      const text = clean(a.text);
      if (s.phase !== 'writing' || !text || !columnIds(s).has(a.columnId)) return prev;
      if (s.cards.filter((c) => c.authorId === sender).length >= 200) return prev;
      s.cards.push({ id: uid(), columnId: a.columnId, authorId: sender, text, hidden: false, createdAt: now });
      return s;
    }
    case 'editCard': {
      const c = s.cards.find((x) => x.id === a.id);
      const text = clean(a.text);
      if (s.phase !== 'writing' || !c || c.authorId !== sender || !text) return prev;
      c.text = text;
      return s;
    }
    case 'deleteCard': {
      const i = s.cards.findIndex((c) => c.id === a.id && c.authorId === sender);
      if (s.phase !== 'writing' || i < 0) return prev;
      s.cards.splice(i, 1);
      return s;
    }
    case 'vote': {
      if (s.phase !== 'voting' || !s.groups.some((g) => g.id === a.groupId)) return prev;
      const mine = (s.votes[sender] ??= []);
      if (mine.length >= s.settings.votesPerPerson) return prev;
      mine.push(a.groupId);
      return s;
    }
    case 'unvote': {
      const mine = s.votes[sender] ?? [];
      const i = mine.indexOf(a.groupId);
      if (s.phase !== 'voting' || i < 0) return prev;
      mine.splice(i, 1);
      return s;
    }
    case 'rename': {
      const name = clean(a.name, 40);
      if (!name) return prev;
      s.members[sender].name = name;
      return s;
    }
  }

  if (sender !== s.hostId) return prev;
  const t = s.timer;

  switch (a.type) {
    case 'setColumns': {
      if (s.phase !== 'lobby' || !Array.isArray(a.columns)) return prev;
      const cols: Column[] = a.columns.slice(0, 8).map((c) => ({
        id: clean(c?.id, 20) || uid(6),
        title: clean(c?.title, 40) || 'Bez nazwy',
        hint: clean(c?.hint, 80),
        color: NOTE_COLORS.includes(c?.color) ? c.color : 'yellow',
      }));
      if (!cols.length) return prev;
      s.columns = cols;
      const ids = columnIds(s);
      s.cards = s.cards.filter((c) => ids.has(c.columnId));
      return s;
    }
    case 'setSettings': {
      const x = a.settings ?? {};
      if (typeof x.minutes === 'number' && Number.isFinite(x.minutes)) s.settings.minutes = clamp(Math.round(x.minutes), 1, 120);
      if (typeof x.votesPerPerson === 'number' && Number.isFinite(x.votesPerPerson))
        s.settings.votesPerPerson = clamp(Math.round(x.votesPerPerson), 1, 20);
      if (!t.started) t.remainingMs = t.totalMs = s.settings.minutes * 60_000;
      return s;
    }
    case 'goPhase': {
      if (!PHASES.some((p) => p.id === a.phase) || a.phase === s.phase) return prev;
      enterPhase(s, a.phase, now);
      return s;
    }
    case 'addTime': {
      if (!t.started || typeof a.ms !== 'number' || !Number.isFinite(a.ms)) return prev;
      let rem: number;
      if (t.running) {
        const base = t.endsAt < now && a.ms > 0 ? now : t.endsAt;
        t.endsAt = Math.max(now, base + a.ms);
        rem = t.endsAt - now;
      } else {
        t.remainingMs = Math.max(0, t.remainingMs + a.ms);
        rem = t.remainingMs;
      }
      t.totalMs = Math.max(rem, t.totalMs + a.ms, 1000);
      return s;
    }
    case 'pauseTimer': {
      if (!t.running) return prev;
      pauseIfRunning(s, now);
      return s;
    }
    case 'resumeTimer': {
      if (t.running || !t.started) return prev;
      t.endsAt = now + t.remainingMs;
      t.running = true;
      return s;
    }
    case 'reviewGo': {
      if (s.phase !== 'review' || typeof a.index !== 'number') return prev;
      s.reviewIndex = clamp(Math.round(a.index), 0, Math.max(0, s.reviewOrder.length - 1));
      return s;
    }
    case 'setGroups': {
      if (s.phase !== 'grouping') return prev;
      s.groups = normalizeGroups(s.cards, a.groups, columnIds(s));
      return s;
    }
    case 'resetGroups': {
      s.groups = normalizeGroups(s.cards, [], columnIds(s));
      s.votes = {};
      return s;
    }
    case 'resetVotes': {
      s.votes = {};
      return s;
    }
  }
  return prev;
}

/** What a given participant is allowed to see. */
export function viewFor(s: RoomState, viewer: string): RoomState {
  const secret = s.phase === 'lobby' || s.phase === 'writing';
  const shown = s.phase === 'review' ? new Set(s.reviewOrder.slice(0, s.reviewIndex + 1)) : null;
  const cards = s.cards.map((c) => {
    if (c.authorId === viewer) return c;
    const hide = secret || (shown !== null && !shown.has(c.id));
    return hide ? { ...c, text: '', hidden: true } : c;
  });
  const votesUsed: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.votes)) votesUsed[k] = v.length;
  const votes = s.phase === 'summary' ? s.votes : { [viewer]: s.votes[viewer] ?? [] };
  return { ...s, cards, votes, votesUsed, now: Date.now() };
}

export function voteCounts(s: RoomState): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of Object.values(s.votes)) for (const g of list) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

export function groupTitle(g: Group, byId: Map<string, Card>): string {
  if (g.title) return g.title;
  const first = byId.get(g.cardIds[0]);
  if (!first) return 'Grupa';
  return g.cardIds.length === 1 ? first.text : `${first.text} (+${g.cardIds.length - 1})`;
}

function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return `${n} ${one}`;
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 10 || dd >= 20) ? few : many}`;
}
export const plVotes = (n: number) => plural(n, 'głos', 'głosy', 'głosów');
export const plCards = (n: number) => plural(n, 'kartka', 'kartki', 'kartek');

const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' / ');

export function buildAiPrompt(s: RoomState): string {
  const lines = [
    'Jesteś facylitatorem retrospektywy zespołu. Poniżej są kartki z retro, podzielone na kolumny.',
    'Zadanie: pogrupuj kartki, które dotyczą tego samego tematu albo powielają ten sam pomysł.',
    '',
    'Zasady:',
    '- Grupuj tylko kartki z TEJ SAMEJ kolumny.',
    '- Każda kartka musi trafić do dokładnie jednej grupy. Kartka bez pary = grupa jednoelementowa.',
    '- Nie łącz na siłę: grupa ma sens tylko, gdy kartki mówią o tym samym.',
    '- Każdej grupie nadaj krótki, konkretny tytuł (max ok. 6 słów) w języku kartek.',
    '- Używaj wyłącznie podanych ID kartek, nie wymyślaj nowych.',
    '',
    'Odpowiedz WYŁĄCZNIE poprawnym JSON-em (bez komentarzy i tekstu dookoła) w formacie:',
    '{"groups":[{"column":"col1","title":"Krótki tytuł","cards":["k1","k4"]}]}',
    '',
    'Kartki:',
  ];
  s.columns.forEach((col, ci) => {
    lines.push('', `### Kolumna "${col.title}"${col.hint ? ` (${col.hint})` : ''} [id: col${ci + 1}]`);
    s.cards.forEach((c, i) => {
      if (c.columnId === col.id) lines.push(`- [k${i + 1}] ${oneLine(c.text)}`);
    });
  });
  return lines.join('\n');
}

export function parseAiGroups(s: RoomState, raw: string): Group[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fence ? fence[1] : raw).trim();
  const i = body.search(/[[{]/);
  if (i < 0) throw new Error('Nie widzę JSON-a w tej odpowiedzi.');
  body = body.slice(i, body.lastIndexOf(body[i] === '{' ? '}' : ']') + 1);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('JSON jest niepoprawny. Wklej całą odpowiedź AI.');
  }
  const list = Array.isArray(data) ? data : (data as { groups?: unknown })?.groups;
  if (!Array.isArray(list)) throw new Error('Brakuje listy "groups" w odpowiedzi.');

  const byKey = new Map(s.cards.map((c, idx) => [`k${idx + 1}`, c]));
  const out: Group[] = [];
  let matched = 0;
  for (const g of list as { title?: unknown; cards?: unknown; cardIds?: unknown }[]) {
    const keys = Array.isArray(g?.cards) ? g.cards : Array.isArray(g?.cardIds) ? g.cardIds : [];
    const perColumn = new Map<string, string[]>();
    for (const k of keys) {
      const card = byKey.get(String(k).replace(/[[\]\s]/g, '').toLowerCase());
      if (!card) continue;
      matched++;
      perColumn.set(card.columnId, [...(perColumn.get(card.columnId) ?? []), card.id]);
    }
    for (const [columnId, cardIds] of perColumn) out.push({ id: uid(), title: clean(g.title, 120), columnId, cardIds });
  }
  if (!matched) throw new Error('Odpowiedź nie zawiera ID kartek z promptu (k1, k2…).');
  return normalizeGroups(s.cards, out, columnIds(s));
}

export function exportText(s: RoomState): string {
  const byId = new Map(s.cards.map((c) => [c.id, c]));
  const counts = voteCounts(s);
  const votesOf = (g: Group) => counts.get(g.id) ?? 0;
  const by = (c: Card) => {
    const n = s.members[c.authorId]?.name;
    return n ? ` (${n})` : '';
  };
  const groups = s.groups.length ? s.groups : normalizeGroups(s.cards, [], columnIds(s));
  const colTitle = (id: string) => s.columns.find((c) => c.id === id)?.title ?? '';
  const members = Object.values(s.members).sort((a, b) => a.joinedAt - b.joinedAt);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const date = new Date().toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' });

  const out = [
    `RETRO · ${date}`,
    `Pokój: ${s.code}`,
    `Uczestnicy (${members.length}): ${members.map((m) => m.name).join(', ')}`,
    `${plCards(s.cards.length)} · ${plVotes(total)}`,
    '',
  ];
  const ranked = groups.filter((g) => votesOf(g) > 0).sort((a, b) => votesOf(b) - votesOf(a)).slice(0, 5);
  if (ranked.length) {
    out.push('TOP TEMATY');
    ranked.forEach((g, i) => out.push(`${i + 1}. ${oneLine(groupTitle(g, byId))} · ${plVotes(votesOf(g))} [${colTitle(g.columnId)}]`));
    out.push('');
  }
  for (const col of s.columns) {
    out.push(`=== ${col.title.toUpperCase()} ===`);
    if (col.hint) out.push(`(${col.hint})`);
    const gs = groups.filter((g) => g.columnId === col.id).sort((a, b) => votesOf(b) - votesOf(a));
    if (!gs.length) out.push('  (brak kartek)');
    for (const g of gs) {
      const v = votesOf(g) ? ` [${plVotes(votesOf(g))}]` : '';
      const first = byId.get(g.cardIds[0]);
      if (g.cardIds.length === 1 && !g.title && first) {
        out.push(`• ${oneLine(first.text)}${by(first)}${v}`);
        continue;
      }
      out.push(`• ${g.title || 'Grupa'}${v}`);
      for (const id of g.cardIds) {
        const c = byId.get(id);
        if (c) out.push(`    - ${oneLine(c.text)}${by(c)}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trim() + '\n';
}

export function buildActionsPrompt(s: RoomState): string {
  return [
    'Poniżej jest podsumowanie retrospektywy zespołu (z liczbą głosów przy tematach).',
    'Na tej podstawie:',
    '1. W 3-5 zdaniach opisz najważniejsze wnioski.',
    '2. Zaproponuj 3-5 konkretnych, mierzalnych action items (co, kto mniej więcej, do kiedy), zaczynając od tematów z największą liczbą głosów.',
    '3. Wskaż, czego warto pilnować na następnym retro.',
    '',
    '---',
    exportText(s),
  ].join('\n');
}
