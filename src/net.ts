import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { PHASES, type Action, type Avatar, type Mine, type Msg, type RoomState, type Via } from './types';
import { cleanAvatar, randomAvatar } from './avatar';
import { clean, createRoom, newRoomCode, normalizeGroups, reduce, uid } from './logic';
import { mergeView, privatePart, sharedView, viewFor } from './view';
import { ClientRelay, HostRelay } from './relay';
import { t, type Key } from './i18n';
import { log, short, warn } from './log';

const PREFIX = 'sketchretro-v1-';
const MEMBER_PREFIX = 'sketchretro:member:';
const RELAY_KEY = 'sketchretro:relay';
const NAME_KEY = 'sketchretro:name';
const KICKED_PREFIX = 'sketchretro:kicked:';
const AVATAR_KEY = 'sketchretro:avatar';
const SAVE_PREFIX = 'sketchretro:host:';
const COPY_PREFIX = 'sketchretro:copy:';
const COPY_EVERY_MS = 2_000;
const RECOVERABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc']);
// PeerJS's default TURN hosts are gone; when STUN is not enough the encrypted relay takes over.
const PEER_OPTS: PeerOptions = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] },
};
const P2P_TIMEOUT_MS = 10_000;
const P2P_ATTEMPTS = 2;
const RELAY_GIVE_UP_MS = 15_000;
const FLUSH_MS = 250;
/** A guest is only "behind" on updates sent at least this long ago; newer ones may still be in flight. */
const RESYNC_GRACE_MS = 3_000;
const RESYNC_COOLDOWN_MS = 10_000;
/** Full views are big; the rest wait for the next flush instead of all leaving at once. */
const MAX_FULL_PER_FLUSH = 10;
const PING_MS = 5_000;
/** Silence after which a guest counts as gone; three missed pings. */
const GUEST_TIMEOUT_MS = 15_000;

const peerIdOf = (code: string) => PREFIX + code.toLowerCase();
const errType = (e: unknown) => (e as { type?: string })?.type ?? '';

/** `?as=x` gives a tab its own identity, so one browser can play several people while testing. */
const memberKey = (code: string) => {
  const as = new URLSearchParams(location.search).get('as');
  return MEMBER_PREFIX + code.toUpperCase() + (as ? ':' + as : '');
};

/** One identity per browser and room, so reopening the invite link does not add the same person again. */
export function getMyId(code: string): string {
  let id = localStorage.getItem(memberKey(code));
  if (!id) {
    id = uid(16);
    localStorage.setItem(memberKey(code), id);
  }
  return id;
}

// Per-tab first so a refresh keeps the tab's own name; localStorage only pre-fills new tabs.
export const storedName = () => sessionStorage.getItem(NAME_KEY) ?? localStorage.getItem(NAME_KEY) ?? '';
/** True after a refresh: this tab already entered a room under this name. */
export const tabHasName = () => !!sessionStorage.getItem(NAME_KEY);

/** Pre-fills the next invite without marking this tab as already in a room. */
export const rememberDefaultName = (n: string) => localStorage.setItem(NAME_KEY, n);

export function rememberName(n: string) {
  localStorage.setItem(NAME_KEY, n);
  sessionStorage.setItem(NAME_KEY, n);
}

/** The look picked on the start page or in a room; a random one is kept the first time. */
export function storedAvatar(): Avatar {
  try {
    const a = cleanAvatar(JSON.parse(localStorage.getItem(AVATAR_KEY) ?? 'null'));
    if (a) return a;
  } catch {
    /* fall through to a fresh one */
  }
  const a = randomAvatar();
  rememberAvatar(a);
  return a;
}

export const rememberAvatar = (a: Avatar) => localStorage.setItem(AVATAR_KEY, JSON.stringify(a));

export function hostSave(code: string): RoomState | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + code);
    return raw ? (JSON.parse(raw) as RoomState) : null;
  } catch {
    return null;
  }
}

export function initHost(code: string, me: string, name: string) {
  localStorage.setItem(SAVE_PREFIX + code, JSON.stringify(createRoom(code, me, name)));
}

export const isHostFor = (code: string, me: string) => hostSave(code)?.hostId === me;

/** Lets a host who closed the tab take the room back from the saved state. */
export function adoptHost(code: string) {
  const s = hostSave(code);
  if (s) localStorage.setItem(memberKey(code), s.hostId);
}

