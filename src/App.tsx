import { useEffect, useState } from 'react';
import { Home } from './Home';
import { Info } from './Info';
import { Room } from './Room';
import { newRoomCode, normalizeCode } from './logic';
import { getMyId, hostFromCopy, initHost, parseCopy, pruneHostSaves, rememberName, storedName, tabHasName } from './net';
import { LangSwitch, SvgDefs, ThemeToggle, Toaster, toast } from './ui';
import { t, useLang } from './i18n';

const THEME_KEY = 'sketchretro:theme';

type Theme = 'light' | 'dark';

// Room codes never contain I or O, so this can't collide with a room.
const isInfo = () => /^#\/?info\/?$/i.test(location.hash);
const readHash = () => (isInfo() ? '' : normalizeCode(location.hash.replace(/^#\/?/, '')));

export default function App() {
  useLang();
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const [code, setCode] = useState(readHash);
  const [name, setName] = useState(storedName);
  // Only a refresh walks straight in; a fresh invite asks for the name, so a stale one is easy to fix.
  const [inRoom, setInRoom] = useState(() => !!readHash() && tabHasName());
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
      setInRoom(!!c && tabHasName());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const enter = (n: string, c: string) => {
    rememberName(n);
    setName(n);
    history.replaceState(null, '', `#/${c}`);
    setCode(c);
    setInRoom(true);
  };

  const create = (n: string) => {
    const c = newRoomCode();
    initHost(c, getMyId(c), n);
    enter(n, c);
  };

  const restore = (n: string, text: string) => {
    const copy = parseCopy(text);
    if (!copy) return toast(t('home.importBad'));
    enter(n, hostFromCopy(copy, n));
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
          <div className="floating-tools">
            <LangSwitch />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <Info />
        </>
      ) : inRoom && code ? (
        <Room key={code} code={code} name={name} theme={theme} onToggleTheme={toggleTheme} onLeave={leave} />
      ) : (
        <>
          <div className="floating-tools">
            <LangSwitch />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <Home key={code} initialName={name} initialCode={code} onCreate={create} onJoin={enter} onImport={restore} />
        </>
      )}
      <Toaster />
    </>
  );
}
