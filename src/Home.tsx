import { useState } from 'react';
import { normalizeCode } from './logic';
import { Squiggle } from './ui';

const STEPS = ['zaproś ekipę', 'piszcie w ciszy', 'omówcie kartka po kartce', 'pogrupuj z AI', 'zagłosujcie', 'wyeksportuj'];

export function Home({
  initialName,
  initialCode,
  onCreate,
  onJoin,
}: {
  initialName: string;
  initialCode: string;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
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
          Sketchowa tablica do retrospektyw. <span className="hl">Peer-to-peer</span>, bez serwera i bez kont. Pokój żyje w przeglądarce
          osoby, która go założyła.
        </p>
      </div>

      <div className="home-card panel">
        <label className="field">
          <span className="field-label">Jak masz na imię?</span>
          <input
            className="input big"
            autoFocus
            value={name}
            maxLength={40}
            placeholder="np. Ania"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !n) return;
              if (invited && c) onJoin(n, c);
              else if (!invited) onCreate(n);
            }}
          />
        </label>

        <div className={`home-actions ${invited ? 'invited' : ''}`}>
          <section>
            <h3>Nowy pokój</h3>
            <p className="muted">Zostajesz adminem: wybierasz tablice, odpalasz timer i prowadzisz retro.</p>
            <button className={`btn ${invited ? '' : 'primary'}`} disabled={!n} onClick={() => onCreate(n)}>
              Załóż pokój →
            </button>
          </section>
          <div className="or">
            <span>albo</span>
          </div>
          <section>
            <h3>Dołącz</h3>
            <input
              className="input code-input"
              value={code}
              placeholder="KOD lub link"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && n && c && onJoin(n, c)}
            />
            <button className={`btn ${invited ? 'primary' : ''}`} disabled={!n || c.length < 4} onClick={() => onJoin(n, c)}>
              Dołącz do pokoju
            </button>
          </section>
        </div>
      </div>

      <ol className="home-steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <span className="step-n">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <p className="footnote muted">
        Połączenie: WebRTC przez PeerJS. Publiczny broker tylko „przedstawia” przeglądarki sobie nawzajem, dane lecą bezpośrednio między
        wami.
      </p>
    </main>
  );
}
