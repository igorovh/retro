import { useMemo, type CSSProperties } from 'react';
import type { Ctx } from '../types';
import { buildActionsPrompt, exportText, groupTitle, plVotes, voteCounts } from '../logic';
import { Note, Squiggle, copyText, download } from '../ui';
import { AdminBar, ColHead } from './shared';

export function Summary({ s, isHost, send }: Ctx) {
  const byId = useMemo(() => new Map(s.cards.map((c) => [c.id, c])), [s.cards]);
  const counts = useMemo(() => voteCounts(s), [s]);
  const text = useMemo(() => exportText(s), [s]);
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
            Podsumowanie
            <Squiggle />
          </h2>
          <p className="muted">Dzięki za retro! Skopiuj albo pobierz wyniki, zanim zamkniecie kartę.</p>
        </div>
        <div className="export-box">
          <button className="btn primary" onClick={() => copyText(text, 'Podsumowanie skopiowane!')}>
            ⧉ Kopiuj jako tekst
          </button>
          <button className="btn" onClick={() => download(`retro-${s.code}-${date}.txt`, text)}>
            ⬇ Pobierz .txt
          </button>
          <button className="btn" onClick={() => copyText(buildActionsPrompt(s), 'Prompt skopiowany, wklej go do AI')} title="Prompt, który z wyników zrobi wnioski i action items">
            ✦ Prompt: action items
          </button>
        </div>
      </div>

      {isHost && (
        <AdminBar>
          <button className="btn ghost" onClick={() => send({ type: 'goPhase', phase: 'voting' })}>
            ← Wróć do głosowania
          </button>
        </AdminBar>
      )}

      <div className="stats">
        <Stat n={Object.keys(s.members).length} label="osób" />
        <Stat n={s.cards.length} label="kartek" />
        <Stat n={s.groups.length} label="tematów" />
        <Stat n={total} label="głosów" />
      </div>

      {ranked.length > 0 && (
        <section className="panel top-list">
          <h3 className="section-title">🏆 Top tematy</h3>
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
                  <b className="top-votes">{plVotes(votes(g.id))}</b>
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
                {gs.length === 0 && <p className="muted empty">brak kartek</p>}
                {gs.map((g) => {
                  const multi = g.cardIds.length > 1 || !!g.title;
                  const first = byId.get(g.cardIds[0]);
                  return (
                    <Note key={g.id} id={g.id} color={col.color} className="sum-card">
                      {votes(g.id) > 0 && <span className="vote-badge">{votes(g.id)}</span>}
                      {multi ? (
                        <>
                          <p className="group-title">{g.title || 'Grupa'}</p>
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
        <summary>Podgląd eksportu tekstowego</summary>
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