/** The last view a guest saw, kept so anyone can restart the room if the host is gone for good. */
export function guestCopy(code: string): RoomState | null {
  try {
    const raw = localStorage.getItem(COPY_PREFIX + code);
    return raw ? (JSON.parse(raw) as RoomState) : null;
  } catch {
    return null;
  }
}

/** Accepts a downloaded copy; returns null for anything that is not a room. */
export function parseCopy(text: string): RoomState | null {
  try {
    const s = JSON.parse(text) as RoomState;
    const ok = s && s.v === 1 && Array.isArray(s.columns) && Array.isArray(s.cards) && PHASES.some((p) => p.id === s.phase);
    return ok ? s : null;
  } catch {
    return null;
  }
}

/** Starts a new room from a copy, with this browser as host. Cards whose text the copy never saw are dropped. */
export function hostFromCopy(copy: RoomState, name: string): string {
  const code = newRoomCode();
  const me = getMyId(code);
  const now = Date.now();
  const cards = copy.cards.filter((c) => !c.hidden).map((c) => ({ ...c, hidden: false }));
  const ids = new Set(cards.map((c) => c.id));
  const members: RoomState['members'] = Object.fromEntries(Object.values(copy.members ?? {}).map((m) => [m.id, { ...m, online: false }]));
  members[me] = { id: me, name, online: true, joinedAt: now };
  const base = createRoom(code, me, name);
  const state: RoomState = {
    ...base,
    ...copy,
    code,
    hostId: me,
    members,
    cards,
    reviewOrder: (copy.reviewOrder ?? []).filter((id) => ids.has(id)),
    groups: normalizeGroups(cards, copy.groups, new Set(copy.columns.map((c) => c.id))),
    votes: copy.votes ?? {},
    votesUsed: {},
    seq: 0,
    now,
  };
  localStorage.setItem(SAVE_PREFIX + code, JSON.stringify(state));
  log('room', 'new room from a copy', { from: copy.code, code, phase: state.phase, cards: cards.length, dropped: copy.cards.length - cards.length });
  return code;
}

export function pruneHostSaves(maxAgeMs = 14 * 86_400_000) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k?.startsWith(SAVE_PREFIX) && !k?.startsWith(COPY_PREFIX)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k) ?? '') as RoomState;
      if (Date.now() - s.now > maxAgeMs) localStorage.removeItem(k);
    } catch {
      localStorage.removeItem(k);
    }
  }
}

/** Invitees choose their own language instead of inheriting the host's override. */
export function inviteLink(code: string) {
  const q = new URLSearchParams(location.search);
  q.delete('lang');
  const search = q.toString();
  return `${location.origin}${location.pathname}${search ? `?${search}` : ''}#/${code}`;
}

export type Status = 'connecting' | 'online' | 'reconnecting' | 'failed';

export interface Snapshot {
  status: Status;
  error: Key | null;
  state: RoomState | null;
  offset: number;
  /** How a guest reaches the host; null for the host itself. */
  via: Via | null;
}

export interface Session {
  readonly isHost: boolean;
  readonly me: string;
  readonly code: string;
  subscribe(fn: () => void): () => void;
  getSnapshot(): Snapshot;
  send(a: Action): void;
  rename(name: string): void;
  setAvatar(a: Avatar): void;
  /** Everything this browser knows about the room: the full state for the host, the own view for a guest. */
  exportCopy(): RoomState | null;
  /** Guests only: give up on the direct link and use the relay for the rest of this tab's life. */
  switchToRelay?(): void;
  destroy(): void;
}

abstract class Base {
  private listeners = new Set<() => void>();
  protected snap: Snapshot = { status: 'connecting', error: null, state: null, offset: 0, via: null };
  protected destroyed = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  protected set(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((f) => f());
  }
}

interface Link {
  readonly open: boolean;
  send(m: Msg): void;
  close(): void;
}

interface Guest {
  link: Link;
  via: Via;
  /** Send the full personal view on the next flush: just joined, or a ping showed it missed something. */
  resync: boolean;
  /** Last own part sent over the relay. */
  mine?: { json: string; seq: number; at: number };
  /** Last message from a P2P guest; the relay tracks its own guests. */
  seen: number;
  lastResync?: number;
}

