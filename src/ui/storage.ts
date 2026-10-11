/**
 * Saves from the old build of this site used other key names. Carry the
 * player's sound settings over once, then clear the old keys away.
 */
export const LEGACY_SETTINGS_KEY = 'occult-wars.settings.v1';
export const SETTINGS_KEY = 'dusthex.settings.v1';
const LEGACY_PREFIXES = ['occult-wars.', 'ow:', 'ow-'];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function migrateLegacySaves(store: Store | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  if (!store) return false;
  let moved = false;
  try {
    const old = store.getItem(LEGACY_SETTINGS_KEY);
    if (old != null && store.getItem(SETTINGS_KEY) == null) {
      store.setItem(SETTINGS_KEY, old);
      moved = true;
    }
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && LEGACY_PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    /* private mode */
  }
  return moved;
}
