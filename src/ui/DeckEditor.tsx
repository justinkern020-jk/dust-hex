import { useEffect, useMemo, useState } from 'react';
import { FACTIONS, card, factionPool, leaderOf, maxCopies } from '../game/cards';
import {
  MAX_DECKS_PER_SIDE,
  activeDeck,
  bestDeck,
  canAdd,
  count,
  deckProblems,
  deleteDeck,
  priceOf,
  saveDeck,
  type Collection,
  type SavedDeck,
} from '../game/collection';
import { DECK_SIZE, RARITY_LABEL, SINGLE_PRICE } from '../game/economy';
import type { Card, FactionId } from '../game/types';
import { CardArt, CardPeek, KIND_LABEL } from './cardview';
import { GoldPurse } from './Gold';

const KIND_ORDER: Record<string, number> = { unit: 1, rite: 2, item: 3, device: 4, trap: 5 };
const sortCards = (a: Card, b: Card) => a.cost - b.cost || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name);
type Filter = 'all' | 'unit' | 'other';

export function DeckEditor({ col, setCol, side, setSide, onBack, onShop }: {
  col: Collection;
  setCol: (c: Collection) => void;
  side: FactionId;
  setSide: (f: FactionId) => void;
  onBack: () => void;
  onShop: () => void;
}) {
  const saved = activeDeck(col, side);
  const [deckId, setDeckId] = useState(saved?.id ?? 'starter');
  const [name, setName] = useState(saved?.name ?? 'Deck');
  const [cards, setCards] = useState<string[]>(saved?.cards ?? []);
  const [view, setView] = useState<'pool' | 'deck'>('pool');
  const [filter, setFilter] = useState<Filter>('all');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [peek, setPeek] = useState<Card | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leaveTo, setLeaveTo] = useState<null | (() => void)>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const decks = col.decks[side] ?? [];
  const stored = decks.find((d) => d.id === deckId);
  const dirty = !stored || stored.name !== name || stored.cards.join() !== cards.join();
  const problems = deckProblems(side, cards, col.owned);
  const inDeck = count(cards);
  const pool = useMemo(() => [...factionPool(side)].sort(sortCards), [side]);
  const deckCards = useMemo(() => Object.keys(inDeck).map(card).sort(sortCards), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const chars = cards.filter((id) => card(id).kind === 'unit').length;
  const curve = [1, 2, 3, 4, 5].map((n) => cards.filter((id) => (n === 5 ? card(id).cost >= 5 : card(id).cost === n)).length);
  const curveMax = Math.max(4, ...curve);
  const leader = leaderOf(side);
  const isActive = col.active[side] === deckId;

  const load = (d: SavedDeck | undefined) => {
    setDeckId(d?.id ?? 'starter');
    setName(d?.name ?? 'Deck');
    setCards(d ? [...d.cards] : []);
  };
  const guard = (go: () => void) => (dirty && cards.length ? setLeaveTo(() => go) : go());
  const switchSide = (f: FactionId) =>
    guard(() => {
      setSide(f);
      load(activeDeck(col, f));
    });

  const add = (c: Card) => {
    const why = canAdd(side, cards, c.id, col.owned);
    if (why) {
      setToast((col.owned[c.id] ?? 0) === 0 ? `${c.name}: buy it at the Trading Post for ${priceOf(c)} gold, or find it in ${FACTIONS.find((x) => x.id === side)!.short} packs.` : why);
      return;
    }
    setCards([...cards, c.id]);
  };
  const remove = (id: string) => {
    const i = cards.lastIndexOf(id);
    if (i >= 0) setCards([...cards.slice(0, i), ...cards.slice(i + 1)]);
  };
  const save = () => {
    if (problems.length) return setToast(problems[0]);
    setCol(saveDeck(col, side, { id: deckId, name: name.trim() || 'Deck', cards }, true));
    setToast(`Saved. You ride with ${name.trim() || 'this deck'} as ${FACTIONS.find((x) => x.id === side)!.short}.`);
  };
  const newDeck = () =>
    guard(() => {
      if (decks.length >= MAX_DECKS_PER_SIDE) return setToast(`Up to ${MAX_DECKS_PER_SIDE} decks per side.`);
      const id = `d${Date.now().toString(36)}`;
      setDeckId(id);
      setName(`Deck ${decks.length + 1}`);
      setCards(bestDeck(side, col.owned));
      setView('deck');
    });

  const shown = pool.filter((c) => (filter === 'all' ? true : filter === 'unit' ? c.kind === 'unit' : c.kind !== 'unit') && (!ownedOnly || (col.owned[c.id] ?? 0) > 0));

  return (
    <section className={`dh-page dh-decks is-view-${view}`} data-testid="deck-editor">
      <header className="dh-page-head">
        <button type="button" className="brass-btn brass-btn-ghost dh-page-back" data-testid="back-porch" onClick={() => guard(onBack)}>
          Back to the porch
        </button>
        <div className="dh-page-title">
          <p className="dh-page-kicker">Thirty cards and a leader</p>
          <h1>Deck Editor</h1>
        </div>
        <GoldPurse gold={col.gold} />
      </header>
      <nav className="codex-tabs dh-tabs" role="tablist" aria-label="Side">
        {FACTIONS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={side === x.id} className={`codex-tab${side === x.id ? ' is-on' : ''}`} data-testid={`deck-tab-${x.id}`} onClick={() => switchSide(x.id)}>
            {x.short}
          </button>
        ))}
      </nav>

      <div className="dh-deckbar">
        <label className="dh-field">
          <span>Deck</span>
          <select data-testid="deck-pick" value={deckId} onChange={(e) => guard(() => load(decks.find((d) => d.id === e.target.value)))}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {col.active[side] === d.id ? ' (riding)' : ''}
              </option>
            ))}
            {!stored && <option value={deckId}>{name} (new)</option>}
          </select>
        </label>
        <label className="dh-field dh-field-name">
          <span>Name</span>
          <input data-testid="deck-name" value={name} maxLength={28} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="dh-deckbar-btns">
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="deck-new" onClick={newDeck}>
            New deck
          </button>
          {stored && decks.length > 1 && (
            <button
              type="button"
              className="brass-btn brass-btn-ghost"
              data-testid="deck-delete"
              onClick={() => {
                const next = deleteDeck(col, side, deckId);
                setCol(next);
                load(activeDeck(next, side));
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="dh-summary" data-testid="deck-summary">
        <div className="dh-summary-main">
          <p className={`dh-count${cards.length === DECK_SIZE ? ' is-ok' : ''}`} data-testid="deck-count">
            <strong>{cards.length}</strong> / {DECK_SIZE}
          </p>
          <p className="dh-split" data-testid="deck-split">
            Characters {chars} · Other {cards.length - chars}
          </p>
          <p className="dh-leader-line">
            Leader <strong>{leader.name}</strong> leads from the tray
          </p>
        </div>
        <div className="dh-curve" aria-label="Cost curve" data-testid="deck-curve">
          {curve.map((n, i) => (
            <span key={i} className="dh-curve-col">
              <span className="dh-curve-n">{n}</span>
              <span className="dh-curve-bar" style={{ height: `${Math.round((100 * n) / curveMax)}%` }} />
              <span className="dh-curve-cost">{i === 4 ? '5+' : i + 1}</span>
            </span>
          ))}
        </div>
        <div className="dh-summary-btns">
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="deck-auto" onClick={() => setCards(bestDeck(side, col.owned))}>
            Auto-build best deck
          </button>
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="deck-clear" onClick={() => setCards([])} disabled={!cards.length}>
            Clear
          </button>
          <button type="button" className="brass-btn brass-btn-solid" data-testid="deck-save" onClick={save} disabled={!!problems.length || (!dirty && isActive)}>
            {!dirty && isActive ? 'Saved · riding' : !dirty ? 'Ride with this deck' : 'Save deck'}
          </button>
        </div>
        <p className={`dh-status${problems.length ? ' is-bad' : ''}`} data-testid="deck-status">
          {problems.length ? problems[0] : dirty ? 'Ready to save.' : isActive ? 'This is the deck you ride with.' : 'Saved.'}
        </p>
      </div>

      <div className="dh-seg dh-viewseg" role="group" aria-label="Show">
        <button type="button" className={view === 'pool' ? 'is-on' : ''} aria-pressed={view === 'pool'} data-testid="view-pool" onClick={() => setView('pool')}>
          All cards
        </button>
        <button type="button" className={view === 'deck' ? 'is-on' : ''} aria-pressed={view === 'deck'} data-testid="view-deck" onClick={() => setView('deck')}>
          Your deck ({cards.length})
        </button>
      </div>

      <div className="dh-decks-body">
        <div className="dh-pool" data-testid="deck-pool">
          <div className="dh-pool-tools">
            <div className="dh-seg" role="group" aria-label="Filter">
              {(['all', 'unit', 'other'] as Filter[]).map((k) => (
                <button key={k} type="button" className={filter === k ? 'is-on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {k === 'all' ? 'All' : k === 'unit' ? 'Characters' : 'Other'}
                </button>
              ))}
            </div>
            <label className="dh-check">
              <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> Owned only
            </label>
          </div>
          <p className="dh-hint-line">Tap a card to add it. Use ⓘ to read it.</p>
          <ul className="dh-pool-grid">
            {shown.map((c) => {
              const have = col.owned[c.id] ?? 0;
              const used = inDeck[c.id] ?? 0;
              const lim = Math.min(maxCopies(c), have);
              return (
                <li key={c.id} className={`dh-pool-card rarity-${c.rarity}${have ? '' : ' is-locked'}${used ? ' is-used' : ''}${used >= lim && have ? ' is-maxed' : ''}`} data-testid="pool-card" data-card={c.id} data-owned={have} data-used={used}>
                  <button type="button" className="dh-pool-add" onClick={() => add(c)} aria-label={have ? `Add ${c.name}` : `${c.name} (not owned)`}>
                    <CardArt c={c} />
                    <span className="dh-cost-pip">{c.cost}</span>
                    {used > 0 && <span className="dh-used">×{used}</span>}
                    {!have && (
                      <span className="dh-lock">
                        <span>Not owned</span>
                        <small>Trading Post · {priceOf(c)}</small>
                      </span>
                    )}
                  </button>
                  <span className="dh-pool-name">{c.name}</span>
                  <span className="dh-pool-meta">
                    {KIND_LABEL[c.kind]} · own {have}/{maxCopies(c)}
                  </span>
                  <button type="button" className="dh-info" aria-label={`Read ${c.name}`} data-testid="pool-info" onClick={() => setPeek(c)}>
                    ⓘ
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="dh-pool-foot">
            Missing cards come from the Trading Post: packs of five or single cards by rarity ({RARITY_LABEL.common} {SINGLE_PRICE.common}, {RARITY_LABEL.uncommon} {SINGLE_PRICE.uncommon}, {RARITY_LABEL.rare} {SINGLE_PRICE.rare}, {RARITY_LABEL.patron} {SINGLE_PRICE.patron} gold).{' '}
            <button type="button" className="dev-link" data-testid="deck-to-post" onClick={() => guard(onShop)}>
              Go to the Trading Post
            </button>
          </p>
        </div>

        <aside className="dh-decklist" data-testid="deck-list">
          <h2 className="codex-order-name">
            {name || 'Deck'} <small>{cards.length}</small>
          </h2>
          {!cards.length && <p className="dh-hint-line">Empty. Tap cards to add them, or auto-build.</p>}
          <ul>
            {deckCards.map((c) => (
              <li key={c.id} className={`dh-row rarity-${c.rarity}`} data-testid="deck-row" data-card={c.id}>
                <span className="dh-row-cost">{c.cost}</span>
                <button type="button" className="dh-row-name" onClick={() => setPeek(c)}>
                  {c.name}
                  <small>{KIND_LABEL[c.kind]}</small>
                </button>
                <span className="dh-row-n">×{inDeck[c.id]}</span>
                <button type="button" className="dh-row-btn" aria-label={`Remove ${c.name}`} data-testid="deck-remove" onClick={() => remove(c.id)}>
                  −
                </button>
                <button type="button" className="dh-row-btn" aria-label={`Add ${c.name}`} disabled={!!canAdd(side, cards, c.id, col.owned)} onClick={() => add(c)}>
                  +
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {toast && (
        <p className="dh-float-note" role="status" data-testid="deck-toast">
          {toast}
        </p>
      )}
      {leaveTo && (
        <div className="dh-veil" role="dialog" aria-modal aria-label="Unsaved changes" data-testid="deck-leave">
          <div className="dh-open-plate dh-small-plate">
            <h2>Leave without saving?</h2>
            <p className="dh-pack-line">Your changes to {name || 'this deck'} have not been saved.</p>
            <div className="dh-open-actions">
              <button type="button" className="brass-btn brass-btn-ghost" onClick={() => setLeaveTo(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="brass-btn brass-btn-solid"
                data-testid="deck-leave-discard"
                onClick={() => {
                  const go = leaveTo;
                  setLeaveTo(null);
                  go();
                }}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
      {peek && <CardPeek c={peek} onClose={() => setPeek(null)} />}
    </section>
  );
}
