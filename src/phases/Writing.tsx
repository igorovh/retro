import { useRef, useState, type CSSProperties } from 'react';
import type { Action, Card, Column, Ctx, NoteColor } from '../types';
import { plCards } from '../logic';
import { Note, useNow } from '../ui';
import { AdminBar, ColHead, Members, PhaseTitle, Timer } from './shared';

export function Writing({ s, me, isHost, send, offset }: Ctx) {
  const now = useNow(1000);
  const t = s.timer;
  const over = t.started && (t.running ? t.endsAt - (now + offset) : t.remainingMs) <= 0;
  const perAuthor = new Map<string, number>();
  for (const c of s.cards) if (c.authorId) perAuthor.set(c.authorId, (perAuthor.get(c.authorId) ?? 0) + 1);

  return (
    <div className="phase writing">
      <PhaseTitle title="Piszcie kartki ✎" sub="Twoje kartki widzisz tylko ty. Reszta zobaczy je dopiero przy omawianiu.">
        <Timer t={t} offset={offset} isHost={isHost} send={send} />
      </PhaseTitle>

      {over && <div className="banner warn">⏰ Czas minął! {isHost ? 'Możesz dorzucić minutę albo odkryć kartki.' : 'Dokończ myśl, zaraz odkrywamy kartki.'}</div>}

      {isHost && (
        <AdminBar>
          <span className="muted">Napisano już {plCards(s.cards.length)}.</span>
          <button className="btn primary" onClick={() => send({ type: 'goPhase', phase: 'review' })}>
            Koniec pisania → odkrywamy kartki
          </button>
        </AdminBar>
      )}

      <div className="board" style={{ '--cols': s.columns.length } as CSSProperties}>
        {s.columns.map((col) => (
          <WriteColumn key={col.id} col={col} cards={s.cards.filter((c) => c.columnId === col.id)} me={me} send={send} />
        ))}
      </div>

      <section className="panel progress-panel">
        <h3 className="section-title">Kto ile napisał</h3>
        <Members s={s} me={me} extra={(id) => <span className="badge">{perAuthor.get(id) ?? 0} ✎</span>} />
      </section>
    </div>
  );
}

function WriteColumn({ col, cards, me, send }: { col: Column; cards: Card[]; me: string; send: (a: Action) => void }) {
  const mine = cards.filter((c) => c.authorId === me).reverse();
  const others = cards.length - mine.length;
  return (
    <section className="col">
      <ColHead col={col} count={cards.length} />
      <Composer color={col.color} onAdd={(text) => send({ type: 'addCard', columnId: col.id, text })} />
      <div className="col-cards">
        {mine.map((c) => (
          <OwnCard key={c.id} c={c} color={col.color} send={send} />
        ))}
        {others > 0 && <Pile n={others} />}
      </div>
    </section>
  );
}

function Composer({ color, onAdd }: { color: NoteColor; onAdd: (t: string) => void }) {
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
        placeholder="Napisz kartkę… (Enter = przyklej)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="btn small" disabled={!text.trim()} onClick={submit}>
        Przyklej
      </button>
    </div>
  );
}

function OwnCard({ c, color, send }: { c: Card; color: NoteColor; send: (a: Action) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const cancelled = useRef(false);

  const save = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = text.trim();
    if (!v) send({ type: 'deleteCard', id: c.id });
    else if (v !== c.text) send({ type: 'editCard', id: c.id, text: v });
  };

  return (
    <Note id={c.id} color={color} className="pop-in">
      {editing ? (
        <textarea
          className="note-edit"
          autoFocus
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <p
          className="note-text editable"
          title="Kliknij, żeby edytować"
          onClick={() => {
            setText(c.text);
            setEditing(true);
          }}
        >
          {c.text}
        </p>
      )}
      <button className="note-x" onClick={() => send({ type: 'deleteCard', id: c.id })} aria-label="Usuń kartkę">
        ×
      </button>
    </Note>
  );
}

function Pile({ n }: { n: number }) {
  return (
    <div className="pile" title="Kartki innych osób są ukryte do omawiania">
      <div className="pile-stack">
        {Array.from({ length: Math.min(n, 3) }, (_, i) => (
          <div key={i} className="facedown" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <span>
        + {plCards(n)} innych osób <span aria-hidden>🙈</span>
      </span>
    </div>
  );
}
