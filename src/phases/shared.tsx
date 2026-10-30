import { useEffect, useRef, useState } from 'react';
import type { Action, Column, NoteColor, RoomState, TimerState } from '../types';
import { clamp } from '../logic';
import { Avatar, beep, sortedMembers, useNow } from '../ui';
import { t } from '../i18n';

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

export function AdminBar({ children, label = t('admin.panel') }: { children: React.ReactNode; label?: string }) {
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
            {m.id === me && <small>{t('you')}</small>}
          </span>
          {extra?.(m.id)}
        </li>
      ))}
    </ul>
  );
}

export function Composer({ color, onAdd, placeholder = t('writing.ph') }: { color: NoteColor; onAdd: (t: string) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return (
    <div className={`composer note-${color}`}>
      <textarea
        value={text}
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="btn small" disabled={!text.trim()} onClick={submit}>
        {t('writing.stick')}
      </button>
    </div>
  );
}

const fmt = (ms: number) => {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export function Timer({ t: timer, offset, isHost, send }: { t: TimerState; offset: number; isHost: boolean; send: (a: Action) => void }) {
  const now = useNow(250);
  const rem = timer.running ? timer.endsAt - (now + offset) : timer.remainingMs;
  const over = timer.started && rem <= 0;
  const pct = timer.totalMs ? clamp(rem / timer.totalMs, 0, 1) : 0;
  const prev = useRef(rem);

  useEffect(() => {
    if (timer.running && prev.current > 0 && rem <= 0) beep();
    prev.current = rem;
  }, [rem, timer.running]);

  return (
    <div className={`timer ${over ? 'over' : ''} ${!timer.running && !over ? 'paused' : ''} ${rem < 30_000 && !over ? 'hurry' : ''}`}>
      <div className="timer-face">
        <svg viewBox="0 0 120 120" className="timer-ring" aria-hidden>
          <circle cx="60" cy="60" r="50" className="track" />
          <circle cx="60" cy="60" r="50" className="prog" pathLength={100} strokeDasharray="100 100" strokeDashoffset={100 - pct * 100} />
        </svg>
        <div className="timer-digits">{over ? t('timer.over') : fmt(rem)}</div>
        {!timer.running && !over && <div className="timer-sub">{t('timer.paused')}</div>}
      </div>
      {isHost && (
        <div className="timer-ctrl">
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: -60_000 })} title={t('timer.minus')}>
            −1
          </button>
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: 60_000 })} title={t('timer.plus')}>
            +1
          </button>
          <button className="btn small" onClick={() => send({ type: 'addTime', ms: 5 * 60_000 })} title={t('timer.plus5')}>
            +5
          </button>
          {timer.running ? (
            <button className="btn small" onClick={() => send({ type: 'pauseTimer' })} title={t('timer.pause')}>
              ❚❚
            </button>
          ) : (
            <button className="btn small" onClick={() => send({ type: 'resumeTimer' })} title={t('timer.resume')} disabled={rem <= 0}>
              ▶
            </button>
          )}
        </div>
      )}
    </div>
  );
}
