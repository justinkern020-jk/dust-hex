/** The gold purse shown on menus. */
export function GoldPurse({ gold, className = '' }: { gold: number; className?: string }) {
  return (
    <span className={`dh-gold ${className}`} data-testid="gold" data-gold={gold} aria-label={`${gold} gold`}>
      <span className="dh-gold-coin" aria-hidden />
      <span className="dh-gold-n">{gold.toLocaleString('en-US')}</span>
      <span className="dh-gold-unit">gold</span>
    </span>
  );
}
