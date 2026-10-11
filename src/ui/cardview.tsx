import { useEffect, useState } from 'react';
import type { Card } from '../game/types';
import { faction } from '../game/cards';

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

/** The full reading of a card: art, rules, keywords and the quote. */
export function CardPeek({ c, power, onClose }: { c: Card; power?: number; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const kws = kwList(c);
  return (
    <div className="codex-page-scrim" role="dialog" aria-modal aria-label={c.name} data-testid="card-inspect" onClick={onClose}>
      <article className="codex-page dh-inspect" onClick={(e) => e.stopPropagation()}>
        <div className="codex-page-art">
          <CardArt c={c} alt={c.name} />
        </div>
        <div className="codex-page-text">
          <p className="plate-kicker">{basics(c)}</p>
          <h2>{c.name}</h2>
          {c.mark && <p className="dh-mark">{c.mark}</p>}
          {power != null && c.power != null && power !== c.power && (
            <p className="card-peek-live">
              On the field now at Power {power} (printed {c.power}).
            </p>
          )}
          <p className="codex-blurb">{c.text}</p>
          {c.lead && (
            <p className="codex-blurb">
              <strong>Lead · {c.lead.label}.</strong> {c.lead.text} Once a match.
            </p>
          )}
          {kws.length > 0 && (
            <ul className="card-peek-kw">
              {kws.map((k) => (
                <li key={k.key}>
                  <strong>{k.name}:</strong> {k.text}
                </li>
              ))}
            </ul>
          )}
          {c.quote && (
            <blockquote className="codex-quote">
              “{c.quote}”{c.quoted && <cite>— {c.quoted}</cite>}
            </blockquote>
          )}
          <button type="button" className="brass-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </article>
    </div>
  );
}
