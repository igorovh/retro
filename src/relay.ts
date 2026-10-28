import type { MqttClient } from 'mqtt';
import type { Msg } from './types';
import { uid } from './logic';

/** Public brokers; the host listens on all of them, a guest uses the first one that answers. */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PING_MS = 8_000;
const LINK_TTL_MS = 30_000;
const BROKER_TIMEOUT_MS = 7_000;

type Ctl = 'ping' | 'pong' | 'bye' | 'rehello';
interface Envelope {
  /** Relay session id of the guest. */
  f: string;
  m?: Msg;
  k?: Ctl;
}

interface RoomCrypto {
  base: string;
  seal(e: Envelope): Promise<Uint8Array<ArrayBuffer>>;
  open(b: Uint8Array): Promise<Envelope | null>;
}

const cryptoCache = new Map<string, Promise<RoomCrypto>>();

/** Topic and AES key both come from PBKDF2 over the room code, so the broker sees neither. */
function roomCrypto(code: string): Promise<RoomCrypto> {
  const norm = code.toUpperCase();
  let p = cryptoCache.get(norm);
  if (!p) {
    p = deriveRoomCrypto(norm);
    cryptoCache.set(norm, p);
  }
  return p;
}

async function deriveRoomCrypto(code: string): Promise<RoomCrypto> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('sketchretro-relay-v1'), iterations: 150_000, hash: 'SHA-256' }, material, 384),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const base = 'sketchretro/v1/' + [...bits.slice(32)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    base,
    async seal(e) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(e))));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv);
      out.set(ct, 12);
      return out;
    },
    async open(b) {
      if (b.length < 29) return null;
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
        const e = JSON.parse(new TextDecoder().decode(pt)) as Envelope;
        return e && typeof e.f === 'string' && e.f.length <= 32 ? e : null;
      } catch {
        return null;
      }
    },
  };
}

async function connectBroker(url: string, opts: { will?: { topic: string; payload: Uint8Array<ArrayBuffer> } } = {}) {
  const { default: mqtt } = await import('mqtt');
  return mqtt.connect(url, {
    clientId: 'sr_' + uid(16),
    clean: true,
    connectTimeout: BROKER_TIMEOUT_MS,
    reconnectPeriod: 3_000,
    keepalive: 30,
    will: opts.will ? { topic: opts.will.topic, payload: opts.will.payload as unknown as Buffer, qos: 0, retain: false } : undefined,
  });
}

/** Host-side end of one guest talking over the relay. Mirrors the bits of DataConnection the host uses. */
export interface RelayLink {
  readonly open: boolean;
  send(m: Msg): void;
  close(): void;
  onData?: (m: Msg) => void;
  onClose?: () => void;
}

export class HostRelay {
  private clients: MqttClient[] = [];
  private links = new Map<string, { link: RelayLink; client: MqttClient; seen: number; closed: boolean }>();
  private sweep: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;

  constructor(
    private code: string,
    private onLink: (link: RelayLink) => void,
    private onUp: (up: boolean) => void,
  ) {
    void this.start();
  }

  private async start() {
    let rc: RoomCrypto;
    try {
      rc = await roomCrypto(this.code);
    } catch {
      return; // no WebCrypto (insecure context): P2P only
    }
    if (this.destroyed) return;
    const inbox = rc.base + '/h';
    for (const url of BROKERS) {
      const client = await connectBroker(url);
      if (this.destroyed) {
        client.end(true);
        return;
      }
      this.clients.push(client);
      client.on('connect', () => {
        client.subscribe(inbox, { qos: 0 });
        this.report();
      });
      client.on('close', () => this.report());
      client.on('error', () => {});
      client.on('message', async (_t, payload) => {
        const e = await rc.open(payload);
        if (e && !this.destroyed) this.handle(rc, client, e);
      });
    }
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [sid, l] of this.links) if (now - l.seen > LINK_TTL_MS) this.drop(sid);
    }, 5_000);
  }

  private report() {
    this.onUp(this.clients.some((c) => c.connected));
  }

  private reply(rc: RoomCrypto, client: MqttClient, sid: string, e: Envelope) {
    void rc.seal(e).then((b) => client.connected && client.publish(`${rc.base}/c/${sid}`, b as unknown as Buffer, { qos: 0 }));
  }

  private handle(rc: RoomCrypto, client: MqttClient, e: Envelope) {
    const sid = e.f;
    const known = this.links.get(sid);
    if (e.k === 'bye') {
      if (known) this.drop(sid);
      return;
    }
    if (known) {
      known.seen = Date.now();
      known.client = client;
    }
    if (e.k === 'ping') {
      this.reply(rc, client, sid, { f: '', k: known ? 'pong' : 'rehello' });
      return;
    }
    if (!e.m) return;
    if (!known) {
      if (e.m.t !== 'hello') {
        this.reply(rc, client, sid, { f: '', k: 'rehello' });
        return;
      }
      const entry = { link: null as unknown as RelayLink, client, seen: Date.now(), closed: false };
      entry.link = {
        get open() {
          return !entry.closed && entry.client.connected;
        },
        send: (m) => this.reply(rc, entry.client, sid, { f: '', m }),
        close: () => this.drop(sid),
      };
      this.links.set(sid, entry);
      this.onLink(entry.link);
    }
    this.links.get(sid)?.link.onData?.(e.m);
  }

  private drop(sid: string) {
    const l = this.links.get(sid);
    if (!l || l.closed) return;
    l.closed = true;
    this.links.delete(sid);
    l.link.onClose?.();
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.sweep);
    for (const sid of [...this.links.keys()]) this.drop(sid);
    this.clients.forEach((c) => c.end(true));
  }
}

