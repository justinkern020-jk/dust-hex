import { useEffect, useMemo, useState } from 'react';
import { CARDS, FACTIONS } from '../game/cards';
import type { Card } from '../game/types';
import { CardArt, CardPeek } from './cardview';

const KIND_ORDER: Record<string, number> = { leader: 0, unit: 1, rite: 2, item: 3, device: 4, trap: 5 };

export function Codex({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState(FACTIONS[0].id);
  const [open, setOpen] = useState<Card | null>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const f = FACTIONS.find((x) => x.id === tab)!;
  const groups = useMemo(() => {
    const cs = CARDS.filter((c) => c.faction === tab).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.cost - b.cost || a.name.localeCompare(b.name));
    const chars = cs.filter((c) => c.kind === 'leader' || c.kind === 'unit');
    const rest = cs.filter((c) => !(c.kind === 'leader' || c.kind === 'unit'));
    return [
      { name: 'Characters', cards: chars },
      { name: 'Tricks, items, devices and traps', cards: rest },
    ];
  }, [tab]);
  return (
    <section className="codex" data-testid="codex">
      <header className="codex-head">
        <button type="button" className="brass-btn brass-btn-ghost" onClick={onBack}>
          Back to the porch
        </button>
        <div>
          <p className="plate-kicker dh-codex-kicker">A book of what walks the range</p>
          <h1 className="codex-title">The Codex</h1>
          <p className="codex-count" data-testid="codex-count">
            {CARDS.length} pages · six sides
          </p>
          <p className="codex-count" data-testid="codex-rule">Both sides score Claims at the end of each round, so going first banks no lead.</p>
        </div>
      </header>
      <nav className="codex-tabs" role="tablist" aria-label="Side">
        {FACTIONS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`codex-tab${tab === x.id ? ' is-on' : ''}`} onClick={() => setTab(x.id)}>
            {x.short}
          </button>
        ))}
      </nav>
      {groups.map((g) => (
        <div key={g.name} className="codex-order">
          <h2 className="codex-order-name">
            {g.name} <small>{g.cards.length}</small>
          </h2>
          {g.name === 'Characters' && <p className="codex-order-lore">{f.name}. {f.line}</p>}
          <ul className="codex-grid">
            {g.cards.map((c) => (
              <li key={c.id}>
                <button type="button" className={`codex-entry rarity-${c.rarity}`} data-testid="codex-open" onClick={() => setOpen(c)} aria-label={c.name}>
                  <span className="codex-entry-art">
                    <CardArt c={c} />
                  </span>
                  <span className="codex-entry-name">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && <CardPeek c={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
