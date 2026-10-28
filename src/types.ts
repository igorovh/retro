import type { Key } from './i18n';

export type Phase = 'lobby' | 'writing' | 'review' | 'grouping' | 'voting' | 'summary';

export const PHASES: { id: Phase; label: Key }[] = [
  { id: 'lobby', label: 'phase.lobby' },
  { id: 'writing', label: 'phase.writing' },
  { id: 'review', label: 'phase.review' },
  { id: 'grouping', label: 'phase.grouping' },
  { id: 'voting', label: 'phase.voting' },
  { id: 'summary', label: 'phase.summary' },
];

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Column {
  id: string;
  title: string;
  hint: string;
  color: NoteColor;
}

export interface Card {
  id: string;
  columnId: string;
  authorId: string;
  text: string;
  /** True when the viewer is not allowed to see the text yet. */
  hidden: boolean;
  createdAt: number;
}

export type Via = 'p2p' | 'relay';

export interface Member {
  id: string;
  name: string;
  online: boolean;
  joinedAt: number;
  via?: Via;
}

export interface Group {
  id: string;
  title: string;
  columnId: string;
  cardIds: string[];
}

export interface TimerState {
  started: boolean;
  running: boolean;
  /** Host clock timestamp, valid while running. */
  endsAt: number;
  /** Valid while paused. */
  remainingMs: number;
  totalMs: number;
}

export interface Settings {
  minutes: number;
  votesPerPerson: number;
}

export interface RoomState {
  v: 1;
  code: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  columns: Column[];
  members: Record<string, Member>;
  cards: Card[];
  timer: TimerState;
  reviewOrder: string[];
  reviewIndex: number;
  groups: Group[];
  /** memberId -> groupIds (duplicates = stacked votes). Only the viewer's own entry before the summary. */
  votes: Record<string, string[]>;
  votesUsed: Record<string, number>;
  /** Host clock when the snapshot was produced. */
  now: number;
  seq: number;
}

export type Action =
  | { type: 'addCard'; columnId: string; text: string }
  | { type: 'editCard'; id: string; text: string }
  | { type: 'deleteCard'; id: string }
  | { type: 'vote'; groupId: string }
  | { type: 'unvote'; groupId: string }
  | { type: 'rename'; name: string }
  | { type: 'setColumns'; columns: Column[] }
  | { type: 'setSettings'; settings: Partial<Settings> }
  | { type: 'goPhase'; phase: Phase }
  | { type: 'addTime'; ms: number }
  | { type: 'pauseTimer' }
  | { type: 'resumeTimer' }
  | { type: 'reviewGo'; index: number }
  | { type: 'setGroups'; groups: Group[] }
  | { type: 'resetGroups' }
  | { type: 'resetVotes' };

export type Msg =
  | { t: 'hello'; id: string; name: string }
  | { t: 'action'; a: Action }
  | { t: 'state'; s: RoomState };

export interface Ctx {
  s: RoomState;
  me: string;
  isHost: boolean;
  send: (a: Action) => void;
  /** hostClock - localClock */
  offset: number;
}
