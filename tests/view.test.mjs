import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeView, privatePart, sharedView, viewFor } from '../src/view.ts';

const card = (id, authorId, text) => ({ id, columnId: 'c1', authorId, text, hidden: false, createdAt: 0 });

const room = (phase, extra = {}) => ({
  v: 1,
  code: 'ABC',
  hostId: 'h',
  phase,
  settings: { minutes: 5, votesPerPerson: 3 },
  columns: [{ id: 'c1', title: 'Good', hint: '', color: 'green' }],
  members: {},
  cards: [card('k1', 'ala', 'secret of ala'), card('k2', 'bob', 'secret of bob')],
  timer: { started: true, running: false, endsAt: 0, remainingMs: 0, totalMs: 0 },
  reviewOrder: ['k1', 'k2'],
  reviewIndex: 0,
  groups: [{ id: 'g1', title: '', columnId: 'c1', cardIds: ['k1', 'k2'] }],
  votes: { ala: ['g1'], bob: ['g1', 'g1'] },
  votesUsed: {},
  now: 0,
  seq: 7,
  ...extra,
});

const texts = (s) => Object.fromEntries(s.cards.map((c) => [c.id, c.text]));

test('the view sent to every relay guest leaks no hidden card text and no ballots before the summary', () => {
  for (const phase of ['lobby', 'writing', 'review', 'grouping', 'voting']) {
    const shared = JSON.stringify(sharedView(room(phase)));
    if (phase !== 'grouping' && phase !== 'voting') assert.ok(!shared.includes('secret of bob'), phase);
    assert.deepEqual(sharedView(room(phase)).votes, {}, phase);
  }
  assert.deepEqual(texts(sharedView(room('review'))), { k1: 'secret of ala', k2: '' });
  assert.deepEqual(sharedView(room('summary')).votes, room('summary').votes);
});

test('each person sees their own cards and votes on top of the shared view', () => {
  assert.deepEqual(texts(viewFor(room('writing'), 'bob')), { k1: '', k2: 'secret of bob' });
  assert.equal(viewFor(room('writing'), 'bob').cards[1].hidden, false);
  assert.deepEqual(texts(viewFor(room('review'), 'bob')), { k1: 'secret of ala', k2: 'secret of bob' });
  assert.deepEqual(viewFor(room('voting'), 'bob').votes, { bob: ['g1', 'g1'] });
  assert.deepEqual(viewFor(room('voting'), 'carol').votes, { carol: [] });
  assert.deepEqual(viewFor(room('voting'), 'bob').votesUsed, { ala: 1, bob: 2 });
});

test('the own part only carries what the shared view hides', () => {
  assert.deepEqual(privatePart(room('writing'), 'bob').cards.map((c) => c.id), ['k2']);
  assert.deepEqual(privatePart(room('grouping'), 'bob').cards, []);
});

test('merging the own part twice changes nothing, so a full view can be merged again', () => {
  const s = room('writing');
  const once = viewFor(s, 'bob');
  assert.deepEqual(mergeView(once, privatePart(s, 'bob'), 'bob'), once);
});
