/**
 * Dust Hex economy tables: what matches pay, what the Trading Post charges,
 * and what a spare card trades back for. Gold is earned in play only.
 * There is no real money anywhere in the game.
 */
import type { Card } from './types';
import type { Mind } from './ai';

export type Rarity = Card['rarity'];

export const DECK_SIZE = 30;
/** Most copies of one card a deck (and a collection) can use. Patron (legendary) cards: one. */
export const MAX_COPIES: Record<Rarity, number> = { common: 2, uncommon: 2, rare: 2, patron: 1 };

export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', patron: 'Legendary' };

/** Gold for a finished match against the rival mind. */
export const WIN_GOLD: Record<Mind, number> = { easy: 25, experienced: 35, expert: 50 };
export const LOSS_GOLD = 10;
/** A loss pays nothing if you yield before this turn (stops quick-yield farming). */
export const LOSS_MIN_TURN = 6;
/** Bonus on your first win of each calendar day. */
export const DAILY_WIN_BONUS = 40;

/** Trading Post prices. */
export const PACK_PRICE = 150;
export const PACK_SIZE = 5;
export const SINGLE_PRICE: Record<Rarity, number> = { common: 15, uncommon: 30, rare: 60, patron: 150 };
/** A pack card you already hold at the limit trades back for this much gold. */
export const SPARE_GOLD: Record<Rarity, number> = { common: 5, uncommon: 10, rare: 20, patron: 50 };

/** Pack odds. Slots 1-4 roll on FILL_ODDS; the last slot is always Rare or better. */
export const FILL_ODDS: [Rarity, number][] = [
  ['common', 0.2],
  ['uncommon', 0.45],
  ['rare', 0.35],
];
export const TOP_ODDS: [Rarity, number][] = [
  ['rare', 0.9],
  ['patron', 0.1],
];
