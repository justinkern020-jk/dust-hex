import { useEffect, useState } from 'react';
import type { Card } from '../game/types';
import { faction } from '../game/cards';

export const KIND_LABEL: Record<string, string> = {
  unit: 'Unit',
  leader: 'Leader',
  rite: 'Rite',
  item: 'Item',
  device: 'Device',
  trap: 'Trap',
};

const KW_TEXT: Record<string, [string, string]> = {
  fast: ['Fast', 'Strikes first in melee. A killing blow is not answered.'],
  slow: ['Slow', 'Strikes last in melee.'],
  tough: ['Tough', 'Each blow against it loses 1.'],
  ranged: ['Ranged', 'Strikes 2 tiles away in a straight line, never on a diagonal. The target does not answer.'],
  delay: ['Delay', 'Cannot move or strike the turn it enters.'],
  cryptid: ['Cryptid', 'A sighting from this side’s bestiary.'],
  harbor: ['Harbor', 'While it stands, enemy rites can name no other unit on its side.'],
  untargetable: ['Untargetable', 'Enemy rites cannot name it.'],
  noRangedTarget: ['Veiled', 'Ranged strikes cannot name it.'],
  noAnswer: ['Unanswered', 'Units it strikes do not strike back.'],
  evenGround: ['Even ground', 'While it stands, ranged strikes cannot name units on its side.'],
  winged: ['Winged', 'May enter on any empty tile outside the rival’s half.'],
  trapproof: ['Sure-footed', 'Hidden deaths do not spring on it.'],
  climber: ['Climber', 'Its first climb each turn does not spend its move.'],
  hold: ['Hold', 'Adjacent enemies cannot move.'],
  crown: ['Crown', 'Adjacent allies strike for +1.'],
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
          {c.standIn && <span className="dh-standin">Stand-in art</span>}
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
