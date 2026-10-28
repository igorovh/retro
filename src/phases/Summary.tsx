import { useMemo, type CSSProperties } from 'react';
import type { Ctx } from '../types';
import { buildActionsPrompt, exportText, groupTitle, nVotes, voteCounts } from '../logic';
import { t, useLang } from '../i18n';
import { Note, Squiggle, copyText, download } from '../ui';
import { AdminBar, ColHead } from './shared';

export function Summary({ s, isHost, send }: Ctx) {
  const lang = useLang();
  const byId = useMemo(() => new Map(s.cards.map((c) => [c.id, c])), [s.cards]);
  const counts = useMemo(() => voteCounts(s), [s]);
  const text = useMemo(() => exportText(s), [s, lang]);
  const votes = (id: string) => counts.get(id) ?? 0;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = Math.max(1, ...counts.values());
  const ranked = [...s.groups].filter((g) => votes(g.id) > 0).sort((a, b) => votes(b.id) - votes(a.id)).slice(0, 7);
  const colOf = (id: string) => s.columns.find((c) => c.id === id);
  const author = (id: string) => s.members[id]?.name ?? '';
  const date = new Date().toISOString().slice(0, 10);

  return (
    <div className="phase summary">
      <div className="phase-top">
        <div>
          <h2 className="title">
            {t('sum.title')}
            <Squiggle />
          </h2>
          <p className="muted">{t('sum.sub')}</p>
        </div>
        <div className="export-box">
          <button className="btn primary" onClick={() => copyText(text, t('sum.copied'))}>
            {t('sum.copyText')}
          </button>
          <button className="btn" onClick={() => download(`retro-${s.code}-${date}.txt`, text)}>
            {t('sum.download')}
          </button>
          <button className="btn" onClick={() => copyText(buildActionsPrompt(s), t('promptCopied'))} title={t('sum.promptTitle')}>
            {t('sum.prompt')}
          </button>
        </div>
      </div>

      {isHost && (
        <AdminBar>
          <button className="btn ghost" onClick={() => send({ type: 'goPhase', phase: 'voting' })}>
            {t('sum.back')}
          </button>
        </AdminBar>
      )}

      <div className="stats">
        <Stat n={Object.keys(s.members).length} label={t('unit.people', { n: Object.keys(s.members).length })} />
        <Stat n={s.cards.length} label={t('unit.cards', { n: s.cards.length })} />
        <Stat n={s.groups.length} label={t('unit.topics', { n: s.groups.length })} />
        <Stat n={total} label={t('unit.votes', { n: total })} />
      </div>

      {ranked.length > 0 && (
        <section className="panel top-list">
          <h3 className="section-title">{t('sum.top')}</h3>
          <ol>
            {ranked.map((g, i) => {
              const col = colOf(g.columnId);
              return (
                <li key={g.id} className="pop-in" style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="rank">{i + 1}</span>
                  <div className="top-body">
                    <div className="top-line">
                      <span className="top-title">{groupTitle(g, byId)}</span>
                      <span className={`tag col-head-${col?.color ?? 'yellow'}`}>{col?.title}</span>
                    </div>
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${(votes(g.id) / top) * 100}%` }} />
                    </div>
                  </div>
                  <b className="top-votes">{nVotes(votes(g.id))}</b>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="board" style={{ '--cols': s.columns.length } as CSSProperties}>
        {s.columns.map((col) => {
          const gs = s.groups.filter((g) => g.columnId === col.id).sort((a, b) => votes(b.id) - votes(a.id));
          return (
            <section key={col.id} className="col">
              <ColHead col={col} count={gs.length} />
              <div className="col-cards">
                {gs.length === 0 && <p className="muted empty">{t('sum.noCards')}</p>}
                {gs.map((g) => {
                  const multi = g.cardIds.length > 1 || !!g.title;
                  const first = byId.get(g.cardIds[0]);
                  return (
                    <Note key={g.id} id={g.id} color={col.color} className="sum-card">
                      {votes(g.id) > 0 && <span className="vote-badge">{votes(g.id)}</span>}
                      {multi ? (
                        <>
                          <p className="group-title">{g.title || t('group.default')}</p>
                          <ul className="sub-cards">
                            {g.cardIds.map((id) => {
                              const c = byId.get(id);
                              return (
                                <li key={id}>
                                  {c?.text}
                                  {c && author(c.authorId) && <small> · {author(c.authorId)}</small>}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      ) : (
                        <>
                          <p className="note-text">{first?.text}</p>
                          {first && author(first.authorId) && <span className="note-author">— {author(first.authorId)}</span>}
                        </>
                      )}
                    </Note>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <details className="panel export-preview">
        <summary>{t('sum.preview')}</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