/** The admin's browser is the source of truth; others get a filtered view per person. */
export class HostSession extends Base implements Session {
  readonly isHost = true;
  private peer: Peer | null = null;
  private relay: HostRelay | null = null;
  private conns = new Map<string, Guest>();
  private full: RoomState;
  private idRetries = 0;
  private peerUp = false;
  private relayUp = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Recent flushes, to tell a lost update from one that is still on its way. */
  private flushed: { seq: number; at: number }[] = [];
  /** Removed by the host; their next hello is turned away unless they chose to come back. */
  private kicked = new Set<string>();
  private sweep: ReturnType<typeof setInterval>;

  constructor(
    readonly code: string,
    readonly me: string,
    name: string,
  ) {
    super();
    // PeerJS can take minutes to notice a guest that vanished, so silent P2P links are closed here.
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [cid, g] of this.conns) {
        if (g.via !== 'p2p' || now - g.seen < GUEST_TIMEOUT_MS) continue;
        warn('host', 'p2p guest silent, marking offline', { id: short(cid), silentS: Math.round((now - g.seen) / 1000) });
        g.link.close();
        this.dropGuest(cid, g.link);
      }
    }, 5_000);
    const saved = hostSave(code);
    const base = saved && saved.hostId === me ? saved : createRoom(code, me, name);
    const members = Object.fromEntries(Object.values(base.members).map((m) => [m.id, { ...m, online: false }]));
    members[me] = { id: me, joinedAt: members[me]?.joinedAt ?? Date.now(), name, online: true, avatar: storedAvatar() };
    this.full = { ...base, members };
    log('host', 'start', { code, me: short(me), restored: base === saved, phase: base.phase, seq: base.seq });
    this.commit();
    this.open();
    this.relay = new HostRelay(
      code,
      (link) => {
        const h = this.accept(link, 'relay');
        link.onData = h.data;
        link.onClose = h.close;
        link.onSync = h.sync;
      },
      (up) => {
        this.relayUp = up;
        this.refresh();
      },
    );
  }

  private refresh(error: Key | null = null) {
    if (this.destroyed || this.snap.status === 'failed') return;
    const up = this.peerUp || this.relayUp;
    log('host', 'links', { p2p: this.peerUp, relay: this.relayUp, error });
    if (up) this.set({ status: 'online', error: null });
    else if (this.snap.status !== 'connecting' || error) this.set({ status: 'reconnecting', error });
  }

  private open() {
    if (this.destroyed) return;
    const peer = new Peer(peerIdOf(this.code), PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => {
      log('host', 'peerjs open');
      this.idRetries = 0;
      this.peerUp = true;
      this.refresh();
    });
    peer.on('connection', (c) => {
      log('host', 'p2p connection', { peer: c.peer });
      const h = this.accept({ get open() { return c.open; }, send: (m) => c.send(m), close: () => c.close() }, 'p2p');
      c.on('data', (raw) => h.data(raw as Msg));
      c.on('close', h.close);
      c.on('error', (e) => warn('host', 'p2p connection error', { peer: c.peer, type: errType(e), msg: String(e) }));
    });
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      warn('host', 'peerjs disconnected from the broker');
      this.peerUp = false;
      this.refresh();
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      const type = errType(err);
      warn('host', 'peerjs error', { type, msg: String(err) });
      if (type === 'unavailable-id') {
        // The broker keeps a dropped ID reserved for a moment after a refresh.
        peer.destroy();
        this.peerUp = false;
        if (++this.idRetries > 12) {
          this.relay?.destroy();
          this.set({ status: 'failed', error: 'err.roomOpenElsewhere' });
          return;
        }
        this.refresh('err.recovering');
        setTimeout(() => this.open(), 2500);
      } else if (type === 'browser-incompatible') {
        this.peerUp = false;
        this.refresh('err.noWebrtc');
      } else if (RECOVERABLE.has(type)) {
        this.peerUp = !peer.disconnected && !peer.destroyed && peer.open;
        this.refresh();
        setTimeout(() => {
          if (this.destroyed || this.peer !== peer) return;
          if (peer.destroyed) this.open();
          else if (peer.disconnected) peer.reconnect();
        }, 3000);
      }
    });
  }

  private accept(conn: Link, via: Via) {
    let cid: string | null = null;
    return {
      data: (msg: Msg) => {
        if (!msg || typeof msg !== 'object') return;
        const g = cid ? this.conns.get(cid) : undefined;
        if (g?.link === conn) g.seen = Date.now();
        // Answered so a P2P guest can tell a quiet room from a host that is gone.
        if (msg.t === 'ping' && g?.link === conn) conn.send({ t: 'ping' });
        if (msg.t === 'hello') {
          if (typeof msg.id !== 'string' || !msg.id || msg.id.length > 64 || msg.id === this.me) return;
          if (this.kicked.has(msg.id) && !msg.back) {
            log('host', 'removed guest tried to rejoin, telling them again', { id: short(msg.id) });
            this.sendKicked(conn);
            return;
          }
          this.kicked.delete(msg.id);
          cid = msg.id;
          const prev = this.conns.get(cid)?.link;
          const m = this.full.members[cid];
          log('host', 'hello', { id: short(cid), name: clean(msg.name, 40), via, known: !!m, replacesLink: !!prev && prev !== conn });
          if (prev && prev !== conn) prev.close();
          this.conns.set(cid, { link: conn, via, resync: true, seen: Date.now() });
          this.full = {
            ...this.full,
            members: {
              ...this.full.members,
              [cid]: {
                id: cid,
                name: clean(msg.name, 40) || t('anon'),
                online: true,
                joinedAt: m?.joinedAt ?? Date.now(),
                via,
                avatar: cleanAvatar(msg.avatar) ?? m?.avatar,
              },
            },
          };
          this.commit();
        } else if (msg.t === 'action' && cid && this.conns.get(cid)?.link === conn) {
          this.apply(cid, msg.a);
        } else if (msg.t === 'action') {
          warn('host', 'action from a link without hello', { id: cid && short(cid), via, type: msg.a?.type });
        }
      },
      sync: (shared: number, mine: number) => {
        const g = cid ? this.conns.get(cid) : undefined;
        if (!cid || !g || g.link !== conn || g.resync) return;
        // Under heavy load every guest lags a little; resending to all of them at once only adds to it.
        if (g.lastResync && Date.now() - g.lastResync < RESYNC_COOLDOWN_MS) return;
        const settled = Date.now() - RESYNC_GRACE_MS;
        const sharedDue = [...this.flushed].reverse().find((f) => f.at <= settled)?.seq ?? -1;
        const mineDue = g.mine && g.mine.at <= settled ? g.mine.seq : -1;
        if (shared >= sharedDue && mine >= mineDue) return;
        warn('host', 'guest is behind, resending', { id: short(cid), has: shared, due: sharedDue, hasMine: mine, dueMine: mineDue });
        g.resync = true;
        this.schedule();
      },
      close: () => {
        if (cid) this.dropGuest(cid, conn);
      },
    };
  }

  private dropGuest(cid: string, conn: Link) {
    if (this.conns.get(cid)?.link !== conn) return;
    log('host', 'link closed', { id: short(cid), via: this.conns.get(cid)?.via });
    this.conns.delete(cid);
    const m = this.full.members[cid];
    if (m?.online) {
      this.full = { ...this.full, members: { ...this.full.members, [cid]: { ...m, online: false } } };
      this.commit();
    }
  }

  private sendKicked(conn: Link) {
    try {
      conn.send({ t: 'kicked' });
    } catch {
      /* they are gone anyway */
    }
    // Give the message a moment to leave before the link goes.
    setTimeout(() => conn.close(), 1000);
  }

  private apply(sender: string, a: Action) {
    const next = reduce(this.full, sender, a);
    log('host', next === this.full ? 'action rejected' : 'action', { from: short(sender), type: a?.type, phase: this.full.phase });
    if (next === this.full) return;
    this.full = next;
    if (a.type === 'kick') {
      this.kicked.add(a.id);
      const g = this.conns.get(a.id);
      this.conns.delete(a.id);
      if (g) this.sendKicked(g.link);
    }
    this.commit();
  }

  private commit() {
    this.full = { ...this.full, seq: this.full.seq + 1, now: Date.now() };
    try {
      // Saved on every change so `seq` never goes back after a refresh; guests ignore older states.
      localStorage.setItem(SAVE_PREFIX + this.code, JSON.stringify(this.full));
    } catch {
      /* storage full or disabled: the room still works, it just won't survive a refresh */
    }
    this.dirty = true;
    this.schedule();
    this.set({ state: viewFor(this.full, this.me), offset: 0 });
  }

  /** Sends right away, then at most once per FLUSH_MS; changes in between go out together. */
  private schedule() {
    if (this.flushTimer === undefined) this.flush();
  }

  private flush() {
    if (this.destroyed || (!this.dirty && ![...this.conns.values()].some((g) => g.resync))) {
      this.flushTimer = undefined;
      return;
    }
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    const s = { ...this.full, now: Date.now() };
    const shared = sharedView(s);
    const now = Date.now();
    const sent = { p2p: 0, full: [] as string[], mine: 0, skipped: [] as string[], failed: [] as string[] };
    let relayGuests = 0;
    for (const [cid, g] of this.conns) {
      if (!g.link.open) {
        sent.skipped.push(short(cid));
        continue;
      }
      try {
        // P2P is reliable and has no broker limits, so it keeps getting the full personal view.
        if (g.via === 'p2p') {
          if (this.dirty || g.resync) g.link.send({ t: 'state', s: viewFor(s, cid) });
          g.resync = false;
          sent.p2p++;
          continue;
        }
        relayGuests++;
        if (g.resync && sent.full.length >= MAX_FULL_PER_FLUSH) continue;
        const part = privatePart(s, cid);
        const json = JSON.stringify(part);
        if (g.resync) {
          g.link.send({ t: 'state', s: mergeView(shared, part, cid) });
          g.lastResync = now;
          sent.full.push(short(cid));
        } else if (json !== g.mine?.json) {
          g.link.send({ t: 'mine', seq: s.seq, mine: part });
          sent.mine++;
        } else continue;
        g.resync = false;
        g.mine = { json, seq: s.seq, at: now };
      } catch (e) {
        sent.failed.push(`${short(cid)}: ${String(e)}`);
        /* the close handler will clean up */
      }
    }
    const wasDirty = this.dirty;
    this.dirty = false;
    if (wasDirty) {
      this.flushed.push({ seq: s.seq, at: now });
      if (this.flushed.length > 50) this.flushed.shift();
    }
    const info = {
      seq: s.seq,
      phase: s.phase,
      p2p: sent.p2p,
      relay: relayGuests,
      ...(sent.full.length && { full: sent.full }),
      ...(sent.mine && { mine: sent.mine }),
      ...(sent.skipped.length && { skipped: sent.skipped }),
      ...(sent.failed.length && { failed: sent.failed }),
    };
    if (!wasDirty || !relayGuests || !this.relay) return log('host', 'flush', info);
    void this.relay.broadcast({ t: 'shared', s: shared }).then((bytes) => log('host', 'flush', { ...info, sharedKb: +(bytes / 1024).toFixed(1) }));
  }

  send(a: Action) {
    this.apply(this.me, a);
  }

  rename(name: string) {
    rememberName(name);
    this.send({ type: 'rename', name });
  }

  setAvatar(avatar: Avatar) {
    rememberAvatar(avatar);
    this.send({ type: 'avatar', avatar });
  }

  exportCopy() {
    return this.full;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.flushTimer);
    clearInterval(this.sweep);
    this.peer?.destroy();
    this.relay?.destroy();
  }
}

