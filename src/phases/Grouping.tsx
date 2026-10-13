import { useMemo, useState, type CSSProperties } from 'react';
import type { Card, Ctx, Group, NoteColor } from '../types';
import { buildAiPrompt, groupTitle, parseAiGroups, uid } from '../logic';
import { EditableText, Note, copyText, toast } from '../ui';
import { AdminBar, ColHead, PhaseTitle } from './shared';

export function Grouping({ s, isHost, send }: Ctx) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const byId = useMemo(() => new Map(s.cards.map((c) => [c.id, c])), [s.cards]);
  const merged = s.groups.filter((g) => g.cardIds.length > 1).length;
  const titled = s.groups.filter((g) => g.title).length;

  const setGroups = (groups: Group[]) => send({ type: 'setGroups', groups });

  const apply = () => {
    try {
      const groups = parseAiGroups(s, raw);
      setGroups(groups);
      setRaw('');
      setErr(null);
      const dupes = groups.filter((g) => g.cardIds.length > 1).length;
      toast(
        dupes
          ? `Gotowe! ${groups.length} tematów, w tym ${dupes} połączonych`
          : `Gotowe! AI nie znalazło powtórzeń, ${groups.length} osobnych tematów`,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const moveCard = (cardId: string, target: string) => {
    const card = byId.get(cardId);
    if (!card) return;
    const groups = s.groups.map((g) => ({ ...g, cardIds: g.cardIds.filter((id) => id !== cardId) }));
    if (target === 'new') groups.push({ id: uid(), title: '', columnId: card.columnId, cardIds: [cardId] });
    else groups.find((g) => g.id === target)?.cardIds.push(cardId);
    setGroups(groups);
  };

  const dropProps = (target: string) =>
    isHost
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(target);
          },
          onDragLeave: () => setDragOver((d) => (d === target ? null : d)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(null);
            const id = e.dataTransfer.getData('text/plain');
            if (id) moveCard(id, target);
          },
        }
      : {};

  return (
    <div className="phase grouping">
      <PhaseTitle
        title="Grupujemy podobne pomysły"
        sub={isHost ? 'Użyj AI albo przeciągaj kartki na siebie. Klik w tytuł grupy, żeby go zmienić.' : 'Admin układa kartki w grupy. Możesz skopiować prompt i podpowiedzieć.'}
      />

      <section className="panel ai-panel">
        <div className="ai-steps">
          <div className="ai-step">
            <span className="step-n">1</span>
            <div>
              <b>Skopiuj prompt</b>
              <p className="muted">Zawiera tylko treść kartek, bez imion.</p>
              <button className="btn" onClick={() => copyText(buildAiPrompt(s), 'Prompt skopiowany, wklej go do AI')}>
                ✦ Kopiuj prompt dla AI
              </button>
            </div>
          </div>
          <div className="ai-step">
            <span className="step-n">2</span>
            <div>
              <b>Wklej do ChatGPT / Claude / Gemini</b>
              <p className="muted">AI odpowie JSON-em z grupami.</p>
            </div>
          </div>
          {isHost && (
            <div className="ai-step grow">
              <span className="step-n">3</span>
              <div className="grow">
                <b>Wklej odpowiedź tutaj</b>
                <textarea
                  className="input"
                  rows={3}
                  value={raw}
                  placeholder='{"groups":[{"column":"col1","title":"…","cards":["k1","k3"]}]}'
                  onChange={(e) => {
                    setRaw(e.target.value);
                    setErr(null);
                  }}
                />
                {err && <p className="error">✗ {err}</p>}
                <button className="btn primary" disabled={!raw.trim()} onClick={apply}>
                  Pogrupuj
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {isHost && (
        <AdminBar>
          <span className="muted">
            {s.groups.length} tematów{merged ? `, w tym ${merged} połączonych` : ', bez powtórzeń'}
          </span>
          {(merged > 0 || titled > 0) && (
            <button className="btn ghost" onClick={() => send({ type: 'resetGroups' })}>
              ↺ Rozgrupuj wszystko
            </button>
          )}
          <button className="btn primary" onClick={() => send({ type: 'goPhase', phase: 'voting' })}>
            Dalej → głosowanie
          </button>
        </AdminBar>
      )}

      <div className="board" style={{ '--cols': s.columns.length } as CSSProperties}>
        {s.columns.map((col) => {
          const gs = s.groups.filter((g) => g.columnId === col.id).sort((a, b) => b.cardIds.length - a.cardIds.length);
          return (
            <section key={col.id} className={`col ${dragOver === `col:${col.id}` ? 'drag-over' : ''}`} {...dropProps(`col:${col.id}`)}>
              <ColHead col={col} count={gs.length} />
              <div className="col-cards">
                {gs.map((g) => (
                  <GroupBox
                    key={g.id}
                    g={g}
                    byId={byId}
                    color={col.color}
                    isHost={isHost}
                    highlight={dragOver === g.id}
                    dropProps={dropProps(g.id)}
                    options={gs.filter((x) => x.id !== g.id)}
                    onRename={(title) => setGroups(s.groups.map((x) => (x.id === g.id ? { ...x, title } : x)))}
                    onMove={moveCard}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function GroupBox({
  g,
  byId,
  color,
  isHost,
  highlight,
  dropProps,
  options,
  onRename,
  onMove,
}: {
  g: Group;
  byId: Map<string, Card>;
  color: NoteColor;
  isHost: boolean;
  highlight: boolean;
  dropProps: object;
  options: Group[];
  onRename: (t: string) => void;
  onMove: (cardId: string, target: string) => void;
}) {
  const multi = g.cardIds.length > 1;
  const boxed = multi || !!g.title;
  return (
    <div className={`group ${boxed ? 'multi' : ''} ${highlight ? 'drag-over' : ''}`} {...dropProps}>
      {boxed && (
        <div className="group-head">
          {isHost ? (
            <EditableText value={g.title} placeholder="Nazwij grupę…" maxLength={120} onCommit={onRename} className="group-title" />
          ) : (
            <span className="group-title">{g.title || 'Grupa'}</span>
          )}
          <span className="count">{g.cardIds.length}</span>
        </div>
      )}
      {g.cardIds.map((id) => {
        const c = byId.get(id);
        if (!c) return null;
        return (
          <Note
            key={id}
            id={id}
            color={color}
            className={`note-sm ${isHost ? 'draggable' : ''}`}
            draggable={isHost}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <p className="note-text">{c.text}</p>
            {isHost && (options.length > 0 || multi) && (
              <select className="move-select" value="" onChange={(e) => e.target.value && onMove(id, e.target.value)} aria-label="Przenieś kartkę" title="Przenieś do grupy">
                <option value="">⇢</option>
                {multi && <option value="new">osobno (wyjmij z grupy)</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    do: {groupTitle(o, byId).slice(0, 50)}
                  </option>
                ))}
              </select>
            )}
          </Note>
        );
      })}
    </div>
  );
}
