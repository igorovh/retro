import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { Action, Msg, RoomState, Via } from './types';
import { clean, createRoom, reduce, uid, viewFor } from './logic';
import { ClientRelay, HostRelay } from './relay';

const PREFIX = 'sketchretro-v1-';
const ID_KEY = 'sketchretro:id';
const SAVE_PREFIX = 'sketchretro:host:';
const RECOVERABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc']);
// PeerJS's default TURN hosts are gone; when STUN is not enough the encrypted relay takes over.
const PEER_OPTS: PeerOptions = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] },
};
const P2P_TIMEOUT_MS = 10_000;
const P2P_ATTEMPTS = 2;
const RELAY_GIVE_UP_MS = 15_000;

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

/** The admin's browser is the source of truth; others get a filtered view per person. */
export class HostSession extends Base implements Session {
  readonly isHost = true;
  private peer: Peer | null = null;
  private relay: HostRelay | null = null;
  private conns = new Map<string, Link>();
  private full: RoomState;
  private idRetries = 0;
  private peerUp = false;
  private relayUp = false;

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
    this.relay = new HostRelay(
      code,
      (link) => {
        const h = this.accept(link, 'relay');
        link.onData = h.data;
        link.onClose = h.close;
      },
      (up) => {
        this.relayUp = up;
        this.refresh();
      },
    );
  }

  private refresh(error: string | null = null) {
    if (this.destroyed || this.snap.status === 'failed') return;
    const up = this.peerUp || this.relayUp;
    if (up) this.set({ status: 'online', error: null });
    else if (this.snap.status !== 'connecting' || error) this.set({ status: 'reconnecting', error });
  }

  private open() {
    if (this.destroyed) return;
    const peer = new Peer(peerIdOf(this.code), PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => {
      this.idRetries = 0;
      this.peerUp = true;
      this.refresh();
    });
    peer.on('connection', (c) => {
      const h = this.accept({ get open() { return c.open; }, send: (m) => c.send(m), close: () => c.close() }, 'p2p');
      c.on('data', (raw) => h.data(raw as Msg));
      c.on('close', h.close);
      c.on('error', () => {});
    });
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      this.peerUp = false;
      this.refresh();
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      const type = errType(err);
      if (type === 'unavailable-id') {
        // The broker keeps a dropped ID reserved for a moment after a refresh.
        peer.destroy();
        this.peerUp = false;
        if (++this.idRetries > 12) {
          this.relay?.destroy();
          this.set({ status: 'failed', error: 'Ten pokój jest już otwarty w innej karcie albo przeglądarce.' });
          return;
        }
        this.refresh('Odzyskuję pokój…');
        setTimeout(() => this.open(), 2500);
      } else if (type === 'browser-incompatible') {
        this.peerUp = false;
        this.refresh('Ta przeglądarka nie obsługuje WebRTC.');
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
              [cid]: { id: cid, name: clean(msg.name, 40) || 'Anonim', online: true, joinedAt: m?.joinedAt ?? Date.now(), via },
            },
          };
          this.commit();
        } else if (msg.t === 'action' && cid && this.conns.get(cid) === conn) {
          this.apply(cid, msg.a);
        }
      },
      close: () => {
        if (!cid || this.conns.get(cid) !== conn) return;
        this.conns.delete(cid);
        const m = this.full.members[cid];
        if (m) {
          this.full = { ...this.full, members: { ...this.full.members, [cid]: { ...m, online: false } } };
          this.commit();
        }
      },
    };
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

  constructor(
    readonly code: string,
    readonly me: string,
    private name: string,
  ) {
    super();
    if (new URLSearchParams(location.search).has('relay')) this.useRelay();
    else this.openPeer();
  }

  private get hello(): Msg {
    return { t: 'hello', id: this.me, name: this.name };
  }

  private openPeer() {
    if (this.destroyed || this.relay) return;
    const peer = new Peer(PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.destroyed || this.relay) return;
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
    const conn = peer.connect(peerIdOf(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    let opened = false;
    clearTimeout(this.openTimer);
    // The host was found but ICE could not connect; retrying the same path rarely helps.
    this.openTimer = setTimeout(() => {
      if (this.conn === conn && !conn.open) this.useRelay();
    }, P2P_TIMEOUT_MS);
    conn.on('open', () => {
      opened = true;
      clearTimeout(this.openTimer);
      this.p2pFails = 0;
      conn.send(this.hello);
      this.set({ status: 'online', error: null, via: 'p2p' });
    });
    conn.on('data', (raw) => {
      const msg = raw as Msg;
      if (msg?.t === 'state' && this.conn === conn) this.gotState(msg.s, 'p2p');
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.destroyed || this.relay) return;
      clearTimeout(this.openTimer);
      if (!opened) {
        // PeerJS closes the connection itself when ICE fails.
        this.useRelay();
        return;
      }
      this.set({ status: 'reconnecting' });
      this.retry(2000);
    });
    conn.on('error', () => {});
  }

  private gotState(s: RoomState, via: Via) {
    clearTimeout(this.relayTimer);
    this.set({ state: s, offset: s.now - Date.now(), status: 'online', error: null, via });
  }

  private useRelay() {
    if (this.destroyed || this.relay) return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.set({
      status: this.snap.state ? 'reconnecting' : 'connecting',
      error: 'Nie udało się połączyć peer-to-peer. Łączę przez szyfrowany serwer pośredniczący…',
      via: 'relay',
    });
    const giveUp = () => {
      clearTimeout(this.relayTimer);
      this.relayTimer = setTimeout(() => {
        if (this.destroyed) return;
        this.set({
          status: 'failed',
          error: 'Nie mogę połączyć się z pokojem. Sprawdź kod i internet albo poczekaj, aż host wróci.',
        });
      }, RELAY_GIVE_UP_MS);
    };
    giveUp();
    const relay = new ClientRelay(this.code, {
      onOpen: () => {
        relay.send(this.hello);
        // Hellos can get lost on a public broker; repeat until the host answers.
        clearInterval(this.helloTimer);
        this.helloTimer = setInterval(() => {
          if (this.snap.status === 'online') clearInterval(this.helloTimer);
          else relay.send(this.hello);
        }, 3_000);
      },
      onMsg: (m) => {
        if (m.t === 'state') this.gotState(m.s, 'relay');
      },
      onRehello: () => relay.send(this.hello),
      onSilent: () => {
        if (this.snap.status !== 'online') return;
        this.set({ status: 'reconnecting', error: null });
        relay.send(this.hello);
        giveUp();
      },
      onDown: () => {
        if (this.snap.status === 'online') return;
        this.set({ status: 'failed', error: 'Nie mogę połączyć się ani peer-to-peer, ani przez serwer pośredniczący. Sprawdź internet.' });
      },
    });
    this.relay = relay;
  }

  send(a: Action) {
    const m: Msg = { t: 'action', a };
    if (this.relay) this.relay.send(m);
    else if (this.conn?.open) this.conn.send(m);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    clearTimeout(this.relayTimer);
    clearInterval(this.helloTimer);
    this.conn?.close();
    this.peer?.destroy();
    this.relay?.destroy();
  }
}
