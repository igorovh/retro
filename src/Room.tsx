import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PHASES, type Avatar as AvatarLook, type Ctx, type Member, type Phase, type RoomState } from './types';
import { defaultAvatar } from './avatar';
import {
  ClientSession,
  HostSession,
  adoptHost,
  getMyId,
  guestCopy,
  hostFromCopy,
  hostSave,
  inviteLink,
  isHostFor,
  storedName,
  type Session,
} from './net';
import { Avatar, AvatarPicker, LangSwitch, ThemeToggle, copyText, download, sortedMembers, useNow } from './ui';

/** How long a guest must be cut off before "take over the room" is offered. */
const TAKEOVER_AFTER_MS = 30_000;
import { t, type Key } from './i18n';
import { log } from './log';
import { Lobby } from './phases/Lobby';
import { Writing } from './phases/Writing';
import { Review } from './phases/Review';
import { Grouping } from './phases/Grouping';
import { Voting } from './phases/Voting';
import { Summary } from './phases/Summary';

interface Props {
  code: string;
  name: string;
  theme: string;
  onToggleTheme: () => void;
  onLeave: () => void;
}

export function Room(props: Props) {
  const { code, name } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [elsewhere, setElsewhere] = useState(false);

  useEffect(() => {
    if (elsewhere) return;
    const me = getMyId(code);
    // Two tabs of one person would keep taking the connection from each other; the newest one wins.
    const tabs = new BroadcastChannel(`sketchretro:${code}:${me}`);
    tabs.onmessage = (e) => {
      if (e.data !== 'claim') return;
      log('room', 'opened in another tab, stepping back');
      setElsewhere(true);
    };
    tabs.postMessage('claim');
    // The prop is the name at entry; a rename in the room since then lives in storage.
    const current = storedName() || name;
    const s = isHostFor(code, me) ? new HostSession(code, me, current) : new ClientSession(code, me, current);
    setSession(s);
    return () => {
      tabs.close();
      s.destroy();
      setSession(null);
    };
  }, [code, name, epoch, elsewhere]);

  if (elsewhere)
    return (
      <div className="connecting">
        <div className="pencil-spin" aria-hidden>
          ✎
        </div>
        <h2 className="title">{t('elsewhere.title')}</h2>
        <p className="muted">{t('elsewhere.text')}</p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => setElsewhere(false)}>
            {t('elsewhere.use')}
          </button>
          <button className="btn" onClick={props.onLeave}>
            {t('connecting.back')}
          </button>
        </div>
      </div>
    );
  if (!session) return null;
  return (
    <RoomView
      key={`${epoch}`}
      session={session}
      {...props}
      onAdopt={() => {
        adoptHost(code);
        setEpoch((e) => e + 1);
      }}
      onRetry={() => setEpoch((e) => e + 1)}
    />
  );
}

