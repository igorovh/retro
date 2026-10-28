import { NOTE_COLORS, type Column, type Ctx } from '../types';
import { PRESETS, presetColumns, presetMatches, uid } from '../logic';
import { t } from '../i18n';
import { inviteLink } from '../net';
import { EditableText, Note, Stepper, copyText } from '../ui';
import { ColHead, Members, PhaseTitle } from './shared';

export function Lobby({ s, me, isHost, send }: Ctx) {
  const host = s.members[s.hostId]?.name ?? t('role.admin');
  const setCols = (columns: Column[]) => send({ type: 'setColumns', columns });
  const patchCol = (id: string, p: Partial<Column>) => setCols(s.columns.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const activePreset = PRESETS.find((p) => presetMatches(p, s.columns));
  const online = Object.values(s.members).filter((m) => m.online).length;

  return (
    <div className="phase lobby">
      <PhaseTitle
        title={isHost ? t('lobby.titleHost') : t('lobby.titleGuest', { host })}
        sub={isHost ? t('lobby.subHost') : t('lobby.subGuest')}
      />

      <div className="lobby-grid">
        <div className="lobby-main">
          {isHost ? (
            <>
              <section className="panel">
                <h3 className="section-title">{t('lobby.boards')}</h3>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button key={p.id} className={`btn small preset ${activePreset?.id === p.id ? 'active' : ''}`} onClick={() => setCols(presetColumns(p))}>
                      {t(p.name)}
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
                        placeholder={t('lobby.colHint')}
                        maxLength={80}
                        onCommit={(hint) => patchCol(c.id, { hint })}
                      />
                      <div className="color-dots">
                        {NOTE_COLORS.map((col) => (
                          <button
                            key={col}
                            className={`dot dot-${col} ${c.color === col ? 'on' : ''}`}
                            onClick={() => patchCol(c.id, { color: col })}
                            aria-label={t('lobby.colorAria', { color: t(`color.${col}`) })}
                          />
                        ))}
                      </div>
                      {s.columns.length > 1 && (
                        <button className="note-x" onClick={() => setCols(s.columns.filter((x) => x.id !== c.id))} aria-label={t('lobby.delCol')}>
                          ×
                        </button>
                      )}
                    </Note>
                  ))}
                  {s.columns.length < 8 && (
                    <button
                      className="col-add"
                      onClick={() =>
                        setCols([...s.columns, { id: uid(6), title: t('lobby.newCol'), hint: '', color: NOTE_COLORS[s.columns.length % NOTE_COLORS.length] }])
                      }
                    >
                      {t('lobby.addCol')}
                    </button>
                  )}
                </div>
              </section>

              <section className="panel">
                <h3 className="section-title">{t('lobby.rules')}</h3>
                <div className="settings">
                  <div className="setting">
                    <span>{t('lobby.time')}</span>
                    <Stepper value={s.settings.minutes} min={1} max={60} suffix={t('lobby.min')} onChange={(minutes) => send({ type: 'setSettings', settings: { minutes } })} />
                  </div>
                  <div className="setting">
                    <span>{t('lobby.votes')}</span>
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
                {t('lobby.start', { n: s.settings.minutes })}
              </button>
            </>
          ) : (
            <section className="panel">
              <h3 className="section-title">{t('lobby.boardsToday')}</h3>
              <div className="board preview" style={{ '--cols': s.columns.length } as React.CSSProperties}>
                {s.columns.map((c) => (
                  <div key={c.id} className="col">
                    <ColHead col={c} />
                  </div>
                ))}
              </div>
              <ul className="rules muted">
                <li>{t('lobby.rule.time', { n: s.settings.minutes })}</li>
                <li>{t('lobby.rule.hidden')}</li>
                <li>{t('lobby.rule.votes', { n: s.settings.votesPerPerson })}</li>
              </ul>
            </section>
          )}
        </div>

        <aside className="lobby-side">
          <section className="panel invite">
            <h3 className="section-title">{t('lobby.invite')}</h3>
            <div className="invite-code">#{s.code}</div>
            <button className="btn" onClick={() => copyText(inviteLink(s.code), t('lobby.linkCopied'))}>
              {t('lobby.copyLink')}
            </button>
          </section>
          <section className="panel">
            <h3 className="section-title">
              {t('lobby.inRoom')} <span className="count">{online}</span>
            </h3>
            <Members s={s} me={me} />
          </section>
        </aside>
      </div>
    </div>
  );
}
