import { useMemo, type CSSProperties } from 'react';
import type { Ctx } from '../types';
import { nVotes } from '../logic';
import { t } from '../i18n';
import { Note } from '../ui';
import { AdminBar, ColHead, Members, PhaseTitle } from './shared';

export function Voting({ s, me, isHost, send }: Ctx) {
  const byId = useMemo(() => new Map(s.cards.map((c) => [c.id, c])), [s.cards]);
  const mine = s.votes[me] ?? [];
  const max = s.settings.votesPerPerson;
  const left = max - mine.length;
  const online = Object.values(s.members).filter((m) => m.online);
  const done = online.filter((m) => (s.votesUsed[m.id] ?? 0) >= max).length;

  return (
    <div className="phase voting">
      <PhaseTitle title={t('vote.title')} sub={t('vote.sub')}>
        <div className="vote-wallet panel">
          <div className="wallet-dots">
            {Array.from({ length: max }, (_, i) => (
              <span key={i} className={`vdot ${i < left ? 'full' : ''}`} />
            ))}
          </div>
          <b>{left > 0 ? t('vote.left', { votes: nVotes(left) }) : t('vote.allUsed')}</b>
        </div>
      </PhaseTitle>

      {isHost && (
        <AdminBar>
          <span className="muted">
            {t('vote.fully', { done, total: online.length })}
          </span>
          <button className="btn ghost" onClick={() => confirm(t('vote.clearConfirm')) && send({ type: 'resetVotes' })}>
            {t('vote.clear')}
          </button>
          <button className="btn primary" onClick={() => send({ type: 'goPhase', phase: 'summary' })}>
            {t('vote.show')}
          </button>
        </AdminBar>
      )}

      <div className="board" style={{ '--cols': s.columns.length } as CSSProperties}>
        {s.columns.map((col) => {
          const gs = s.groups.filter((g) => g.columnId === col.id);
          return (
            <section key={col.id} className="col">
              <ColHead col={col} count={gs.length} />
              <div className="col-cards">
                {gs.map((g) => {
                  const n = mine.filter((x) => x === g.id).length;
                  const multi = g.cardIds.length > 1 || !!g.title;
                  return (
                    <Note key={g.id} id={g.id} color={col.color} className={`vote-card ${n ? 'voted' : ''}`}>
                      {multi ? (
                        <>
                          <p className="group-title">{g.title || t('group.default')}</p>
                          <ul className="sub-cards">
                            {g.cardIds.map((id) => (
                              <li key={id}>{byId.get(id)?.text}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="note-text">{byId.get(g.cardIds[0])?.text}</p>
                      )}
                      <div className="vote-ctrl">
                        <button className="btn small" disabled={!n} onClick={() => send({ type: 'unvote', groupId: g.id })} aria-label={t('vote.remove')}>
                          −
                        </button>
                        <span className="my-dots" aria-label={t('vote.mine', { n })}>
                          {Array.from({ length: n }, (_, i) => (
                            <span key={i} className="vdot full" />
                          ))}
                        </span>
                        <button className="btn small" disabled={left <= 0} onClick={() => send({ type: 'vote', groupId: g.id })} aria-label={t('vote.add')}>
                          +
                        </button>
                      </div>
                    </Note>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel progress-panel">
        <h3 className="section-title">{t('vote.progress')}</h3>
        <Members
          s={s}
          me={me}
          extra={(id) => {
            const used = s.votesUsed[id] ?? 0;
            return <span className={`badge ${used >= max ? 'ok' : ''}`}>{used >= max ? '✓' : `${used}/${max}`}</span>;
          }}
        />
      </section>
    </div>
  );
}