/** Tries a direct WebRTC link first and falls back to the encrypted relay when it cannot be made. */
export class ClientSession extends Base implements Session {
  readonly isHost = false;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private relay: ClientRelay | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private relayTimer: ReturnType<typeof setTimeout> | undefined;
  private helloTimer: ReturnType<typeof setInterval> | undefined;
  private p2pFails = 0;
  /** Newest view from the host: the shared one over the relay, or a full personal one. */
  private base: RoomState | null = null;
  private mine: { seq: number; mine: Mine } | null = null;
  /** Set on hello: a restarted host may answer with a lower `seq`, so its first full state is always taken. */
  private fresh = true;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  /** This tab was removed by the host earlier and is now coming back on purpose. */
  private back: boolean;
  private avatar = storedAvatar();

  constructor(
    readonly code: string,
    readonly me: string,
    private name: string,
  ) {
    super();
    this.back = sessionStorage.getItem(KICKED_PREFIX + code) === '1';
    sessionStorage.removeItem(KICKED_PREFIX + code);
    const forceRelay = new URLSearchParams(location.search).has('relay') || sessionStorage.getItem(RELAY_KEY) === '1';
    log('guest', 'start', { code, me: short(me), name, forceRelay });
    if (forceRelay) this.useRelay();
    else this.openPeer();
  }

