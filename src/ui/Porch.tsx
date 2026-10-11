import { FACTIONS } from '../game/cards';
import type { FactionId } from '../game/types';
import type { Mind } from '../game/ai';

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

export function Porch({ mind, setMind, onRide, onCodex }: { mind: Mind; setMind: (m: Mind) => void; onRide: (f: FactionId) => void; onCodex: () => void }) {
  return (
    <main className="porch" data-testid="frontier-porch">
      <img className="porch-photo" src="/assets/titles/frontier-porch.jpg" alt="" />
      <div className="porch-shade" />
      <div className="porch-sheet">
        <p className="porch-kicker">A haunted range</p>
        <h1>Dust Hex</h1>
        <p className="porch-lede">Pick who you ride for. Cryptids are not a side. They are a sighting, and one steps in from that side’s bestiary.</p>
        {BANNERS.map((b) => (
          <section key={b.banner} className={`porch-banner is-${b.tone}`}>
            <h2>{b.banner}</h2>
            {FACTIONS.filter((f) => f.banner === b.banner).map((f) => (
              <button key={f.id} type="button" className="porch-ride" data-testid={`ride-${f.name}`} onClick={() => onRide(f.id)}>
                <span className="porch-ride-title">{f.name.replace(/^The /, '')}</span>
                <span className="porch-ride-line">{f.line}</span>
              </button>
            ))}
          </section>
        ))}
        <div className="porch-minds" role="group" aria-label="How hard the rival plays">
          {MINDS.map((x) => (
            <button key={x.id} type="button" className={mind === x.id ? 'is-on' : ''} aria-pressed={mind === x.id} onClick={() => setMind(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="dh-porch-links">
          <button type="button" className="brass-btn brass-btn-ghost" data-testid="open-codex" onClick={onCodex}>
            The Codex
          </button>
        </p>
      </div>
    </main>
  );
}
