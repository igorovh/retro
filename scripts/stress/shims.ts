// Browser globals that src/ touches at import time; must be imported before anything from src/.
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const g = globalThis as Record<string, unknown>;
g.location = { search: '?relay&lang=en', href: 'http://stress/?relay', origin: 'http://stress', pathname: '/' };
g.localStorage = new MemStorage();
g.sessionStorage = new MemStorage();
g.document = { documentElement: {}, querySelector: () => null };
g.addEventListener = () => {};
g.removeEventListener = () => {};