function RoomView({
  session,
  theme,
  onToggleTheme,
  onLeave,
  onAdopt,
  onRetry,
}: Props & { session: Session; onAdopt: () => void; onRetry: () => void }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const s = snap.state;
  const canRelay = !!session.switchToRelay && snap.via !== 'relay' && snap.status !== 'failed';
  const relayBtn = canRelay && (
    <button className="btn small ghost relay-switch" onClick={() => session.switchToRelay?.()} title={t('relay.switchTip')}>
      {t('relay.switch')}
    </button>
  );
  const ctx: Ctx | null = s ? { s, me: session.me, isHost: session.isHost, send: (a) => session.send(a), offset: snap.offset } : null;

  const now = useNow(1000);
  const [lostAt, setLostAt] = useState<number | null>(null);
  useEffect(() => setLostAt((at) => (snap.status === 'online' ? null : (at ?? Date.now()))), [snap.status]);
  const hasCopy = !!s || !!guestCopy(session.code);
  const saveCopy = () => {
    const copy = session.exportCopy();
    if (!copy) return;
    download(`retro-${session.code}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(copy, null, 2));
    log('room', 'copy downloaded', { phase: copy.phase, cards: copy.cards.length });
  };
  const saveBtn = hasCopy && (
    <button className="btn small ghost" onClick={saveCopy} title={t('copy.saveTip')}>
      💾 {t('copy.save')}
    </button>
  );
  // Offered only after a while and behind a confirm, so a short blip does not split the room in two.
  const takeOver = () => {
    const copy = session.exportCopy();
    if (!copy || !confirm(t('takeover.confirm'))) return;
    const code = hostFromCopy(copy, storedName() || t('anon'));
    void copyText(inviteLink(code), t('takeover.copied'));
    location.hash = `#/${code}`;
  };
  const takeoverBtn = !session.isHost && hasCopy && lostAt !== null && now - lostAt > TAKEOVER_AFTER_MS && (
    <button className="btn small" onClick={takeOver} title={t('takeover.tip')}>
      ♛ {t('takeover.btn')}
    </button>
  );

  const onKick = session.isHost
    ? (m: Member) => confirm(t('people.kickConfirm', { name: m.name })) && session.send({ type: 'kick', id: m.id })
    : undefined;

  const leave = () => {
    if (session.isHost && !confirm(t('room.leaveConfirm')))
      return;
    onLeave();
  };

  return (
    <div className="room">
      <aside className="sidebar">
        <div className="side-head">
          <button className="logo" onClick={leave} title={t('room.backTitle')}>
            retro<span>✎</span>
          </button>
          {s && s.members[session.me] && (
            <WhoAmI m={s.members[session.me]} host={s.hostId === session.me} onRename={(n) => session.rename(n)} onAvatar={(a) => session.setAvatar(a)} />
          )}
          {s && <People s={s} me={session.me} onKick={onKick} />}
        </div>
        {s && <PhaseNav s={s} isHost={session.isHost} onGo={(phase) => session.send({ type: 'goPhase', phase })} />}
        {s && <SidePeople s={s} me={session.me} onKick={onKick} />}
        <div className="side-tools">
          {s && snap.via === 'relay' && (
            <span className="relay-badge" tabIndex={0} data-tip={t('relay.tip')} aria-label={t('relay.tip')}>
              <span aria-hidden>🔒</span> {t('relay.badge')}
            </span>
          )}
          {s && snap.status === 'online' && relayBtn}
          <button className="chip side-invite" onClick={() => copyText(inviteLink(session.code), t('room.inviteCopied'))} title={t('room.copyInvite')}>
            <span className="side-invite-label">{t('room.invite')}</span>
            <span>
              #{session.code} <span aria-hidden>⧉</span>
            </span>
          </button>
          <div className="side-icons">
            {s && (
              <button className="btn icon" onClick={saveCopy} title={t('copy.saveTip')} aria-label={t('copy.save')}>
                💾
              </button>
            )}
            <a className="btn icon info-link" href="#/info" target="_blank" rel="noopener" title={t('room.infoTitle')} aria-label={t('room.infoAria')}>
              ℹ
            </a>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <LangSwitch />
          </div>
          <button className="btn small ghost side-leave" onClick={leave}>
            <span aria-hidden>←</span> {t('room.leave')}
          </button>
        </div>
      </aside>

      <div className="room-main">
        {snap.status !== 'online' && s && (
          <div className="banner">
            {snap.error ? t(snap.error) : session.isHost ? t('banner.broker') : t('banner.lostHost')} {relayBtn} {!session.isHost && saveBtn} {takeoverBtn}
          </div>
        )}

        {ctx ? (
          <main className="stage" key={ctx.s.phase}>
            <PhaseView ctx={ctx} />
          </main>
        ) : (
          <Connecting
            code={session.code}
            status={snap.status}
            error={snap.error}
            isHost={session.isHost}
            onLeave={onLeave}
            onAdopt={onAdopt}
            onRetry={onRetry}
            relayBtn={relayBtn}
            rescue={
              snap.status === 'failed' &&
              hasCopy && (
                <div className="row-btns">
                  {saveBtn}
                  {takeoverBtn}
                </div>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

function PhaseView({ ctx }: { ctx: Ctx }) {
  switch (ctx.s.phase) {
    case 'lobby':
      return <Lobby {...ctx} />;
    case 'writing':
      return <Writing {...ctx} />;
    case 'review':
      return <Review {...ctx} />;
    case 'grouping':
      return <Grouping {...ctx} />;
    case 'voting':
      return <Voting {...ctx} />;
    case 'summary':
      return <Summary {...ctx} />;
  }
}

function PhaseNav({ s, isHost, onGo }: { s: RoomState; isHost: boolean; onGo: (p: Phase) => void }) {
  const cur = PHASES.findIndex((p) => p.id === s.phase);
  return (
    <nav className="phase-nav" aria-label={t('room.stages')}>
      {PHASES.map((p, i) => (
        <button
          key={p.id}
          className={`step ${i === cur ? 'on' : ''} ${i < cur ? 'done' : ''}`}
          disabled={!isHost || i === cur}
          onClick={() => onGo(p.id)}
          title={isHost ? t('room.goTo', { label: t(p.label) }) : t(p.label)}
        >
          <span className="step-n">{i < cur ? '✓' : i + 1}</span>
          <span className="step-l">{t(p.label)}</span>
        </button>
      ))}
      {!isHost && <span className="nav-hint muted">{t('room.hostLeads')}</span>}
    </nav>
  );
}

/** "Who are you": your name and look, editable here; the host passes them on to everyone. */
function WhoAmI({ m, host, onRename, onAvatar }: { m: Member; host: boolean; onRename: (n: string) => void; onAvatar: (a: AvatarLook) => void }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const open = pos !== null;
  const [draft, setDraft] = useState(m.name);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const commitName = () => {
    const n = draft.trim().slice(0, 40);
    if (n && n !== m.name) onRename(n);
    else setDraft(m.name);
  };
  const toggle = () => {
    if (open) return setPos(null);
    setDraft(m.name);
    const here = box.current!.getBoundingClientRect();
    const side = box.current!.closest('.sidebar')!.getBoundingClientRect();
    // Beside the sidebar when there is one; on narrow screens the sidebar is a top bar, so centre it below.
    setPos(innerWidth > 860 ? { left: side.right + 12, top: here.top } : { left: '50%', top: side.bottom + 8, transform: 'translateX(-50%)' });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      const inside = (n: Node) => box.current?.contains(n) || pop.current?.contains(n);
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside(e.target as Node)) setPos(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <section className="who" ref={box}>
      <h3 className="side-title">{t('who.title')}</h3>
      <button
        className="me-chip"
        title={t('me.rename')}
        aria-expanded={open}
        onClick={toggle}
      >
        <Avatar m={m} me host={host} />
        <span className="me-name">{m.name}</span>
        <span className="me-edit" aria-hidden>
          ✎
        </span>
      </button>
      {pos &&
        createPortal(
          <div className="profile-pop panel" role="dialog" aria-label={t('who.title')} style={pos} ref={pop}>
            <label className="field">
              <span className="field-label">{t('me.label')}</span>
              <input
                className="input"
                autoFocus
                value={draft}
                maxLength={40}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </label>
            <AvatarPicker value={m.avatar ?? defaultAvatar(m.id)} onChange={onAvatar} />
            <button
              className="btn primary small"
              onClick={() => {
                commitName();
                setPos(null);
              }}
            >
              {t('profile.done')}
            </button>
          </div>,
          document.body,
        )}
    </section>
  );
}

/** Stacked avatars of who is here; opens the full list. */
function People({ s, me, onKick }: { s: RoomState; me: string; onKick?: (m: Member) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const all = sortedMembers(s);
  const here = all.filter((m) => m.online || m.id === me);
  const others = here.filter((m) => m.id !== me);
  const shown = others.slice(0, 5);
  return (
    <div className="people" ref={box}>
      <button className="people-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('people.title', { n: here.length })}>
        <span className="member-strip">
          {shown.map((m) => (
            <Avatar key={m.id} m={m} host={m.id === s.hostId} />
          ))}
          {others.length > shown.length && <span className="avatar more">+{others.length - shown.length}</span>}
        </span>
        <span className="people-count">
          {here.length} <span aria-hidden>▾</span>
        </span>
      </button>
      {open && (
        <div className="people-pop panel" role="dialog" aria-label={t('people.title', { n: here.length })}>
          <h3 className="section-title">{t('people.title', { n: here.length })}</h3>
          <PeopleList s={s} me={me} onKick={onKick} />
        </div>
      )}
    </div>
  );
}

/** The full list in the sidebar; on narrow screens the dropdown above takes over. */
function SidePeople({ s, me, onKick }: { s: RoomState; me: string; onKick?: (m: Member) => void }) {
  const here = Object.values(s.members).filter((m) => m.online || m.id === me).length;
  return (
    <section className="side-people">
      <h3 className="side-title">{t('people.title', { n: here })}</h3>
      <PeopleList s={s} me={me} onKick={onKick} />
    </section>
  );
}

function PeopleList({ s, me, onKick }: { s: RoomState; me: string; onKick?: (m: Member) => void }) {
  return (
    <ul className="members people-list">
      {sortedMembers(s).map((m) => (
        <li key={m.id} className={m.online ? '' : 'offline'}>
          <Avatar m={m} me={m.id === me} host={m.id === s.hostId} />
          <span className="m-name">
            {m.name}
            {m.id === me && <small>{t('you')}</small>}
          </span>
          <span className="m-status muted">
            {m.id === s.hostId ? t('people.host') : !m.online ? t('people.offline') : m.via === 'relay' ? '🔒' : ''}
          </span>
          {onKick && m.id !== s.hostId && (
            <button className="btn small ghost kick" onClick={() => onKick(m)} title={t('people.kick', { name: m.name })} aria-label={t('people.kick', { name: m.name })}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Connecting({
  code,
  status,
  error,
  isHost,
  onLeave,
  onAdopt,
  onRetry,
  relayBtn,
  rescue,
}: {
  code: string;
  status: string;
  error: Key | null;
  isHost: boolean;
  onLeave: () => void;
  onAdopt: () => void;
  onRetry: () => void;
  relayBtn: ReactNode;
  rescue: ReactNode;
}) {
  const save = !isHost ? hostSave(code) : null;
  return (
    <div className="connecting">
      <div className="pencil-spin" aria-hidden>
        ✎
      </div>
      <h2 className="title">{status === 'failed' ? t('connecting.failed') : isHost ? t('connecting.opening') : t('connecting.knocking')}</h2>
      <p className="muted">{error ? t(error) : t('connecting.sub', { code })}</p>
      {relayBtn && <p className="muted">{t('connecting.slow')} {relayBtn}</p>}
      {rescue}
      {save && status === 'failed' && (
        <div className="panel adopt">
          <p>{t('connecting.adoptText')}</p>
          <button className="btn primary" onClick={onAdopt}>
            {t('connecting.adoptBtn')}
          </button>
        </div>
      )}
      <div className="row-btns">
        {status === 'failed' && (
          <button className="btn primary" onClick={onRetry}>
            {error === 'err.kicked' ? t('connecting.rejoin') : t('connecting.retry')}
          </button>
        )}
        <button className="btn" onClick={onLeave}>
          {t('connecting.back')}
        </button>
      </div>
    </div>
  );
}
