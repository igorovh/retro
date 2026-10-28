import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage, formatMessage } from '../src/i18n/core.ts';
import { en } from '../src/i18n/en.ts';
import { pl } from '../src/i18n/pl.ts';

const sources = (overrides = {}) => ({
  search: '',
  saved: () => null,
  languages: ['en-US'],
  timeZone: () => 'America/New_York',
  ...overrides,
});

test('selects Polish from browser preferences or the Warsaw time zone, otherwise English', () => {
  assert.equal(detectLanguage(sources({ languages: ['pl'] })), 'pl');
  assert.equal(detectLanguage(sources({ languages: ['en-GB', 'pl-PL'] })), 'pl');
  assert.equal(detectLanguage(sources({ timeZone: () => 'Europe/Warsaw' })), 'pl');
  assert.equal(detectLanguage(sources({ languages: ['de-DE'], timeZone: () => 'Europe/Berlin' })), 'en');
  assert.equal(detectLanguage(sources({ languages: [] })), 'en');
});

test('a saved choice overrides detection; an explicit test URL overrides the saved choice', () => {
  const polishEnvironment = sources({ languages: ['pl-PL'], timeZone: () => 'Europe/Warsaw' });
  assert.equal(detectLanguage({ ...polishEnvironment, saved: () => 'en' }), 'en');
  assert.equal(detectLanguage(sources({ saved: () => 'pl' })), 'pl');
  assert.equal(detectLanguage(sources({ search: '?lang=en', saved: () => 'pl' })), 'en');
  assert.equal(detectLanguage(sources({ search: '?lang=pl', saved: () => 'en' })), 'pl');
  assert.equal(detectLanguage({ ...polishEnvironment, search: '?lang=fr', saved: () => 'de' }), 'pl');
});

test('blocked storage or time-zone access does not break language selection', () => {
  const unavailable = () => { throw new Error('unavailable'); };
  assert.equal(detectLanguage(sources({ saved: unavailable, languages: ['pl-PL'] })), 'pl');
  assert.equal(detectLanguage(sources({ saved: unavailable, timeZone: () => 'Europe/Warsaw' })), 'pl');
  assert.equal(detectLanguage(sources({ saved: unavailable, timeZone: unavailable })), 'en');
});

test('both dictionaries provide the same keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(pl).sort(), Object.keys(en).sort());
  const placeholders = (message) => {
    const forms = typeof message === 'string' ? [message] : Object.values(message);
    return [...new Set(forms.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
  };
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(pl[key]), placeholders(en[key]), key);
    assert.equal(typeof pl[key], typeof en[key], key);
  }
});

test('renders singular, few and many counts with real English and Polish plural rules', () => {
  const counts = [0, 1, 2, 5, 12, 21, 22, 25, 101, 112];
  const expectedPl = ['0 głosów', '1 głos', '2 głosy', '5 głosów', '12 głosów', '21 głosów', '22 głosy', '25 głosów', '101 głosów', '112 głosów'];
  assert.deepEqual(counts.map((n) => formatMessage('pl', pl['plural.votes'], { n })), expectedPl);
  assert.deepEqual([0, 1, 2].map((n) => formatMessage('en', en['plural.cards'], { n })), ['0 cards', '1 card', '2 cards']);
  assert.equal(formatMessage('en', { other: '{n} merged' }, { n: 1 }), '1 merged');
});

test('interpolates user text literally without changing JSON examples', () => {
  assert.equal(formatMessage('en', en['group.moveTo'], { title: '$& {n} <script>' }), 'to: $& {n} <script>');
  assert.equal(formatMessage('pl', pl['review.cardOf'], { n: 4, total: 19 }), 'kartka 4 z 19');
  assert.ok(formatMessage('en', en['prompt.group.head']).includes('"cards":["k1","k4"]'));
});
