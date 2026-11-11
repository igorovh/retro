import type { Mine, RoomState } from './types';

const isSecret = (s: RoomState) => s.phase === 'lobby' || s.phase === 'writing';

/** What everyone may see: other people's hidden cards are blanked and only the summary shows who voted for what. */
export function sharedView(s: RoomState): RoomState {
  const shown = s.phase === 'review' ? new Set(s.reviewOrder.slice(0, s.reviewIndex + 1)) : null;
  const cards = s.cards.map((c) => (isSecret(s) || (shown !== null && !shown.has(c.id)) ? { ...c, text: '', hidden: true } : c));
  const votesUsed: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.votes)) votesUsed[k] = v.length;
  return { ...s, cards, votes: s.phase === 'summary' ? s.votes : {}, votesUsed, now: Date.now() };
}

/** The bits only `viewer` may see on top of the shared view. */
export function privatePart(s: RoomState, viewer: string): Mine {
  const hidden = new Set(sharedView(s).cards.filter((c) => c.hidden).map((c) => c.id));
  return { cards: s.cards.filter((c) => c.authorId === viewer && hidden.has(c.id)), votes: s.votes[viewer] ?? [] };
}

/** Idempotent, so it is safe to apply to a view that already contains the viewer's part. */
export function mergeView(base: RoomState, mine: Mine, viewer: string): RoomState {
  const byId = new Map(mine.cards.map((c) => [c.id, c]));
  return { ...base, cards: base.cards.map((c) => byId.get(c.id) ?? c), votes: { ...base.votes, [viewer]: mine.votes } };
}

export const viewFor = (s: RoomState, viewer: string) => mergeView(sharedView(s), privatePart(s, viewer), viewer);
