import { Squiggle } from './ui';
import { t, useLang, type Key } from './i18n';

const REPO = 'https://github.com/igorovh/retro';

function Node({ x, y, w = 150, icon, label, sub }: { x: number; y: number; w?: number; icon: string; label: string; sub?: string }) {
  return (
    <g transform={`translate(${x - w / 2} ${y - 38})`}>
      <rect className="d-box" width={w} height={76} rx={14} />
      <text className="d-icon" x={w / 2} y={34} textAnchor="middle">
        {icon}
      </text>
      <text className="d-label" x={w / 2} y={60} textAnchor="middle">
        {label}
      </text>
      {sub && (
        <text className="d-sub" x={w / 2} y={98} textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrowhead({ id, tone }: { id: string; tone: 'accent' | 'muted' }) {
  return (
    <marker id={id} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M1 1 L11 6 L1 11" className={`d-head ${tone}`} />
    </marker>
  );
}

function P2PDiagram() {
  return (
    <svg className="diagram" viewBox="0 0 640 290" role="img" aria-label={t('info.d.p2p')}>
      <defs>
        <Arrowhead id="ah-p2p" tone="accent" />
        <Arrowhead id="ah-sig" tone="muted" />
      </defs>
      <path className="d-line thin" d="M150 200 C 170 130, 220 95, 250 78" markerEnd="url(#ah-sig)" />
      <path className="d-line thin" d="M490 200 C 470 130, 420 95, 390 78" markerEnd="url(#ah-sig)" />
      <text className="d-note" x={128} y={118} textAnchor="middle">
        {t('info.d.where')}
      </text>
      <text className="d-note" x={515} y={118} textAnchor="middle">
        {t('info.d.here')}
      </text>
      <path className="d-line fat" d="M175 236 C 260 252, 380 222, 465 236" markerStart="url(#ah-p2p)" markerEnd="url(#ah-p2p)" />
      <text className="d-flow" x={320} y={275} textAnchor="middle">
        {t('info.d.flowA')}
      </text>
      <Node x={320} y={52} w={170} icon="🤝" label={t('info.d.peerjs')} />
      <Node x={95} y={225} icon="🧑" label={t('info.d.guest')} />
      <Node x={545} y={225} icon="👑" label={t('info.d.host')} />
    </svg>
  );
}

function RelayDiagram() {
  return (
    <svg className="diagram" viewBox="0 0 640 230" role="img" aria-label={t('info.d.relay')}>
      <defs>
        <Arrowhead id="ah-rel" tone="accent" />
      </defs>
      <path className="d-line fat" d="M150 110 C 175 100, 210 120, 238 108" markerStart="url(#ah-rel)" markerEnd="url(#ah-rel)" />
      <path className="d-line fat" d="M402 108 C 430 120, 465 100, 490 110" markerStart="url(#ah-rel)" markerEnd="url(#ah-rel)" />
      <text className="d-cipher" x={194} y={78} textAnchor="middle">
        🔒 a8f3e1…
      </text>
      <text className="d-cipher" x={446} y={78} textAnchor="middle">
        🔒 7c0b9d…
      </text>
      <Node x={78} y={110} w={130} icon="🧑" label={t('info.d.guest')} />
      <Node x={320} y={110} w={150} icon="📮" label={t('info.d.mqtt')} sub={t('info.d.mqttSub')} />
      <Node x={562} y={110} w={130} icon="👑" label={t('info.d.host')} />
      <text className="d-flow" x={320} y={218} textAnchor="middle">
        {t('info.d.flowB')}
      </text>
    </svg>
  );
}

const STORAGE: { icon: string; title: Key; text: Key; color: string }[] = [
  { icon: '👑', title: 'info.store.host.title', text: 'info.store.host.text', color: 'yellow' },
  { icon: '🧑', title: 'info.store.you.title', text: 'info.store.you.text', color: 'blue' },
  { icon: '☁️', title: 'info.store.servers.title', text: 'info.store.servers.text', color: 'green' },
];

const FAQ: [Key, Key][] = [
  ['info.faq.1.q', 'info.faq.1.a'],
  ['info.faq.2.q', 'info.faq.2.a'],
  ['info.faq.3.q', 'info.faq.3.a'],
  ['info.faq.4.q', 'info.faq.4.a'],
];

export function Info() {
  useLang();
  return (
    <main className="info">
      <a className="btn small ghost info-back" href="#/">
        {t('info.back')}
      </a>

      <header className="info-hero">
        <h1 className="title">
          {t('info.title')}
          <Squiggle />
        </h1>
        <p className="lead">
          <span className="hl">{t('info.lead.hl')}</span>
          {t('info.lead.rest')}
        </p>
      </header>

      <section className="panel info-oss">
        <span className="info-emoji" aria-hidden>
          🔓
        </span>
        <p>
          {t('info.oss')}
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            github.com/igorovh/retro
          </a>
        </p>
      </section>

      <section className="info-sec">
        <h2 className="section-title">{t('info.a.title')}</h2>
        <p>{t('info.a.text')}</p>
        <div className="panel diagram-wrap">
          <P2PDiagram />
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">{t('info.b.title')}</h2>
        <p>
          {t('info.b.a')}
          <span className="relay-chip">🔒 {t('relay.badge')}</span>
          {t('info.b.b')}
        </p>
        <div className="panel diagram-wrap">
          <RelayDiagram />
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">{t('info.where')}</h2>
        <div className="storage-grid">
          {STORAGE.map((s, i) => (
            <div key={s.title} className={`note note-${s.color} storage-note`} style={{ '--tilt': `${[-1.5, 1, -0.6][i]}deg` } as React.CSSProperties}>
              <span className="storage-icon" aria-hidden>
                {s.icon}
              </span>
              <h3>{t(s.title)}</h3>
              <p>{t(s.text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">{t('info.faq.title')}</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="panel">
              <summary>{t(q)}</summary>
              <p>{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="footnote muted">
        {t('info.made')}
        <a href="https://github.com/igorovh" target="_blank" rel="noopener noreferrer">
          igorovh
        </a>
        .
      </p>
    </main>
  );
}
