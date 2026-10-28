import { NOTE_COLORS, PHASES } from './types';
import type { Action, Card, Column, Group, NoteColor, Phase, RoomState, Settings } from './types';
import { dateLocale, t, tl, type Key } from './i18n';

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
  name: Key;
  columns: [title: Key, hint: Key, color: NoteColor][];
}

export const PRESETS: Preset[] = [
  {
    id: 'daki',
    name: 'preset.daki.name',
    columns: [
      ['preset.daki.1.title', 'preset.daki.1.hint', 'pink'],
      ['preset.daki.2.title', 'preset.daki.2.hint', 'green'],
      ['preset.daki.3.title', 'preset.daki.3.hint', 'blue'],
      ['preset.daki.4.title', 'preset.daki.4.hint', 'yellow'],
    ],
  },
  {
    id: 'wwa',
    name: 'preset.wwa.name',
    columns: [
      ['preset.wwa.1.title', 'preset.wwa.1.hint', 'green'],
      ['preset.wwa.2.title', 'preset.wwa.2.hint', 'pink'],
      ['preset.wwa.3.title', 'preset.wwa.3.hint', 'yellow'],
    ],
  },
  {
    id: 'ssc',
    name: 'preset.ssc.name',
    columns: [
      ['preset.ssc.1.title', 'preset.ssc.1.hint', 'green'],
      ['preset.ssc.2.title', 'preset.ssc.2.hint', 'pink'],
      ['preset.ssc.3.title', 'preset.ssc.3.hint', 'blue'],
    ],
  },
  {
    id: 'msg',
    name: 'preset.msg.name',
    columns: [
      ['preset.msg.1.title', 'preset.msg.1.hint', 'orange'],
      ['preset.msg.2.title', 'preset.msg.2.hint', 'blue'],
      ['preset.msg.3.title', 'preset.msg.3.hint', 'yellow'],
    ],
  },
  {
    id: '4l',
    name: 'preset.4l.name',
    columns: [
      ['preset.4l.1.title', 'preset.4l.1.hint', 'green'],
      ['preset.4l.2.title', 'preset.4l.2.hint', 'blue'],
      ['preset.4l.3.title', 'preset.4l.3.hint', 'pink'],
      ['preset.4l.4.title', 'preset.4l.4.hint', 'purple'],
    ],
  },
  {
    id: 'boat',
    name: 'preset.boat.name',
    columns: [
      ['preset.boat.1.title', 'preset.boat.1.hint', 'green'],
      ['preset.boat.2.title', 'preset.boat.2.hint', 'orange'],
      ['preset.boat.3.title', 'preset.boat.3.hint', 'pink'],
      ['preset.boat.4.title', 'preset.boat.4.hint', 'blue'],
    ],
  },
];

export const presetColumns = (p: Preset): Column[] =>
  p.columns.map(([title, hint, color]) => ({ id: uid(6), title: t(title), hint: t(hint), color }));

