import { useEffect, useState, useSyncExternalStore } from 'react';
import { PHASES, type Ctx, type Phase, type RoomState } from './types';
import { ClientSession, HostSession, adoptHost, getMyId, hostSave, inviteLink, isHostFor, type Session } from './net';
import { Avatar, LangSwitch, ThemeToggle, copyText, sortedMembers } from './ui';
import { t, type Key } from './i18n';
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

  useEffect(() => {
    const me = getMyId();
    const s = isHostFor(code, me) ? new HostSession(code, me, name) : new ClientSession(code, me, name);
    setSession(s);
    return () => s.destroy();
  }, [code, name, epoch]);

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
  const ctx: Ctx | null = s ? { s, me: session.me, isHost: session.isHost, send: (a) => session.send(a), offset: snap.offset } : null;

  const leave = () => {
    if (session.isHost && !confirm(t('room.leaveConfirm')))
      return;
    onLeave();
  };

  return (
    <div className="room">
      <header className="topbar">
        <button className="logo" onClick={leave} title={t('room.backTitle')}>
          retro<span>✎</span>
        </button>
        {s && <PhaseNav s={s} isHost={session.isHost} onGo={(phase) => session.send({ type: 'goPhase', phase })} />}
        <div className="topbar-right">
          {s && snap.via === 'relay' && (
            <span className="relay-badge" tabIndex={0} data-tip={t('relay.tip')} aria-label={t('relay.tip')}>
              <span aria-hidden>🔒</span> {t('relay.badge')}
            </span>
          )}
          {s && <MemberStrip s={s} me={session.me} />}
          <button className="chip" onClick={() => copyText(inviteLink(session.code), t('room.inviteCopied'))} title={t('room.copyInvite')}>
            #{session.code} <span aria-hidden>⧉</span>
          </button>
          <a className="btn icon info-link" href="#/info" target="_blank" rel="noopener" title={t('room.infoTitle')} aria-label={t('room.infoAria')}>
            ℹ
          </a>
          <LangSwitch />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="btn small ghost" onClick={leave}>
            {t('room.leave')}
          </button>
        </div>
      </header>

      {snap.status !== 'online' && s && (
        <div className="banner">{snap.error ? t(snap.error) : session.isHost ? t('banner.broker') : t('banner.lostHost')}</div>
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
        />
      )}
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
    </nav>
  );
}

function MemberStrip({ s, me }: { s: RoomState; me: string }) {
  const list = sortedMembers(s).filter((m) => m.online || m.id === me);
  const shown = list.slice(0, 6);
  return (
    <div className="member-strip" title={list.map((m) => m.name).join(', ')}>
      {shown.map((m) => (
        <Avatar key={m.id} m={m} me={m.id === me} host={m.id === s.hostId} />
      ))}
      {list.length > shown.length && <span className="avatar more">+{list.length - shown.length}</span>}
    </div>
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
}: {
  code: string;
  status: string;
  error: Key | null;
  isHost: boolean;
  onLeave: () => void;
  onAdopt: () => void;
  onRetry: () => void;
}) {
  const save = !isHost ? hostSave(code) : null;
  return (
    <div className="connecting">
      <div className="pencil-spin" aria-hidden>
        ✎
      </div>
      <h2 className="title">{status === 'failed' ? t('connecting.failed') : isHost ? t('connecting.opening') : t('connecting.knocking')}</h2>
      <p className="muted">{error ? t(error) : t('connecting.sub', { code })}</p>
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
            {t('connecting.retry')}
          </button>
        )}
        <button className="btn" onClick={onLeave}>
          {t('connecting.back')}
        </button>
      </div>
    </div>
  );
}
