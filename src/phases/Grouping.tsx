import { useMemo, useState, type CSSProperties } from 'react';
import type { Card, Ctx, Group, NoteColor } from '../types';
import { AiGroupsError, buildAiPrompt, groupTitle, nTopics, parseAiGroups, uid } from '../logic';
import { t, type Key } from '../i18n';
import { EditableText, Note, copyText, toast } from '../ui';
import { AdminBar, ColHead, PhaseTitle } from './shared';

export function Grouping({ s, isHost, send }: Ctx) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<Key | null>(null);
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
          ? t('group.doneMerged', { topics: nTopics(groups.length), merged: t('plural.merged', { n: dupes }) })
          : t('group.doneNone', { topics: t('plural.separateTopics', { n: groups.length }) }),
      );
    } catch (e) {
      setErr(e instanceof AiGroupsError ? e.key : 'ai.badJson');
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
        title={t('group.title')}
        sub={isHost ? t('group.subHost') : t('group.subGuest')}
      />

      <section className="panel ai-panel">
        <div className="ai-steps">
          <div className="ai-step">
            <span className="step-n">1</span>
            <div>
              <b>{t('group.step1')}</b>
              <p className="muted">{t('group.step1Hint')}</p>
              <button className="btn" onClick={() => copyText(buildAiPrompt(s), t('promptCopied'))}>
                {t('group.copy')}
              </button>
            </div>
          </div>
          <div className="ai-step">
            <span className="step-n">2</span>
            <div>
              <b>{t('group.step2')}</b>
              <p className="muted">{t('group.step2Hint')}</p>
            </div>
          </div>
          {isHost && (
            <div className="ai-step grow">
              <span className="step-n">3</span>
              <div className="grow">
                <b>{t('group.step3')}</b>
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
                {err && <p className="error">✗ {t(err)}</p>}
                <button className="btn primary" disabled={!raw.trim()} onClick={apply}>
                  {t('group.apply')}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {isHost && (
        <AdminBar>
          <span className="muted">
            {merged
              ? t('group.statsMerged', { topics: nTopics(s.groups.length), merged: t('plural.merged', { n: merged }) })
              : t('group.statsNone', { topics: nTopics(s.groups.length) })}
          </span>
          {(merged > 0 || titled > 0) && (
            <button className="btn ghost" onClick={() => send({ type: 'resetGroups' })}>
              {t('group.ungroup')}
            </button>
          )}
          <button className="btn primary" onClick={() => send({ type: 'goPhase', phase: 'voting' })}>
            {t('group.next')}
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
            <EditableText value={g.title} placeholder={t('group.namePh')} maxLength={120} onCommit={onRename} className="group-title" />
          ) : (
            <span className="group-title">{g.title || t('group.default')}</span>
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
              <select className="move-select" value="" onChange={(e) => e.target.value && onMove(id, e.target.value)} aria-label={t('group.moveAria')} title={t('group.moveTitle')}>
                <option value="">⇢</option>
                {multi && <option value="new">{t('group.separate')}</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t('group.moveTo', { title: groupTitle(o, byId).slice(0, 50) })}
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
