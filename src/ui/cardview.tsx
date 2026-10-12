import { useEffect, useRef, useState } from 'react';
import type { Card } from '../game/types';
import { faction } from '../game/cards';
import { coinCrop } from './coinface';
import { PremiumCard } from './PremiumCard';

export const KIND_LABEL: Record<string, string> = {
  unit: 'Unit',
  leader: 'Leader',
  rite: 'Trick',
  item: 'Item',
  device: 'Device',
  trap: 'Trap',
};

export const KW_TEXT: Record<string, [string, string]> = {
  fast: ['Fast', 'Strikes first in melee. An enemy it kills cannot strike back.'],
  slow: ['Slow', 'Strikes last in melee.'],
  tough: ['Tough', 'Whenever it takes damage, it takes 1 less. Power it loses is not reduced.'],
  ranged: ['Ranged', 'Can also strike an enemy 2 tiles away in a straight line, never on a diagonal. That target cannot strike back; a strike next to it is answered as usual.'],
  delay: ['Delay', 'Cannot move or strike the turn you deploy it.'],
  cryptid: ['Cryptid', 'A sighting from this side’s bestiary.'],
  harbor: ['Harbor', 'While it stands, enemy tricks can name no other unit on its side.'],
  untargetable: ['Untargetable', 'Enemy tricks cannot name it.'],
  noRangedTarget: ['Veiled', 'Ranged strikes cannot name it.'],
  noAnswer: ['Unanswered', 'Units it strikes do not strike back.'],
  evenGround: ['Even ground', 'While it stands, ranged strikes cannot name units on its side.'],
  winged: ['Winged', 'You may deploy it on any empty tile outside the rival’s half.'],
  trapproof: ['Sure-footed', 'Traps cannot destroy it, though they can still hurt it.'],
  climber: ['Climber', 'If its first move in a turn is a climb, it does not spend its move.'],
  hold: ['Hold', 'Enemy units next to it cannot move. They can still strike.'],
  crown: ['Command', 'Your other units next to it deal 1 extra damage when they strike.'],
};

export function kwList(c: Card) {
  return c.kw.filter((k) => KW_TEXT[k]).map((k) => ({ key: k, name: KW_TEXT[k][0], text: KW_TEXT[k][1] }));
}

export function basics(c: Card) {
  const f = faction(c.faction);
  const bits = [`${KIND_LABEL[c.kind] ?? c.kind}`, f.short, `Cost ${c.cost}`];
  if (c.power != null && (c.kind === 'unit' || c.kind === 'leader')) bits.push(`Power ${c.power}`);
  return bits.join(' · ');
}

/** Card art with a quiet fallback. */
export function CardArt({ c, className, alt = '' }: { c: Card; className?: string; alt?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [c.id]);
  if (bad) return <div className={`card-art-fallback ${className ?? ''}`} aria-hidden />;
  return (
    <img
      src={c.art}
      alt={alt}
      className={className}
      loading="lazy"
      draggable={false}
      style={c.artPos ? { objectPosition: c.artPos } : undefined}
      onError={() => setBad(true)}
    />
  );
}

/** A unit's portrait as it sits in a round board coin (face and upper body). */
export function CoinFace({ c }: { c: Card }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [c.id]);
  return (
    <span className="coin-face" aria-hidden>
      {bad ? (
        <span className="card-art-fallback" />
      ) : (
        <img className="coin-portrait" src={c.art} alt="" draggable={false} style={coinCrop(c.id)} onError={() => setBad(true)} />
      )}
    </span>
  );
}

/** The full reading of a card: art, rules, keywords and the quote. */
export function CardPeek({ c, power, onClose }: { c: Card; power?: number; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const kws = kwList(c);
  // The finger that long-pressed to open this lifts right after: don't let that release close it.
  const opened = useRef(performance.now());
  return (
    <div className="codex-page-scrim pc-scrim" role="dialog" aria-modal aria-label={c.name} data-testid="card-inspect" onClick={() => performance.now() - opened.current > 450 && onClose()}>
      <div className="pc-sheet" onClick={(e) => e.stopPropagation()}>
        <PremiumCard c={c} power={power} />
        {power != null && c.power != null && power !== c.power && (
          <p className="card-peek-live pc-note">
            On the field now at Power {power} (printed {c.power}).
          </p>
        )}
        {kws.length > 0 && (
          <ul className="card-peek-kw pc-kw">
            {kws.map((k) => (
              <li key={k.key}>
                <strong>{k.name}:</strong> {k.text}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="brass-btn pc-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
