import { useEffect, useMemo, type CSSProperties } from 'react';
import type { Card, Ctx } from '../types';
import { clamp } from '../logic';
import { t } from '../i18n';
import { FaceDown, Note, isTyping } from '../ui';
import { AdminBar, ColHead, PhaseTitle } from './shared';

export function Review({ s, me, isHost, send }: Ctx) {
  const total = s.reviewOrder.length;
  const idx = s.reviewIndex;
  const byId = useMemo(() => new Map(s.cards.map((c) => [c.id, c])), [s.cards]);
  const pos = useMemo(() => new Map(s.reviewOrder.map((id, i) => [id, i])), [s.reviewOrder]);
  const cur = byId.get(s.reviewOrder[idx]);
  const col = s.columns.find((c) => c.id === cur?.columnId);
  const go = (i: number) => isHost && send({ type: 'reviewGo', index: clamp(i, 0, total - 1) });

  useEffect(() => {
    if (!isHost) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        send({ type: 'reviewGo', index: idx + 1 });
      } else if (e.key === 'ArrowLeft') send({ type: 'reviewGo', index: idx - 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHost, idx, send]);

  const author = (c: Card) => (c.authorId === me ? t('author.you') : (s.members[c.authorId]?.name ?? '?'));

  if (!total) {
    return (
      <div className="phase review">
        <PhaseTitle title={t('review.empty')} sub={t('review.emptySub')} />
        {isHost && (
          <AdminBar>
            <button className="btn" onClick={() => send({ type: 'goPhase', phase: 'writing' })}>
              {t('review.backWriting')}
            </button>
          </AdminBar>
        )}
      </div>
    );
  }

  const last = idx >= total - 1;
  const host = s.members[s.hostId]?.name ?? t('role.admin');

  return (
    <div className="phase review">
      <PhaseTitle
        title={t('review.title')}
        sub={isHost ? t('review.subHost') : t('review.subGuest', { host })}
      />

      <div className="spotlight">
        <div className="spot-meta">
          <span className={`spot-col col-head-${col?.color ?? 'yellow'}`}>{col?.title}</span>
          <span className="muted">
            {t('review.cardOf', { n: idx + 1, total })}
          </span>
        </div>
        <div className="spot-row">
          {isHost && (
            <button className="btn round" disabled={idx === 0} onClick={() => go(idx - 1)} aria-label={t('review.prev')}>
              ←
            </button>
          )}
          {cur && (
            <Note key={cur.id} id={cur.id} color={col?.color ?? 'yellow'} className="note-xl flip-in">
              <p className="note-text">{cur.text}</p>
              <span className="note-author">— {author(cur)}</span>
            </Note>
          )}
          {isHost && (
            <button className="btn round" disabled={last} onClick={() => go(idx + 1)} aria-label={t('review.next')}>
              →
            </button>
          )}
        </div>
        <div className="progress" aria-hidden>
          <div className="progress-fill" style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
        {isHost && last && (
          <button className="btn primary big pop-in" onClick={() => send({ type: 'goPhase', phase: 'grouping' })}>
            {t('review.allDone')}
          </button>
        )}
      </div>

      <div className="board compact" style={{ '--cols': s.columns.length } as CSSProperties}>
        {s.columns.map((c) => {
          const ids = s.reviewOrder.filter((id) => byId.get(id)?.columnId === c.id);
          return (
            <section key={c.id} className="col">
              <ColHead col={c} count={ids.length} />
              <div className="col-cards">
                {ids.map((id) => {
                  const card = byId.get(id)!;
                  const p = pos.get(id)!;
                  const onClick = isHost ? () => go(p) : undefined;
                  if (card.hidden) return <FaceDown key={id} id={id} small onClick={onClick} />;
                  return (
                    <Note
                      key={id}
                      id={id}
                      color={c.color}
                      className={`note-sm ${p === idx ? 'current' : ''} ${p > idx ? 'pending' : ''} ${onClick ? 'clickable' : ''}`}
                      onClick={onClick}
                      title={p > idx ? t('review.pending') : undefined}
                    >
                      <p className="note-text">{card.text}</p>
                      <span className="note-author">{author(card)}</span>
                    </Note>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
