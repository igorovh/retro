import { useState } from 'react';
import { normalizeCode } from './logic';
import { AvatarPicker, Face, Squiggle } from './ui';
import { rememberAvatar, rememberDefaultName, storedAvatar } from './net';
import { t, type Key } from './i18n';

const STEPS: Key[] = ['home.step1', 'home.step2', 'home.step3', 'home.step4', 'home.step5', 'home.step6'];

export function Home({
  initialName,
  initialCode,
  onCreate,
  onJoin,
  onImport,
}: {
  initialName: string;
  initialCode: string;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onImport: (name: string, text: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [look, setLook] = useState(storedAvatar);
  const [picking, setPicking] = useState(false);
  const n = name.trim();
  const c = normalizeCode(code);
  const invited = !!initialCode;

  return (
    <main className="home">
      <div className="home-hero">
        <h1 className="logo-big">
          retro<span className="pencil">✎</span>
        </h1>
        <Squiggle className="hero-squiggle" />
        <p className="lead">
          {t('home.lead.a')}
          <span className="hl">{t('home.lead.hl')}</span>
          {t('home.lead.b')}
        </p>
      </div>

      <div className="home-card panel">
        <div className="field">
          <label className="field-label" htmlFor="home-name">
            {t('who.title')}
          </label>
          <div className="profile-row">
            <button className="profile-face" onClick={() => setPicking((p) => !p)} aria-expanded={picking} title={t('profile.change')}>
              <Face look={look} />
              <span className="me-edit" aria-hidden>
                ✎
              </span>
            </button>
            <input
              id="home-name"
              className="input big"
              autoFocus
              value={name}
              maxLength={40}
              placeholder={t('home.namePh')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => n && rememberDefaultName(n)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !n) return;
                if (invited && c) onJoin(n, c);
                else if (!invited) onCreate(n);
              }}
            />
          </div>
          {picking && (
            <AvatarPicker
              value={look}
              onChange={(a) => {
                setLook(a);
                rememberAvatar(a);
              }}
            />
          )}
        </div>

        <div className={`home-actions ${invited ? 'invited' : ''}`}>
          <section>
            <h3>{t('home.new.title')}</h3>
            <p className="muted">{t('home.new.text')}</p>
            <button className={`btn ${invited ? '' : 'primary'}`} disabled={!n} onClick={() => onCreate(n)}>
              {t('home.new.btn')}
            </button>
            <label className={`import-link muted ${n ? '' : 'disabled'}`} title={n ? t('home.importTip') : t('home.importNeedsName')}>
              <input
                type="file"
                accept=".json,application/json"
                hidden
                disabled={!n}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onImport(n, await file.text());
                }}
              />
              📂 {t('home.import')}
            </label>
          </section>
          <div className="or">
            <span>{t('home.or')}</span>
          </div>
          <section>
            <h3>{t('home.join.title')}</h3>
            <input
              className="input code-input"
              value={code}
              placeholder={t('home.join.ph')}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && n && c && onJoin(n, c)}
            />
            <button className={`btn ${invited ? 'primary' : ''}`} disabled={!n || c.length < 4} onClick={() => onJoin(n, c)}>
              {t('home.join.btn')}
            </button>
          </section>
        </div>
      </div>

      <ol className="home-steps">
        {STEPS.map((k, i) => (
          <li key={k}>
            <span className="step-n">{i + 1}</span>
            {t(k)}
          </li>
        ))}
      </ol>

      <footer className="footnote muted">
        <p>{t('home.foot')}</p>
        <p className="footnote-links">
          <a href="#/info">{t('home.foot.info')}</a> ·{' '}
          <a href="https://github.com/igorovh/retro" target="_blank" rel="noopener noreferrer">
            {t('home.foot.github')}
          </a>
        </p>
      </footer>
    </main>
  );
}
