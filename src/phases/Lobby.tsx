import { NOTE_COLORS, type Column, type Ctx } from '../types';
import { PRESETS, presetColumns, uid } from '../logic';
import { inviteLink } from '../net';
import { EditableText, Note, Stepper, copyText } from '../ui';
import { ColHead, Members, PhaseTitle } from './shared';

export function Lobby({ s, me, isHost, send }: Ctx) {
  const host = s.members[s.hostId]?.name ?? 'admin';
  const setCols = (columns: Column[]) => send({ type: 'setColumns', columns });
  const patchCol = (id: string, p: Partial<Column>) => setCols(s.columns.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const activePreset = PRESETS.find((p) => p.columns.length === s.columns.length && p.columns.every(([t], i) => s.columns[i].title === t));
  const online = Object.values(s.members).filter((m) => m.online).length;

  return (
    <div className="phase lobby">
      <PhaseTitle
        title={isHost ? 'Przygotuj retro' : `Czekamy, aż ${host} wystartuje…`}
        sub={isHost ? 'Wybierz tablice, ustaw czas i zaproś ludzi. Gdy wszyscy będą, kliknij Start.' : 'Za chwilę zacznie się pisanie kartek. Rozgrzewaj długopis ✎'}
      />

      <div className="lobby-grid">
        <div className="lobby-main">
          {isHost ? (
            <>
              <section className="panel">
                <h3 className="section-title">1. Tablice</h3>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button key={p.id} className={`btn small preset ${activePreset?.id === p.id ? 'active' : ''}`} onClick={() => setCols(presetColumns(p))}>
                      {p.name}
                    </button>
                  ))}
                </div>

                <div className="col-editor">
                  {s.columns.map((c) => (
                    <Note key={c.id} id={c.id} color={c.color} className="col-edit">
                      <EditableText className="col-edit-title" value={c.title} maxLength={40} onCommit={(title) => patchCol(c.id, { title })} />
                      <EditableText
                        className="col-edit-hint"
                        value={c.hint}
                        placeholder="podpowiedź (opcjonalnie)"
                        maxLength={80}
                        onCommit={(hint) => patchCol(c.id, { hint })}
                      />
                      <div className="color-dots">
                        {NOTE_COLORS.map((col) => (
                          <button
                            key={col}
                            className={`dot dot-${col} ${c.color === col ? 'on' : ''}`}
                            onClick={() => patchCol(c.id, { color: col })}
                            aria-label={`kolor ${col}`}
                          />
                        ))}
                      </div>
                      {s.columns.length > 1 && (
                        <button className="note-x" onClick={() => setCols(s.columns.filter((x) => x.id !== c.id))} aria-label="Usuń kolumnę">
                          ×
                        </button>
                      )}
                    </Note>
                  ))}
                  {s.columns.length < 8 && (
                    <button
                      className="col-add"
                      onClick={() =>
                        setCols([...s.columns, { id: uid(6), title: 'Nowa kolumna', hint: '', color: NOTE_COLORS[s.columns.length % NOTE_COLORS.length] }])
                      }
                    >
                      + kolumna
                    </button>
                  )}
                </div>
              </section>

              <section className="panel">
                <h3 className="section-title">2. Zasady</h3>
                <div className="settings">
                  <div className="setting">
                    <span>Czas na pisanie</span>
                    <Stepper value={s.settings.minutes} min={1} max={60} suffix="min" onChange={(minutes) => send({ type: 'setSettings', settings: { minutes } })} />
                  </div>
                  <div className="setting">
                    <span>Głosy na osobę</span>
                    <Stepper
                      value={s.settings.votesPerPerson}
                      min={1}
                      max={20}
                      onChange={(votesPerPerson) => send({ type: 'setSettings', settings: { votesPerPerson } })}
                    />
                  </div>
                </div>
              </section>

              <button className="btn primary huge start-btn" onClick={() => send({ type: 'goPhase', phase: 'writing' })}>
                Start! Pisanie przez {s.settings.minutes} min ▶
              </button>
            </>
          ) : (
            <section className="panel">
              <h3 className="section-title">Tablice na dziś</h3>
              <div className="board preview" style={{ '--cols': s.columns.length } as React.CSSProperties}>
                {s.columns.map((c) => (
                  <div key={c.id} className="col">
                    <ColHead col={c} />
                  </div>
                ))}
              </div>
              <ul className="rules muted">
                <li>⏱ {s.settings.minutes} min na pisanie (admin może dorzucić czas)</li>
                <li>🙈 Kartki są ukryte, dopóki nie zaczniemy omawiania</li>
                <li>🗳 {s.settings.votesPerPerson} głos(y) na osobę na końcu</li>
              </ul>
            </section>
          )}
        </div>

        <aside className="lobby-side">
          <section className="panel invite">
            <h3 className="section-title">Zaproś ludzi</h3>
            <div className="invite-code">#{s.code}</div>
            <button className="btn" onClick={() => copyText(inviteLink(s.code), 'Link skopiowany, wyślij go ekipie!')}>
              ⧉ Kopiuj link
            </button>
          </section>
          <section className="panel">
            <h3 className="section-title">
              W pokoju <span className="count">{online}</span>
            </h3>
            <Members s={s} me={me} />
          </section>
        </aside>
      </div>
    </div>
  );
}
