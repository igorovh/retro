import { Peer, type DataConnection } from 'peerjs';
import type { Action, Msg, RoomState } from './types';
import { clean, createRoom, reduce, uid, viewFor } from './logic';

const PREFIX = 'sketchretro-v1-';
const ID_KEY = 'sketchretro:id';
const SAVE_PREFIX = 'sketchretro:host:';
const RECOVERABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc']);

const peerIdOf = (code: string) => PREFIX + code.toLowerCase();
const errType = (e: unknown) => (e as { type?: string })?.type ?? '';

/** Per-tab identity, so several tabs of one browser can join as different people. */
export function getMyId(): string {
  let id = sessionStorage.getItem(ID_KEY);
  if (!id) {
    id = uid(16);
    sessionStorage.setItem(ID_KEY, id);
  }
  return id;
}

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
  if (s) sessionStorage.setItem(ID_KEY, s.hostId);
}

export function pruneHostSaves(maxAgeMs = 14 * 86_400_000) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k?.startsWith(SAVE_PREFIX)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k) ?? '') as RoomState;
      if (Date.now() - s.now > maxAgeMs) localStorage.removeItem(k);
    } catch {
      localStorage.removeItem(k);
    }
  }
}

export const inviteLink = (code: string) => `${location.origin}${location.pathname}${location.search}#/${code}`;

export type Status = 'connecting' | 'online' | 'reconnecting' | 'failed';

export interface Snapshot {
  status: Status;
  error: string | null;
  state: RoomState | null;
  offset: number;
}

export interface Session {
  readonly isHost: boolean;
  readonly me: string;
  readonly code: string;
  subscribe(fn: () => void): () => void;
  getSnapshot(): Snapshot;
  send(a: Action): void;
  destroy(): void;
}

abstract class Base {
  private listeners = new Set<() => void>();
  protected snap: Snapshot = { status: 'connecting', error: null, state: null, offset: 0 };
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

/** The admin's browser is the source of truth; others get a filtered view per person. */
export class HostSession extends Base implements Session {
  readonly isHost = true;
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private full: RoomState;
  private idRetries = 0;

  constructor(
    readonly code: string,
    readonly me: string,
    name: string,
  ) {
    super();
    const saved = hostSave(code);
    const base = saved && saved.hostId === me ? saved : createRoom(code, me, name);
    const members = Object.fromEntries(Object.values(base.members).map((m) => [m.id, { ...m, online: false }]));
    members[me] = { id: me, joinedAt: members[me]?.joinedAt ?? Date.now(), name, online: true };
    this.full = { ...base, members };
    this.commit();
    this.open();
  }

