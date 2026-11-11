import type { Avatar } from './types';

// Eyes first: turned a quarter clockwise they read top to bottom like a face.
export const FACES = [':)', ':D', ':P', ';)', ':O', ':3', ':]', '=)', '8)', 'xD', ':*', ':>', ';D', ':|', 'XP', '=D', ';P', ':S'];
// Eight, so with the dice they fill the same nine columns as the faces.
export const HUES = [12, 38, 58, 95, 160, 200, 265, 320];

/** FNV-1a with a final mix, so similar ids still spread over the faces. */
function mix(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** What someone looks like before they pick anything. */
export const defaultAvatar = (id: string): Avatar => ({ face: FACES[mix(id + '#face') % FACES.length], hue: HUES[mix(id + '#hue') % HUES.length] });

export const randomAvatar = (): Avatar => ({
  face: FACES[Math.floor(Math.random() * FACES.length)],
  hue: HUES[Math.floor(Math.random() * HUES.length)],
});

/** Guests send their avatar; anything outside the two lists is ignored. */
export function cleanAvatar(a: unknown): Avatar | undefined {
  const x = a as Partial<Avatar> | null;
  return x && typeof x.face === 'string' && FACES.includes(x.face) && typeof x.hue === 'number' && HUES.includes(x.hue)
    ? { face: x.face, hue: x.hue }
    : undefined;
}
