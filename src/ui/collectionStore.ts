/**
 * Where the collection lives. Dust Hex has no player accounts yet, so the
 * collection is kept in this browser's localStorage under a profile-scoped key
 * ("local" for now). An account can later load and save the same JSON.
 */
import { grantStarters, normalizeCollection, type Collection } from '../game/collection';

export const PROFILE = 'local';
export const collectionKey = (profile = PROFILE) => `dusthex.collection.v1.${profile}`;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** Load the collection; first launch (or an older save) gets every side's starter deck. */
export function loadCollection(store: Store | undefined = browserStore(), profile = PROFILE): Collection {
  let raw: unknown = null;
  try {
    const s = store?.getItem(collectionKey(profile));
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  const col = grantStarters(normalizeCollection(raw));
  saveCollection(col, store, profile);
  return col;
}

export function saveCollection(col: Collection, store: Store | undefined = browserStore(), profile = PROFILE): boolean {
  try {
    store?.setItem(collectionKey(profile), JSON.stringify(col));
    return true;
  } catch {
    return false;
  }
}
