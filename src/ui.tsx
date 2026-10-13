import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Member, NoteColor, RoomState } from './types';

export function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const tilt = (id: string, max = 2.2) => (((hash(id) % 1000) / 1000) * 2 - 1) * max;

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

let toastListener: ((m: string) => void) | null = null;
export const toast = (m: string) => toastListener?.(m);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string }[]>([]);
  useEffect(() => {
    toastListener = (m) => {
      const id = Math.random();
      setItems((x) => [...x, { id, m }]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== id)), 2400);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.m}
        </div>
      ))}
    </div>
  );
}

export async function copyText(text: string, msg = 'Skopiowane!') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.22, 0.44].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      const at = ctx.currentTime + t;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      o.start(at);
      o.stop(at + 0.2);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio is optional */
  }
}

interface NoteProps {
  id: string;
  color: NoteColor;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  title?: string;
}

export function Note({ id, color, className = '', style, children, ...rest }: NoteProps) {
  return (
    <div className={`note note-${color} ${className}`} style={{ '--tilt': `${tilt(id)}deg`, ...style } as CSSProperties} {...rest}>
      {children}
    </div>
  );
}

export function FaceDown({ id, small, onClick }: { id: string; small?: boolean; onClick?: () => void }) {
  return (
    <div
      className={`note facedown ${small ? 'note-sm' : ''} ${onClick ? 'clickable' : ''}`}
      style={{ '--tilt': `${tilt(id)}deg` } as CSSProperties}
      onClick={onClick}
      aria-label="Ukryta kartka"
    >
      <span>?</span>
    </div>
  );
}

const AVATAR_HUES = [12, 38, 95, 160, 200, 265, 320];

export function Avatar({ m, me, host }: { m: Member; me?: boolean; host?: boolean }) {
  const initials = m.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={`avatar ${m.online ? '' : 'offline'} ${me ? 'me' : ''}`}
      style={{ '--hue': AVATAR_HUES[hash(m.id) % AVATAR_HUES.length] } as CSSProperties}
      title={`${m.name}${me ? ' (ty)' : ''}${host ? ' · admin' : ''}${m.online ? '' : ' · offline'}`}
    >
      {initials || '?'}
      {host && <i className="crown">♛</i>}
    </span>
  );
}

export const sortedMembers = (s: RoomState) => Object.values(s.members).sort((a, b) => a.joinedAt - b.joinedAt);

export function Squiggle({ className = '' }: { className?: string }) {
  return (
    <svg className={`squiggle ${className}`} viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden>
      <path d="M2 9 C 25 2, 40 13, 62 7 S 100 3, 122 8 S 165 12, 198 5" />
    </svg>
  );
}

export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3" />
        </filter>
      </defs>
    </svg>
  );
}

export function ThemeToggle({ theme, onToggle, className = '' }: { theme: string; onToggle: () => void; className?: string }) {
  const dark = theme === 'dark';
  return (
    <button className={`btn icon ${className}`} onClick={onToggle} title={dark ? 'Tryb jasny' : 'Tryb ciemny'} aria-label="Przełącz motyw">
      <svg viewBox="0 0 24 24" width="22" height="22" style={{ filter: 'url(#rough)' }} aria-hidden>
        {dark ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
          </g>
        ) : (
          <path
            d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

/** Input that only reports on blur/Enter, so host-side trimming doesn't eat spaces while typing. */
export function EditableText({
  value,
  onCommit,
  className = '',
  placeholder,
  maxLength,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancel = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={`inline-input ${className}`}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (cancel.current) {
          cancel.current = false;
          setDraft(value);
        } else if (draft.trim() !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function Stepper({ value, onChange, min, max, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string }) {
  return (
    <div className="num-stepper">
      <button className="btn small" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="mniej">
        −
      </button>
      <span className="num-val">
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      <button className="btn small" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="więcej">
        +
      </button>
    </div>
  );
}