export interface ClientRelayEvents {
  onOpen(): void;
  onMsg(m: Msg): void;
  onRehello(): void;
  /** No answer from the host for a while. */
  onSilent(): void;
  /** None of the brokers can be reached. */
  onDown(): void;
}

export class ClientRelay {
  private client: MqttClient | null = null;
  private rc: RoomCrypto | null = null;
  private readonly sid = uid(16);
  private brokerIdx = 0;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private brokerTimer: ReturnType<typeof setTimeout> | undefined;
  private lastHeard = 0;
  private destroyed = false;
  private bye: { topic: string; payload: Uint8Array<ArrayBuffer> } | null = null;
  // Encrypting is async, so the goodbye is sealed up front and sent synchronously when the tab goes away.
  private onPageHide = () => {
    if (this.bye && this.client?.connected) this.client.publish(this.bye.topic, this.bye.payload as unknown as Buffer, { qos: 0 });
  };

  constructor(
    private code: string,
    private ev: ClientRelayEvents,
  ) {
    addEventListener('pagehide', this.onPageHide);
    void this.start();
  }

  private async start() {
    try {
      this.rc = await roomCrypto(this.code);
    } catch {
      this.ev.onDown();
      return;
    }
    await this.tryBroker();
  }

  private async tryBroker() {
    const rc = this.rc;
    if (this.destroyed || !rc) return;
    this.client?.end(true);
    const url = BROKERS[this.brokerIdx % BROKERS.length];
    const will = { topic: rc.base + '/h', payload: await rc.seal({ f: this.sid, k: 'bye' }) };
    this.bye = will;
    const client = await connectBroker(url, { will });
    if (this.destroyed) {
      client.end(true);
      return;
    }
    this.client = client;
    let everConnected = false;
    clearTimeout(this.brokerTimer);
    this.brokerTimer = setTimeout(() => {
      if (everConnected || this.client !== client) return;
      this.brokerIdx++;
      if (this.brokerIdx % BROKERS.length === 0) this.ev.onDown();
      void this.tryBroker();
    }, BROKER_TIMEOUT_MS + 1_000);

    client.on('error', () => {});
    client.on('connect', () => {
      everConnected = true;
      clearTimeout(this.brokerTimer);
      client.subscribe(`${rc.base}/c/${this.sid}`, { qos: 0 }, () => {
        if (this.client !== client) return;
        this.lastHeard = Date.now();
        this.ev.onOpen();
      });
    });
    client.on('message', async (_t, payload) => {
      const e = await rc.open(payload);
      if (!e || this.client !== client || this.destroyed) return;
      this.lastHeard = Date.now();
      if (e.k === 'rehello') this.ev.onRehello();
      else if (e.m) this.ev.onMsg(e.m);
    });

    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      if (this.client !== client || !client.connected) return;
      this.post({ f: this.sid, k: 'ping' });
      if (Date.now() - this.lastHeard > PING_MS * 3) this.ev.onSilent();
    }, PING_MS);
  }

  private post(e: Envelope) {
    const client = this.client;
    const rc = this.rc;
    if (!client || !rc) return;
    void rc.seal(e).then((b) => client.connected && client.publish(rc.base + '/h', b as unknown as Buffer, { qos: 0 }));
  }

  send(m: Msg) {
    this.post({ f: this.sid, m });
  }

  get connected() {
    return !!this.client?.connected;
  }

  destroy() {
    if (this.destroyed) return;
    removeEventListener('pagehide', this.onPageHide);
    this.onPageHide();
    this.destroyed = true;
    clearInterval(this.pinger);
    clearTimeout(this.brokerTimer);
    const c = this.client;
    // Let the goodbye flush before closing the socket.
    setTimeout(() => c?.end(true), 300);
  }
}