  private open() {
    if (this.destroyed) return;
    const peer = new Peer(peerIdOf(this.code), { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.idRetries = 0;
      this.set({ status: 'online', error: null });
    });
    peer.on('connection', (c) => this.accept(c));
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      this.set({ status: 'reconnecting' });
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      const type = errType(err);
      if (type === 'unavailable-id') {
        // The broker keeps a dropped ID reserved for a moment after a refresh.
        peer.destroy();
        if (++this.idRetries > 12) {
          this.set({ status: 'failed', error: 'Ten pokój jest już otwarty w innej karcie albo przeglądarce.' });
          return;
        }
        this.set({ status: 'reconnecting', error: 'Odzyskuję pokój…' });
        setTimeout(() => this.open(), 2500);
      } else if (type === 'browser-incompatible') {
        this.set({ status: 'failed', error: 'Ta przeglądarka nie obsługuje WebRTC.' });
      } else if (RECOVERABLE.has(type)) {
        this.set({ status: 'reconnecting' });
        setTimeout(() => {
          if (this.destroyed || this.peer !== peer) return;
          if (peer.destroyed) this.open();
          else if (peer.disconnected) peer.reconnect();
        }, 3000);
      }
    });
  }

  private accept(conn: DataConnection) {
    let cid: string | null = null;
    conn.on('data', (raw) => {
      const msg = raw as Msg;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        if (typeof msg.id !== 'string' || !msg.id || msg.id.length > 64 || msg.id === this.me) return;
        cid = msg.id;
        const prev = this.conns.get(cid);
        if (prev && prev !== conn) prev.close();
        this.conns.set(cid, conn);
        const m = this.full.members[cid];
        this.full = {
          ...this.full,
          members: {
            ...this.full.members,
            [cid]: { id: cid, name: clean(msg.name, 40) || 'Anonim', online: true, joinedAt: m?.joinedAt ?? Date.now() },
          },
        };
        this.commit();
      } else if (msg.t === 'action' && cid) {
        this.apply(cid, msg.a);
      }
    });
    conn.on('close', () => {
      if (!cid || this.conns.get(cid) !== conn) return;
      this.conns.delete(cid);
      const m = this.full.members[cid];
      if (m) {
        this.full = { ...this.full, members: { ...this.full.members, [cid]: { ...m, online: false } } };
        this.commit();
      }
    });
    conn.on('error', () => {});
  }

  private apply(sender: string, a: Action) {
    const next = reduce(this.full, sender, a);
    if (next === this.full) return;
    this.full = next;
    this.commit();
  }

  private commit() {
    this.full = { ...this.full, seq: this.full.seq + 1, now: Date.now() };
    try {
      localStorage.setItem(SAVE_PREFIX + this.code, JSON.stringify(this.full));
    } catch {
      /* storage full or disabled: the room still works, it just won't survive a refresh */
    }
    for (const [cid, conn] of this.conns) {
      if (!conn.open) continue;
      try {
        conn.send({ t: 'state', s: viewFor(this.full, cid) } satisfies Msg);
      } catch {
        /* the close handler will clean up */
      }
    }
    this.set({ state: viewFor(this.full, this.me), offset: 0 });
  }

  send(a: Action) {
    this.apply(this.me, a);
  }

  destroy() {
    this.destroyed = true;
    this.peer?.destroy();
  }
}

export class ClientSession extends Base implements Session {
  readonly isHost = false;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private misses = 0;

  constructor(
    readonly code: string,
    readonly me: string,
    private name: string,
  ) {
    super();
    this.openPeer();
  }

  private openPeer() {
    if (this.destroyed) return;
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      const type = errType(err);
      if (type === 'peer-unavailable') {
        this.misses++;
        const lost = this.misses > 3;
        this.set({
          status: this.snap.state ? 'reconnecting' : lost ? 'failed' : 'connecting',
          error: lost ? 'Nie mogę znaleźć pokoju. Sprawdź kod albo poczekaj, aż host wróci.' : null,
        });
        this.retry(3000);
      } else if (type === 'browser-incompatible') {
        this.set({ status: 'failed', error: 'Ta przeglądarka nie obsługuje WebRTC.' });
      } else {
        this.set({ status: this.snap.state ? 'reconnecting' : 'connecting' });
        this.retry(3000);
      }
    });
  }

  private retry(ms: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.destroyed) return;
      const p = this.peer;
      if (!p || p.destroyed) this.openPeer();
      else if (p.disconnected) p.reconnect();
      else this.connect();
    }, ms);
  }

  private connect() {
    const peer = this.peer;
    if (this.destroyed || !peer || !peer.open) return;
    this.conn?.close();
    const conn = peer.connect(peerIdOf(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => {
      if (this.conn === conn && !conn.open) this.retry(0);
    }, 12_000);
    conn.on('open', () => {
      clearTimeout(this.openTimer);
      this.misses = 0;
      conn.send({ t: 'hello', id: this.me, name: this.name } satisfies Msg);
      this.set({ status: 'online', error: null });
    });
    conn.on('data', (raw) => {
      const msg = raw as Msg;
      if (msg?.t === 'state' && this.conn === conn) {
        this.set({ state: msg.s, offset: msg.s.now - Date.now(), status: 'online', error: null });
      }
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.destroyed) return;
      this.set({ status: 'reconnecting' });
      this.retry(2000);
    });
    conn.on('error', () => {});
  }

  send(a: Action) {
    if (this.conn?.open) this.conn.send({ t: 'action', a } satisfies Msg);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    this.conn?.close();
    this.peer?.destroy();
  }
}