/** Columns are stored as plain text, so a preset is recognised by its titles in either language. */
export const presetMatches = (p: Preset, columns: Column[]) =>
  p.columns.length === columns.length &&
  p.columns.every(([title], i) => columns[i].title === tl('en', title) || columns[i].title === tl('pl', title));

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
  const timer = s.timer;

  switch (a.type) {
    case 'setColumns': {
      if (s.phase !== 'lobby' || !Array.isArray(a.columns)) return prev;
      const cols: Column[] = a.columns.slice(0, 8).map((c) => ({
        id: clean(c?.id, 20) || uid(6),
        title: clean(c?.title, 40) || t('lobby.unnamed'),
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
      if (!timer.started) timer.remainingMs = timer.totalMs = s.settings.minutes * 60_000;
      return s;
    }
    case 'goPhase': {
      if (!PHASES.some((p) => p.id === a.phase) || a.phase === s.phase) return prev;
      enterPhase(s, a.phase, now);
      return s;
    }
    case 'addTime': {
      if (!timer.started || typeof a.ms !== 'number' || !Number.isFinite(a.ms)) return prev;
      let rem: number;
      if (timer.running) {
        const base = timer.endsAt < now && a.ms > 0 ? now : timer.endsAt;
        timer.endsAt = Math.max(now, base + a.ms);
        rem = timer.endsAt - now;
      } else {
        timer.remainingMs = Math.max(0, timer.remainingMs + a.ms);
        rem = timer.remainingMs;
      }
      timer.totalMs = Math.max(rem, timer.totalMs + a.ms, 1000);
      return s;
    }
    case 'pauseTimer': {
      if (!timer.running) return prev;
      pauseIfRunning(s, now);
      return s;
    }
    case 'resumeTimer': {
      if (timer.running || !timer.started) return prev;
      timer.endsAt = now + timer.remainingMs;
      timer.running = true;
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
  if (!first) return t('group.default');
  return g.cardIds.length === 1 ? first.text : `${first.text} (+${g.cardIds.length - 1})`;
}

export const nVotes = (n: number) => t('plural.votes', { n });
export const nCards = (n: number) => t('plural.cards', { n });
export const nTopics = (n: number) => t('plural.topics', { n });

const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' / ');

export function buildAiPrompt(s: RoomState): string {
  const lines = [t('prompt.group.head')];
  s.columns.forEach((col, ci) => {
    lines.push('', t('prompt.group.col', { title: col.title, hint: col.hint ? ` (${col.hint})` : '', n: ci + 1 }));
    s.cards.forEach((c, i) => {
      if (c.columnId === col.id) lines.push(`- [k${i + 1}] ${oneLine(c.text)}`);
    });
  });
  return lines.join('\n');
}

export class AiGroupsError extends Error {
  constructor(readonly key: Key) {
    super(t(key));
  }
}

export function parseAiGroups(s: RoomState, raw: string): Group[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fence ? fence[1] : raw).trim();
  const i = body.search(/[[{]/);
  if (i < 0) throw new AiGroupsError('ai.noJson');
  body = body.slice(i, body.lastIndexOf(body[i] === '{' ? '}' : ']') + 1);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new AiGroupsError('ai.badJson');
  }
  const list = Array.isArray(data) ? data : (data as { groups?: unknown })?.groups;
  if (!Array.isArray(list)) throw new AiGroupsError('ai.noGroups');

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
  if (!matched) throw new AiGroupsError('ai.noIds');
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
  const date = new Date().toLocaleString(dateLocale(), { dateStyle: 'long', timeStyle: 'short' });

  const out = [
    t('export.title', { date }),
    t('export.room', { code: s.code }),
    t('export.people', { n: members.length, names: members.map((m) => m.name).join(', ') }),
    `${nCards(s.cards.length)} · ${nVotes(total)}`,
    '',
  ];
  const ranked = groups.filter((g) => votesOf(g) > 0).sort((a, b) => votesOf(b) - votesOf(a)).slice(0, 5);
  if (ranked.length) {
    out.push(t('export.top'));
    ranked.forEach((g, i) => out.push(`${i + 1}. ${oneLine(groupTitle(g, byId))} · ${nVotes(votesOf(g))} [${colTitle(g.columnId)}]`));
    out.push('');
  }
  for (const col of s.columns) {
    out.push(`=== ${col.title.toUpperCase()} ===`);
    if (col.hint) out.push(`(${col.hint})`);
    const gs = groups.filter((g) => g.columnId === col.id).sort((a, b) => votesOf(b) - votesOf(a));
    if (!gs.length) out.push(t('export.none'));
    for (const g of gs) {
      const v = votesOf(g) ? ` [${nVotes(votesOf(g))}]` : '';
      const first = byId.get(g.cardIds[0]);
      if (g.cardIds.length === 1 && !g.title && first) {
        out.push(`• ${oneLine(first.text)}${by(first)}${v}`);
        continue;
      }
      out.push(`• ${g.title || t('group.default')}${v}`);
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
  return [t('prompt.actions.head'), '', '---', exportText(s)].join('\n');
}
