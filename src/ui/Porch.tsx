import { FACTIONS, leaderOf } from '../game/cards';
import { CardArt } from './cardview';
import type { FactionId } from '../game/types';
import type { Mind } from '../game/ai';
import { activeDeck, type Collection } from '../game/collection';
import { GoldPurse } from './Gold';

const BANNERS: { banner: string; tone: string }[] = [
  { banner: 'Outlaws', tone: 'outlaw' },
  { banner: 'Lawmen', tone: 'law' },
  { banner: 'The army', tone: 'army' },
  { banner: 'Nations', tone: 'nation' },
];
export const MINDS: { id: Mind; label: string }[] = [
  { id: 'easy', label: 'Greenhorn' },
  { id: 'experienced', label: 'Trail hand' },
  { id: 'expert', label: 'Hard case' },
];

export function Porch({ col, mind, setMind, onRide, onCodex, onShop, onDecks }: {
  col: Collection;
  mind: Mind;
  setMind: (m: Mind) => void;
  onRide: (f: FactionId) => void;
  onCodex: () => void;
  onShop: () => void;
  onDecks: () => void;
}) {
  return (
    <main className="porch dh-porch" data-testid="frontier-porch">
      <picture>
        <source media="(orientation: portrait)" srcSet="/assets/titles/keyart-tall.webp" type="image/webp" />
        <source media="(orientation: portrait)" srcSet="/assets/titles/keyart-tall.jpg" />
        <source srcSet="/assets/titles/keyart-wide.webp" type="image/webp" />
        <img className="porch-photo dh-porch-art" src="/assets/titles/keyart-wide.jpg" alt="" />
      </picture>
      <div className="porch-shade" />
      <div className="porch-sheet dh-porch-sheet">
        <header className="dh-porch-head">
          <p className="porch-kicker">A haunted range</p>
          <h1 className="dh-logo dh-logo-porch" aria-label="Dust Hex">
            <span>Dust</span> <span>Hex</span>
          </h1>
          <span className="dh-rule" aria-hidden />
          <p className="porch-lede">Choose who you ride for. Cryptids are not a side: each one is a sighting that steps in from its side’s bestiary.</p>
        </header>
        <div className="dh-purse-row" data-testid="porch-purse">
          <GoldPurse gold={col.gold} />
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="open-shop" onClick={onShop}>
            Trading Post
          </button>
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="open-decks" onClick={onDecks}>
            Deck Editor
          </button>
        </div>
        <div className="dh-porch-grid">
          {FACTIONS.map((f) => (
            <button key={f.id} type="button" className={`porch-ride dh-ride is-${BANNERS.find((b) => b.banner === f.banner)?.tone ?? 'outlaw'}`} data-testid={`ride-${f.name}`} onClick={() => onRide(f.id)}>
              <CardArt c={leaderOf(f.id)} className="dh-ride-art" />
              <span className="dh-ride-copy">
                <span className="dh-ride-banner">{f.banner}</span>
                <span className="porch-ride-title">{f.name.replace(/^The /, '')}</span>
                <span className="porch-ride-line">{f.line}</span>
                <span className="dh-ride-deck" data-testid={`ride-deck-${f.id}`}>Deck · {activeDeck(col, f.id)?.name ?? 'Starter deck'}</span>
              </span>
              <span className="dh-ride-go" aria-hidden>›</span>
            </button>
          ))}
        </div>
        <footer className="dh-porch-foot">
          <div className="dh-minds-wrap">
            <span className="dh-minds-label" id="mind-label">Rival</span>
            <div className="porch-minds dh-seg" role="group" aria-labelledby="mind-label">
              {MINDS.map((x) => (
                <button key={x.id} type="button" className={mind === x.id ? 'is-on' : ''} aria-pressed={mind === x.id} onClick={() => setMind(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="brass-btn brass-btn-ghost dh-codex-btn" data-testid="open-codex" onClick={onCodex}>
            The Codex
          </button>
        </footer>
      </div>
    </main>
  );
}
