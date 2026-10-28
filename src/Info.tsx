import { Squiggle } from './ui';

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
    <svg className="diagram" viewBox="0 0 640 290" role="img" aria-label="Gość i host łączą się bezpośrednio. Serwer PeerJS tylko pomaga im się znaleźć.">
      <defs>
        <Arrowhead id="ah-p2p" tone="accent" />
        <Arrowhead id="ah-sig" tone="muted" />
      </defs>
      <path className="d-line thin" d="M150 200 C 170 130, 220 95, 250 78" markerEnd="url(#ah-sig)" />
      <path className="d-line thin" d="M490 200 C 470 130, 420 95, 390 78" markerEnd="url(#ah-sig)" />
      <text className="d-note" x={128} y={118} textAnchor="middle">
        „gdzie jest host?”
      </text>
      <text className="d-note" x={515} y={118} textAnchor="middle">
        „tu jestem!”
      </text>
      <path className="d-line fat" d="M175 236 C 260 252, 380 222, 465 236" markerStart="url(#ah-p2p)" markerEnd="url(#ah-p2p)" />
      <text className="d-flow" x={320} y={275} textAnchor="middle">
        kartki, głosy, timer: prosto do siebie
      </text>
      <Node x={320} y={52} w={170} icon="🤝" label="serwer PeerJS" />
      <Node x={95} y={225} icon="🧑" label="gość" />
      <Node x={545} y={225} icon="👑" label="host" />
    </svg>
  );
}

function RelayDiagram() {
  return (
    <svg className="diagram" viewBox="0 0 640 230" role="img" aria-label="Gość i host wymieniają zaszyfrowane wiadomości przez serwer MQTT, który widzi tylko szyfrogram.">
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
      <Node x={78} y={110} w={130} icon="🧑" label="gość" />
      <Node x={320} y={110} w={150} icon="📮" label="serwer MQTT" sub="„widzę tylko krzaczki”" />
      <Node x={562} y={110} w={130} icon="👑" label="host" />
      <text className="d-flow" x={320} y={218} textAnchor="middle">
        klucz = kod pokoju, a serwer go nie zna
      </text>
    </svg>
  );
}

const STORAGE = [
  { icon: '👑', title: 'Przeglądarka hosta', text: 'Cały pokój: kartki, grupy, głosy. Leży w localStorage i sam znika po 14 dniach.', color: 'yellow' },
  { icon: '🧑', title: 'Twoja przeglądarka', text: 'Twoje imię i losowe ID karty. Tyle.', color: 'blue' },
  { icon: '☁️', title: 'Serwery', text: 'Nic. Zero. Pusto.', color: 'green' },
];

const FAQ = [
  ['Czy AI czyta nasze kartki?', 'Nie. Prompt dla AI kopiujesz sam i sam decydujesz, gdzie go wkleić. Bez tego kartki nigdzie nie wychodzą.'],
  [
    'Kto widzi moje kartki podczas pisania?',
    'W aplikacji tylko ty. Reszta zobaczy je dopiero na omawianiu. Technicznie są już w przeglądarce hosta, bo tam żyje pokój.',
  ],
  [
    'Co jeśli host zamknie kartę?',
    'Pokój zasypia. Host wraca pod ten sam link w tej samej przeglądarce (w razie czego klika „Przywróć pokój jako admin”) i gracie dalej.',
  ],
  ['Co znaczy plakietka „🔒 relay”?', 'Że twoja sieć nie dała rady połączyć się bezpośrednio i jedziecie planem B. Działa tak samo, tylko trochę okrężną drogą.'],
];

export function Info() {
  return (
    <main className="info">
      <a className="btn small ghost info-back" href="#/">
        ← Wróć
      </a>

      <header className="info-hero">
        <h1 className="title">
          Jak to działa?
          <Squiggle />
        </h1>
        <p className="lead">
          <span className="hl">Co się dzieje na retro, zostaje na retro.</span> Nie mamy bazy danych, kont ani analityki, więc nawet gdybyśmy chcieli
          podejrzeć, to nie ma gdzie.
        </p>
      </header>

      <section className="panel info-oss">
        <span className="info-emoji" aria-hidden>
          🔓
        </span>
        <p>
          Kod jest otwarty (licencja MIT). Nie musisz wierzyć na słowo, sprawdź sam:{' '}
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            github.com/igorovh/retro
          </a>
        </p>
      </section>

      <section className="info-sec">
        <h2 className="section-title">Plan A: prosto do siebie</h2>
        <p>
          Tak jest prawie zawsze. Serwer PeerJS tylko was sobie przedstawia, jak ciocia na weselu. Potem już się nie wtrąca: wszystko leci
          bezpośrednio między przeglądarkami (WebRTC, które jest szyfrowane z definicji).
        </p>
        <div className="panel diagram-wrap">
          <P2PDiagram />
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">Plan B: szyfrowany relay</h2>
        <p>
          Czasem sieć nie pozwala na bezpośrednie połączenie, np. internet mobilny albo firmowy firewall. Wtedy wiadomości idą przez publiczny
          serwer MQTT. To taki listonosz, który nosi zaklejone koperty: wszystko jest zaszyfrowane kluczem z kodu pokoju. Poznasz to po
          plakietce <span className="relay-chip">🔒 relay</span> na górze.
        </p>
        <div className="panel diagram-wrap">
          <RelayDiagram />
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">Gdzie co leży?</h2>
        <div className="storage-grid">
          {STORAGE.map((s, i) => (
            <div key={s.title} className={`note note-${s.color} storage-note`} style={{ '--tilt': `${[-1.5, 1, -0.6][i]}deg` } as React.CSSProperties}>
              <span className="storage-icon" aria-hidden>
                {s.icon}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="info-sec">
        <h2 className="section-title">Pytania, które pewnie masz</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="panel">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="footnote muted">
        Zrobione z ✎ przez{' '}
        <a href="https://github.com/igorovh" target="_blank" rel="noopener noreferrer">
          igorovh
        </a>
        .
      </p>
    </main>
  );
}
