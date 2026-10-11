import { useEffect, useMemo, useState } from 'react';
import { FACTIONS, card, maxCopies } from '../game/cards';
import { buyPack, buySingle, priceOf, shopPool, sideProgress, type Collection, type PackPull } from '../game/collection';
import { FILL_ODDS, PACK_PRICE, PACK_SIZE, RARITY_LABEL, TOP_ODDS } from '../game/economy';
import type { Card, FactionId } from '../game/types';
import { CardArt, CardPeek, KIND_LABEL } from './cardview';
import { GoldPurse } from './Gold';
import { sfx } from './sound';

const KIND_ORDER: Record<string, number> = { unit: 1, rite: 2, item: 3, device: 4, trap: 5 };
const pct = (odds: [string, number][], r: string) => Math.round((odds.find((o) => o[0] === r)?.[1] ?? 0) * 100);

export function TradingPost({ col, setCol, side, setSide, onBack, onDecks }: {
  col: Collection;
  setCol: (c: Collection) => void;
  side: FactionId;
  setSide: (f: FactionId) => void;
  onBack: () => void;
  onDecks: () => void;
}) {
  const [peek, setPeek] = useState<Card | null>(null);
  const [opened, setOpened] = useState<{ pulls: PackPull[]; refund: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const f = FACTIONS.find((x) => x.id === side)!;
  const prog = sideProgress(col, side);
  const hasLegend = shopPool(side).some((c) => c.rarity === 'patron');
  const groups = useMemo(() => {
    const cs = [...shopPool(side)].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.cost - b.cost || a.name.localeCompare(b.name));
    return [
      { name: 'Characters', cards: cs.filter((c) => c.kind === 'unit') },
      { name: 'Tricks, items, devices and traps', cards: cs.filter((c) => c.kind !== 'unit') },
    ];
  }, [side]);

  const doPack = () => {
    const r = buyPack(col, side);
    if ('error' in r) return setNote(r.error);
    setNote(null);
    setCol(r.col);
    setOpened({ pulls: r.pulls, refund: r.refund });
    sfx('bell', 0.45);
  };
  const doSingle = (c: Card) => {
    const r = buySingle(col, c.id);
    if ('error' in r) return setNote(r.error);
    setCol(r.col);
    setNote(`Bought ${c.name} for ${priceOf(c)} gold.`);
    sfx('cylinder', 0.4);
  };

  return (
    <section className="dh-page dh-post" data-testid="trading-post">
      <header className="dh-page-head">
        <button type="button" className="brass-btn brass-btn-ghost dh-page-back" data-testid="back-porch" onClick={onBack}>
          Back to the porch
        </button>
        <div className="dh-page-title">
          <p className="dh-page-kicker">Goods for every side</p>
          <h1>Trading Post</h1>
        </div>
        <GoldPurse gold={col.gold} />
      </header>
      <nav className="codex-tabs dh-tabs" role="tablist" aria-label="Side">
        {FACTIONS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={side === x.id} className={`codex-tab${side === x.id ? ' is-on' : ''}`} data-testid={`post-tab-${x.id}`} onClick={() => setSide(x.id)}>
            {x.short}
          </button>
        ))}
      </nav>

      <div className="dh-post-top">
        <article className="dh-pack" data-testid="pack-offer">
          <div className="dh-pack-crate" aria-hidden>
            <CardArt c={groups[0].cards[groups[0].cards.length - 1]} className="dh-pack-art" />
            <span className="dh-pack-seal">{f.short}</span>
          </div>
          <div className="dh-pack-copy">
            <p className="dh-page-kicker">Sealed crate</p>
            <h2>{f.name.replace(/^The /, '')} pack</h2>
            <p className="dh-pack-line">
              {PACK_SIZE} cards from this side, the last one Rare{hasLegend ? ' or Legendary' : ''}. No wasted pulls: once you hold every card of a rarity, you get the nearest rarity you still need. Spares only come once the side is complete, and they trade back for gold.
            </p>
            <div className="dh-pack-buy">
              <button type="button" className="brass-btn brass-btn-solid" data-testid="buy-pack" disabled={col.gold < PACK_PRICE} onClick={doPack}>
                Buy pack · {PACK_PRICE} gold
              </button>
              {col.gold < PACK_PRICE && <span className="dh-need">Need {PACK_PRICE - col.gold} more. Win matches to earn gold.</span>}
            </div>
            <p className="dh-odds">
              Odds for cards 1 to 4: Common {pct(FILL_ODDS, 'common')}%, Uncommon {pct(FILL_ODDS, 'uncommon')}%, Rare {pct(FILL_ODDS, 'rare')}%. Card 5: Rare
              {hasLegend ? ` ${pct(TOP_ODDS, 'rare')}%, Legendary ${pct(TOP_ODDS, 'patron')}%` : ''}. A side short of a rarity gives the nearest one it has.
            </p>
          </div>
        </article>
        <aside className="dh-progress" data-testid="side-progress">
          <p className="dh-page-kicker">Your {f.short} collection</p>
          <p className="dh-progress-n">
            <strong>{prog.have}</strong> of {prog.full} cards
          </p>
          <div className="dh-bar" aria-hidden>
            <span style={{ width: `${Math.round((100 * prog.have) / prog.full)}%` }} />
          </div>
          <p className="dh-progress-note">{prog.missingGold ? `${prog.missingGold.toLocaleString('en-US')} gold buys every missing card one by one.` : 'Every card at the limit. Full set.'}</p>
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="post-to-decks" onClick={onDecks}>
            Edit {f.short} deck
          </button>
        </aside>
      </div>
      {note && (
        <p className="dh-note" role="status" data-testid="post-note">
          {note}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.name} className="codex-order">
          <h2 className="codex-order-name">
            {g.name} <small>{g.cards.length}</small>
          </h2>
          <ul className="dh-shop-grid">
            {g.cards.map((c) => {
              const have = col.owned[c.id] ?? 0;
              const full = have >= maxCopies(c);
              const price = priceOf(c);
              return (
                <li key={c.id} className={`dh-shop-card rarity-${c.rarity}${have ? '' : ' is-unowned'}`} data-testid="shop-card" data-card={c.id}>
                  <button type="button" className="dh-shop-art" onClick={() => setPeek(c)} aria-label={`Read ${c.name}`}>
                    <CardArt c={c} />
                    <span className="dh-cost-pip">{c.cost}</span>
                    <span className={`dh-own${full ? ' is-full' : ''}`} data-testid="owned-count">
                      {have}/{maxCopies(c)}
                    </span>
                  </button>
                  <span className="dh-shop-name">{c.name}</span>
                  <span className={`dh-rarity is-${c.rarity}`}>
                    {RARITY_LABEL[c.rarity]} · {KIND_LABEL[c.kind]}
                  </span>
                  <button type="button" className="dh-buy" data-testid="buy-single" disabled={full || col.gold < price} onClick={() => doSingle(c)}>
                    {full ? 'Owned' : `Buy · ${price}`}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {opened && (
        <div className="dh-veil" role="dialog" aria-modal aria-label="Pack opened" data-testid="pack-open" onClick={() => setOpened(null)}>
          <div className="dh-open-plate" onClick={(e) => e.stopPropagation()}>
            <p className="dh-page-kicker">{f.name}</p>
            <h2>The crate is open</h2>
            <ul className="dh-open-row">
              {opened.pulls.map((p, i) => {
                const c = card(p.id);
                return (
                  <li key={`${p.id}-${i}`} className={`dh-open-card rarity-${p.rarity}`} style={{ animationDelay: `${i * 140}ms` }} data-testid="pack-card" data-card={p.id}>
                    <button type="button" className="dh-open-art" onClick={() => setPeek(c)} aria-label={`Read ${c.name}`}>
                      <CardArt c={c} />
                    </button>
                    <span className="dh-open-name">{c.name}</span>
                    <span className={`dh-rarity is-${p.rarity}`}>{RARITY_LABEL[p.rarity]}</span>
                    {p.spare ? <span className="dh-tag is-spare">Spare · +{p.gold} gold</span> : p.isNew ? <span className="dh-tag is-new">New</span> : <span className="dh-tag">Second copy</span>}
                  </li>
                );
              })}
            </ul>
            {opened.refund > 0 && <p className="dh-note">Spares traded for {opened.refund} gold.</p>}
            <div className="dh-open-actions">
              <button type="button" className="brass-btn brass-btn-solid" data-testid="pack-done" onClick={() => setOpened(null)}>
                Done
              </button>
              <button type="button" className="brass-btn brass-btn-ghost" data-testid="pack-again" disabled={col.gold < PACK_PRICE} onClick={doPack}>
                Another · {PACK_PRICE}
              </button>
            </div>
          </div>
        </div>
      )}
      {peek && <CardPeek c={peek} onClose={() => setPeek(null)} />}
    </section>
  );
}
