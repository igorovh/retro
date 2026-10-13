import { useEffect, useRef } from 'react';
import type { Action, Column, RoomState, TimerState } from '../types';
import { clamp } from '../logic';
import { Avatar, beep, sortedMembers, useNow } from '../ui';

export function ColHead({ col, count }: { col: Column; count?: number }) {
  return (
    <header className={`col-head col-head-${col.color}`}>
      <h3>
        {col.title}
        {count !== undefined && <span className="count">{count}</span>}
      </h3>
      {col.hint && <p>{col.hint}</p>}
    </header>
  );
}

export function PhaseTitle({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="phase-top">
      <div>
        <h2 className="title">{title}</h2>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function AdminBar({ children, label = 'Panel admina' }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="admin-bar">
      <span className="admin-tag">♛ {label}</span>
      {children}
    </div>
  );
}

export function Members({ s, me, extra }: { s: RoomState; me: string; extra?: (id: string) => React.ReactNode }) {
  return (
    <ul className="members">
      {sortedMembers(s).map((m) => (
        <li key={m.id} className={m.online ? '' : 'offline'}>
          <Avatar m={m} me={m.id === me} host={m.id === s.hostId} />
          <span className="m-name">
            {m.name}
            {m.id === me && <small> (ty)</small>}
          </span>
          {extra?.(m.id)}
        </li>
      ))}
    </ul>
  );
}

const fmt = (ms: number) => {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export function Timer({ t, offset, isHost, send }: { t: TimerState; offset: number; isHost: boolean; send: (a: Action) => void }) {
  const now = useNow(250);
  const rem = t.running ? t.endsAt - (now + offset) : t.remainingMs;
  const over = t.started && rem <= 0;
  const pct = t.totalMs ? clamp(rem / t.totalMs, 0, 1) : 0;
  const prev = useRef(rem);

  useEffect(() => {
    if (t.running && prev.current > 0 && rem <= 0) beep();
    prev.current = rem;
  }, [rem, t.running]);

  return (
    <div className={`timer ${over ? 'over' : ''} ${!t.running && !over ? 'paused' : ''} ${rem < 30_000 && !over ? 'hurry' : ''}`}>
      <div className="timer-face">
        <svg viewBox="0 0 120 120" className="timer-ring" aria-hidden>
          <circle cx="60" cy="60" r="50" className="track" />
          <circle cx="60" cy="60" r="50" className="prog" pathLength={100} strokeDasharray="100 100" strokeDashoffset={100 - pct * 100} />
        </svg>
        <div className="timer-digits">{over ? 'Czas!' : fmt(rem)}</div>
        {!t.running && !over && <div className="timer-sub">pauza</div>}
      </div>
      {isHost && (
        <div className="timer-ctrl">
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: -60_000 })} title="Odejmij minutę">
            −1
          </button>
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: 60_000 })} title="Dodaj minutę">
            +1
          </button>
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: 5 * 60_000 })} title="Dodaj 5 minut">
            +5
          </button>
          {t.running ? (
            <button className="btn small" onClick={() => send({ type: 'pauseTimer' })} title="Pauza">
              ❚❚
            </button>
          ) : (
            <button className="btn small" onClick={() => send({ type: 'resumeTimer' })} title="Wznów" disabled={rem <= 0}>
              ▶
            </button>
          )}
        </div>
      )}
    </div>
  );
}