  private get hello(): Msg {
    this.fresh = true;
    return { t: 'hello', id: this.me, name: this.name, avatar: this.avatar, ...(this.back && { back: true }) };
  }

  private openPeer() {
    if (this.destroyed || this.relay) return;
    const peer = new Peer(PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => {
      log('guest', 'peerjs open');
      this.connect();
    });
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      warn('guest', 'peerjs disconnected from the broker');
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed || this.relay) return;
      warn('guest', 'peerjs error', { type: errType(err), msg: String(err), fails: this.p2pFails + 1 });
      if (errType(err) === 'browser-incompatible') this.useRelay();
      else this.p2pFailed();
    });
  }

  private p2pFailed() {
    if (this.destroyed || this.relay) return;
    if (++this.p2pFails >= P2P_ATTEMPTS) {
      this.useRelay();
      return;
    }
    this.set({ status: this.snap.state ? 'reconnecting' : 'connecting' });
    this.retry(1500);
  }

  private retry(ms: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.destroyed || this.relay) return;
      const p = this.peer;
      if (!p || p.destroyed) this.openPeer();
      else if (p.disconnected) p.reconnect();
      else this.connect();
    }, ms);
  }

  private connect() {
    const peer = this.peer;
    if (this.destroyed || this.relay || !peer || !peer.open) return;
    this.conn?.close();
    log('guest', 'p2p connecting');
    const conn = peer.connect(peerIdOf(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    let opened = false;
    clearTimeout(this.openTimer);
    // The host was found but ICE could not connect; retrying the same path rarely helps.
    this.openTimer = setTimeout(() => {
      if (this.conn !== conn || conn.open) return;
      warn('guest', 'p2p open timed out');
      this.useRelay();
    }, P2P_TIMEOUT_MS);
    conn.on('open', () => {
      log('guest', 'p2p open');
      opened = true;
      clearTimeout(this.openTimer);
      this.p2pFails = 0;
      conn.send(this.hello);
      this.set({ status: 'online', error: null, via: 'p2p' });
      clearInterval(this.pingTimer);
      let heard = Date.now();
      this.pingTimer = setInterval(() => {
        if (this.conn !== conn || !conn.open) return;
        conn.send({ t: 'ping' } satisfies Msg);
        if (Date.now() - heard > GUEST_TIMEOUT_MS && this.snap.status === 'online') {
          warn('guest', 'host silent over p2p');
          this.set({ status: 'reconnecting', error: null });
        }
      }, PING_MS);
      conn.on('data', (raw) => {
        if (this.conn !== conn) return;
        heard = Date.now();
        const msg = raw as Msg;
        if (msg?.t === 'ping') {
          if (this.snap.status === 'reconnecting' && this.base) this.render('p2p');
        } else this.got(msg, 'p2p');
      });
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.destroyed || this.relay) return;
      warn('guest', 'p2p closed', { opened });
      clearTimeout(this.openTimer);
      if (!opened) {
        // PeerJS closes the connection itself when ICE fails.
        this.useRelay();
        return;
      }
      this.set({ status: 'reconnecting' });
      this.retry(2000);
    });
    conn.on('error', (e) => warn('guest', 'p2p error', { type: errType(e), msg: String(e) }));
  }

  private got(m: Msg, via: Via) {
    if (m?.t === 'kicked') {
      warn('guest', 'the host removed us from the room');
      sessionStorage.setItem(KICKED_PREFIX + this.code, '1');
      this.set({ status: 'failed', error: 'err.kicked', state: null });
      this.destroy();
      return;
    }
    if (m?.t === 'mine') {
      if (this.mine && m.seq <= this.mine.seq) return;
      this.mine = { seq: m.seq, mine: m.mine };
      log('guest', 'own part', { seq: m.seq, cards: m.mine.cards.length, votes: m.mine.votes.length });
      if (this.base) this.render(via);
      return;
    }
    if (m?.t !== 'state' && m?.t !== 'shared') return;
    const s = m.s;
    const full = m.t === 'state';
    // A full view carries the own part too; take it even if the shared view of that seq came first.
    if (full && (!this.mine || s.seq > this.mine.seq || this.fresh)) {
      this.mine = { seq: s.seq, mine: { cards: s.cards.filter((c) => c.authorId === this.me), votes: s.votes[this.me] ?? [] } };
    }
    const prev = this.base;
    const data = { kind: m.t, seq: s.seq, phase: s.phase, via, ...(prev && { prevSeq: prev.seq, prevPhase: prev.phase }) };
    if (prev && s.seq <= prev.seq && !(full && this.fresh)) {
      if (s.seq < prev.seq) warn('guest', 'ignored a state older than the current one', data);
      return;
    }
    if (full) this.fresh = false;
    if (prev && s.seq > prev.seq + 1) log('guest', `state (${s.seq - prev.seq - 1} updates folded in)`, data);
    else log('guest', 'state', data);
    this.base = s;
    this.render(via);
  }

  private render(via: Via) {
    const base = this.base!;
    clearTimeout(this.relayTimer);
    const state = this.mine ? mergeView(base, this.mine.mine, this.me) : base;
    this.set({ state, offset: base.now - Date.now(), status: 'online', error: null, via });
    this.saveCopy();
  }

  private saveCopy() {
    if (this.copyTimer) return;
    this.copyTimer = setTimeout(() => {
      this.copyTimer = undefined;
      const s = this.snap.state;
      try {
        if (s) localStorage.setItem(COPY_PREFIX + this.code, JSON.stringify(s));
      } catch {
        /* storage full: the room works, there is just no copy to restart from */
      }
    }, COPY_EVERY_MS);
  }

  private useRelay() {
    if (this.destroyed || this.relay) return;
    log('guest', 'switching to the relay');
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.set({
      status: this.snap.state ? 'reconnecting' : 'connecting',
      error: 'err.fallingBack',
      via: 'relay',
    });
    const giveUp = () => {
      clearTimeout(this.relayTimer);
      this.relayTimer = setTimeout(() => {
        if (this.destroyed) return;
        warn('guest', 'host did not answer over the relay, giving up', { hadState: !!this.snap.state });
        this.set({
          status: 'failed',
          error: 'err.cantReachRoom',
        });
      }, RELAY_GIVE_UP_MS);
    };
    giveUp();
    const relay = new ClientRelay(this.code, {
      onOpen: () => {
        log('guest', 'relay open, sending hello');
        relay.send(this.hello);
        // Hellos can get lost on a public broker; repeat until the host answers with our own view.
        clearInterval(this.helloTimer);
        this.helloTimer = setInterval(() => {
          if (!this.fresh) clearInterval(this.helloTimer);
          else {
            log('guest', 'no answer yet, repeating hello');
            relay.send(this.hello);
          }
        }, 3_000);
      },
      onMsg: (m) => this.got(m, 'relay'),
      seqs: () => [this.base?.seq ?? -1, this.mine?.seq ?? -1],
      onRehello: () => {
        log('guest', 'host asked for hello');
        relay.send(this.hello);
      },
      onSilent: () => {
        if (this.snap.status !== 'online') return;
        warn('guest', 'host silent over the relay');
        this.set({ status: 'reconnecting', error: null });
        relay.send(this.hello);
        giveUp();
      },
      onDown: () => {
        warn('guest', 'no relay broker reachable', { online: this.snap.status === 'online' });
        if (this.snap.status === 'online') return;
        this.set({ status: 'failed', error: 'err.allDown' });
      },
    });
    this.relay = relay;
  }

  rename(name: string) {
    rememberName(name);
    // Later hellos carry the name too, so they must not bring the old one back.
    this.name = name;
    this.send({ type: 'rename', name });
  }

  setAvatar(avatar: Avatar) {
    rememberAvatar(avatar);
    // Later hellos carry it too, so a reconnect keeps the new look.
    this.avatar = avatar;
    this.send({ type: 'avatar', avatar });
  }

  exportCopy() {
    return this.snap.state ?? guestCopy(this.code);
  }

  switchToRelay = () => {
    if (this.relay || this.destroyed) return;
    log('guest', 'switched to the relay by hand', { status: this.snap.status });
    sessionStorage.setItem(RELAY_KEY, '1');
    this.useRelay();
  };

  send(a: Action) {
    const m: Msg = { t: 'action', a };
    if (this.relay) this.relay.send(m);
    else if (this.conn?.open) this.conn.send(m);
    else return warn('guest', 'action dropped, no open link', { type: a.type });
    log('guest', 'action sent', { type: a.type, via: this.relay ? 'relay' : 'p2p' });
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    clearTimeout(this.relayTimer);
    clearInterval(this.helloTimer);
    clearInterval(this.pingTimer);
    this.conn?.close();
    this.peer?.destroy();
    this.relay?.destroy();
  }
}
