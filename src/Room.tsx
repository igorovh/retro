import { useEffect, useState, useSyncExternalStore } from 'react';
import { PHASES, type Ctx, type Phase, type RoomState } from './types';
import { ClientSession, HostSession, adoptHost, getMyId, hostSave, inviteLink, isHostFor, type Session } from './net';
import { Avatar, ThemeToggle, copyText, sortedMembers } from './ui';
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

const RELAY_TIP = 'Nie udało się połączyć bezpośrednio (peer-to-peer), więc ruch idzie przez publiczny serwer pośredniczący. Jest zaszyfrowany kluczem z kodu pokoju, więc serwer nie widzi treści.';

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
    if (session.isHost && !confirm('Wychodzisz jako admin. Pokój zniknie dla wszystkich, dopóki nie wrócisz (stan zostaje w tej przeglądarce). Wyjść?'))
      return;
    onLeave();
  };

  return (
    <div className="room">
      <header className="topbar">
        <button className="logo" onClick={leave} title="Wróć na start">
          retro<span>✎</span>
        </button>
        {s && <PhaseNav s={s} isHost={session.isHost} onGo={(phase) => session.send({ type: 'goPhase', phase })} />}
        <div className="topbar-right">
          {s && snap.via === 'relay' && (
            <span className="relay-badge" tabIndex={0} data-tip={RELAY_TIP} aria-label={RELAY_TIP}>
              <span aria-hidden>🔒</span> relay
            </span>
          )}
          {s && <MemberStrip s={s} me={session.me} />}
          <button className="chip" onClick={() => copyText(inviteLink(session.code), 'Link zaproszenia skopiowany!')} title="Kopiuj link zaproszenia">
            #{session.code} <span aria-hidden>⧉</span>
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="btn small ghost" onClick={leave}>
            Wyjdź
          </button>
        </div>
      </header>

      {snap.status !== 'online' && s && (
        <div className="banner">{snap.error ?? (session.isHost ? 'Łączę z brokerem…' : 'Straciłem połączenie z hostem, łączę ponownie…')}</div>
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
    <nav className="phase-nav" aria-label="Etapy retro">
      {PHASES.map((p, i) => (
        <button
          key={p.id}
          className={`step ${i === cur ? 'on' : ''} ${i < cur ? 'done' : ''}`}
          disabled={!isHost || i === cur}
          onClick={() => onGo(p.id)}
          title={isHost ? `Przejdź do: ${p.label}` : p.label}
        >
          <span className="step-n">{i < cur ? '✓' : i + 1}</span>
          <span className="step-l">{p.label}</span>
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
  error: string | null;
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
      <h2 className="title">{status === 'failed' ? 'Ups…' : isHost ? 'Otwieram pokój…' : 'Pukam do pokoju…'}</h2>
      <p className="muted">{error ?? `Łączę się peer-to-peer z pokojem #${code}.`}</p>
      {save && status === 'failed' && (
        <div className="panel adopt">
          <p>W tej przeglądarce jest zapis tego pokoju. Byłeś(-aś) jego adminem?</p>
          <button className="btn primary" onClick={onAdopt}>
            Przywróć pokój jako admin
          </button>
        </div>
      )}
      <div className="row-btns">
        {status === 'failed' && (
          <button className="btn primary" onClick={onRetry}>
            Spróbuj ponownie
          </button>
        )}
        <button className="btn" onClick={onLeave}>
          ← Wróć
        </button>
      </div>
    </div>
  );
}
