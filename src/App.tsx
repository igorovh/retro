import { useEffect, useState } from 'react';
import { Home } from './Home';
import { Info } from './Info';
import { Room } from './Room';
import { newRoomCode, normalizeCode } from './logic';
import { getMyId, initHost, pruneHostSaves } from './net';
import { SvgDefs, ThemeToggle, Toaster } from './ui';

const NAME_KEY = 'sketchretro:name';
const THEME_KEY = 'sketchretro:theme';

type Theme = 'light' | 'dark';

// Room codes never contain I or O, so this can't collide with a room.
const isInfo = () => /^#\/?info\/?$/i.test(location.hash);
const readHash = () => (isInfo() ? '' : normalizeCode(location.hash.replace(/^#\/?/, '')));
// Per-tab first so a refresh keeps the tab's own name; localStorage only pre-fills new tabs.
const storedName = () => sessionStorage.getItem(NAME_KEY) ?? localStorage.getItem(NAME_KEY) ?? '';

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const [code, setCode] = useState(readHash);
  const [name, setName] = useState(storedName);
  const [inRoom, setInRoom] = useState(() => !!readHash() && !!storedName());
  const [info, setInfo] = useState(isInfo);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    pruneHostSaves();
    const onHash = () => {
      setInfo(isInfo());
      if (isInfo()) scrollTo(0, 0);
      const c = readHash();
      setCode(c);
      setName(storedName());
      setInRoom(!!c && !!storedName());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const enter = (n: string, c: string) => {
    localStorage.setItem(NAME_KEY, n);
    sessionStorage.setItem(NAME_KEY, n);
    setName(n);
    history.replaceState(null, '', `#/${c}`);
    setCode(c);
    setInRoom(true);
  };

  const create = (n: string) => {
    const c = newRoomCode();
    initHost(c, getMyId(), n);
    enter(n, c);
  };

  const leave = () => {
    history.replaceState(null, '', location.pathname + location.search);
    setCode('');
    setInRoom(false);
  };

  return (
    <>
      <SvgDefs />
      {info ? (
        <>
          <ThemeToggle theme={theme} onToggle={toggleTheme} className="floating-theme" />
          <Info />
        </>
      ) : inRoom && code ? (
        <Room key={code} code={code} name={name} theme={theme} onToggleTheme={toggleTheme} onLeave={leave} />
      ) : (
        <>
          <ThemeToggle theme={theme} onToggle={toggleTheme} className="floating-theme" />
          <Home key={code} initialName={name} initialCode={code} onCreate={create} onJoin={enter} />
        </>
      )}
      <Toaster />
    </>
  );
}
