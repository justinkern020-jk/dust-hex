// Printed text for every card (Western wording pass, Oct 2026). This file is the
// single source of card rules text: gen-cards.mjs and spec-new.mjs read it, and
// gen-cards fails if a card has no entry here.
//
// House style:
//   "<Western name>. <plain rule>."  The name is flavor; the rule after it is literal.
//   Name who gets the effect (the card by name, "your units", "an enemy unit").
//   "deal N damage" / "takes N damage"  - lowers Power; Tough and shields reduce it.
//   "loses N Power"                     - lowers Power; nothing reduces it.
//   "N extra damage"                    - a strike bonus for your own unit.
//   "gains N Power" / "regains up to N lost Power" - buffs and mending, your side only.
//   "deploy" = put a unit from your hand or tray onto the board. "strike back" = the answer to a melee strike.
//   "exhausted" = cannot act for the rest of that turn. Money and Claims as the UI says them.

// Keyword sentences, worded the same on every card that carries them.
const fast = (n, he = 'he') => `Fast. ${n} gets the jump: ${he} strikes first in melee, and an enemy ${he} kills cannot strike back.`;
const tough = (n, he = 'he') => `Tough. ${n} is hard as rawhide: whenever ${he} takes damage, ${he} takes 1 less.`;
const ranged = (n) => `Ranged. ${n} can also shoot an enemy two tiles away in a straight line, and that target cannot strike back.`;
const hold = (n, him = 'him') => `Hold. ${n} pins enemies down: enemy units next to ${him} cannot move, though they can still strike.`;
const harbor = (n, he = 'he') => `Harbor. ${n} draws enemy fire: while ${he} is on the board, enemy tricks cannot target your other units.`;
const returns = (n, he = 'he') => `Returns. ${n} is hard to bury: the first time ${he} is destroyed, ${he} rides back in at the start of your next turn, exhausted.`;
const command = (n, him = 'him') => `Command. ${n} rallies the line: your other units next to ${him} deal 1 extra damage when they strike.`;
const steady = (n) => `Steady. If you have not played or deployed a card this turn, ${n} deals 1 extra damage when he strikes, and the target cannot strike back.`;
const delay = (n, him = 'him') => `${n} cannot move or strike the turn you deploy ${him}.`;
const attach = 'Attach to one of your units.';
const hidden = (what) => `Hide ${what} on an empty tile; the rival is not shown which.`;

export const TEXT = {
  // ---------------- Red Creek Gang
  jesse: 'Raid. Each time Jesse James destroys a unit, draw 1 and gain 2 money. Hard to Bury. The first time he is destroyed, he rides back in at the start of your next turn, exhausted.',
  billy: fast('Billy the Kid'),
  belle: `Harbor. While Belle Starr is on the board, enemy tricks cannot target your other units. Bandit Queen. Once each turn, when you play or deploy a Gang or Choir card, gain 1 money.`,
  cole: 'Calls the Bluff. Once each round, while Cole Younger is on the board, you may cancel a trick the rival plays. He is then exhausted for your next turn.',
  'grave-round': `Hot Load. ${attach} That unit’s next strike deals 2 extra damage; then exile Grave Round. If that strike destroys a unit, enemy tricks cannot target the bearer until your next turn.`,
  'hell-rail': 'Iron Road. Place on an empty tile. When one of your units moves onto it, that unit may move one more tile. The first enemy unit to enter it loses 2 Power.',
  switchman: 'Throw the Switch. When an enemy unit moves next to the Switchman, you may shove that unit onto another open tile beside it. If you do, it loses 1 Power.',
  derringer: `Hideout Gun. ${attach} That unit’s next strike lands first and deals 1 extra damage; then exile Derringer.`,
  'powder-fuse': 'Light the Fuse. Exhaust: deal 2 damage to any unit. If that destroys it, deal 1 damage to an enemy unit next to where it stood.',
  'mine-shaft': `Bottomless Shaft. ${hidden('a mine shaft')} The first enemy unit to enter it is destroyed.`,
  tommyknockers: `Cryptid. Knocking. Once each turn, look at a tile; you may move a trap there to another empty tile, shown only to you and its owner. ${delay('The Tommyknockers', 'them')}`,
  'cactus-cat': 'Cryptid. Fast. The Cactus Cat strikes first in melee, and an enemy it kills cannot strike back. Rustler. When it destroys a unit, the rival loses 1 money.',
  hodag: 'Cryptid. Bully. When you deploy the Hodag, choose an enemy unit: it cannot move or strike on its next turn. Traps cannot destroy the Hodag.',
  'the-raven': 'Ill Omen. Return a unit on the board to its owner’s hand. A leader goes back to its owner’s tray instead, and that player discards a card at random.',
  hidebehind: `Cryptid. Ambush. ${hidden('the Hidebehind')} The first enemy unit to enter that tile takes 3 damage, and the Hidebehind appears there or beside it, exhausted.`,
  'frank-james': 'Brothers in the Saddle. While your leader is on the board, Frank James deals 1 extra damage when he strikes.',
  'sam-bass': 'Train Robber. When Sam Bass destroys a unit, gain 1 money.',
  'black-bart': 'Poet Bandit. When Black Bart destroys a unit, draw 1.',
  'pearl-hart': `${fast('Pearl Hart', 'she')} Stage Holdup. When you deploy her, the rival loses 1 money.`,
  'henry-starr': 'Bank Man. When Henry Starr steps onto a money claim you do not hold, gain 2 money.',
  'dynamite-dick': 'Short Fuse. When Dynamite Dick is destroyed, deal 1 damage to each enemy unit next to him.',
  'kid-curry': fast('Kid Curry'),
  sundance: 'Hit and Run. After the Sundance Kid strikes and survives, he may move one tile.',
  joaquin: returns('Joaquin Murrieta'),
  jackalope: 'Cryptid. Fast. The Jackalope strikes first in melee, and an enemy it kills cannot strike back. Lucky Find. When you deploy it, draw 1.',
  'lost-dutchman': 'Lost Mine. When the Lost Dutchman is destroyed, draw 2.',
  'cousin-jack': 'Hard Rock. When you deploy Cousin Jack, look at one hidden tile. Traps cannot destroy him, though they can still hurt him.',

  // ---------------- Gallows Choir
  'faro-widow': `Dealer’s Edge. While the Faro Widow is on the board, the first time each turn you play a trick, item or device, draw 1. ${delay('She', 'her')}`,
  'ride-back': 'Saddle Up. Return a Gang or Choir unit from your discard pile to your hand. Or, if your leader has fallen, bring the leader back onto the board, exhausted.',
  'cinder-rider': 'Fast. Hell for Leather. The Cinder Rider may move one extra tile each turn. Each tile he leaves becomes a trap: the next enemy unit to enter it loses 2 Power.',
  'clay-shade': returns('The Clay County Shade'),
  'false-coffin': 'Playing Dead. Choose a Gang or Choir unit in your discard pile. At the end of this turn, return it to your hand. Then exile False Coffin.',
  riderless: `Fast. Riderless strikes first in melee, and an enemy he kills cannot strike back. Loose Horse. When you deploy him, you may move another of your units one tile.`,
  'night-wire': 'Barbed Wire. Place on an empty tile. Enemy units cannot move onto it. Exhaust: deal 1 damage to an enemy unit next to the wire.',
  'widow-lamp': 'Lantern Light. Look at one tile. If a trap or device is there, you may move it to another empty tile. Only you and its owner are shown where.',
  llorona: 'Cryptid. When you deploy her and at your turn’s start, the strongest enemy next to her cannot move on its next turn. The first time she is destroyed, lose 2 money and return her to hand (deck top if full).',
  'sleepy-hollow': 'Cryptid. Fast. Headless. After the Rider strikes and survives, you may move it one tile. A unit it destroys is exiled, and that unit’s “when destroyed” abilities do not happen.',
  'leeds-devil': 'Cryptid. Winged. You may deploy the Leeds Devil on any empty tile outside the rival’s half. Enemy tricks cannot target it the turn you deploy it.',
  'goodman-path': 'Wrong Turn. Choose a unit. It cannot move or strike until your next turn. Draw 1.',
  carmilla: 'Night Visitor. Attach to an enemy unit. At the start of each of your turns, that unit loses 1 Power. If it is destroyed while Carmilla is attached, draw 1 and gain 2 money.',
  'tom-horn': ranged('Tom Horn'),
  'black-jack-ketchum': 'Last Word. When Black Jack Ketchum is destroyed, he deals 2 damage to an enemy unit next to him.',
  'lester-moore': returns('Lester Moore'),
  'bell-witch': 'Cryptid. Torment. When you deploy her, the rival discards a card at random.',
  'alferd-packer': 'Hungry. When Alferd Packer destroys a unit, he gains 1 Power for good and regains all lost Power.',
  lechuza: 'Cryptid. Winged. You may deploy La Lechuza on any empty tile outside the rival’s half. Owl’s Cry. When you deploy her, deal 1 damage to an enemy unit.',
  'charley-parkhurst': `${fast('One-Eyed Charley', 'she')} Driver’s Secret. When Charley is destroyed, draw 1.`,
  'resurrection-man': 'Grave Robber. When you deploy the Resurrection Man, you may return a unit card from your discard pile to your hand.',
  undertaker: 'Pine Boxes. Once each turn, when any unit is destroyed, gain 1 money.',
  'circuit-rider': 'Camp Meeting. When you deploy the Circuit Rider, one of your units regains up to 2 lost Power.',
  'weeping-bride': 'Left at the Altar. When you deploy the Weeping Bride, the strongest enemy unit next to her cannot move on its next turn.',
  'hearse-driver': 'Last Ride. After the Hearse Driver strikes and survives, he may move one tile.',
  deaconess: harbor('The Night Deaconess', 'she'),
  'brother-lazarus': returns('Brother Lazarus'),
  organist: 'Dirge. Once each turn, when another of your units is destroyed, draw 1.',

  // ---------------- Silver Star
  bass: 'Duty. The first strike against Bass Reeves each turn deals him no damage. Bring Them In. When he destroys a unit, draw 1 or look at the hidden tile nearest your units.',
  wyatt: steady('Wyatt Earp'),
  hickok: 'Dead Man’s Hand. When Wild Bill is destroyed, he fires at an enemy unit next to him, dealing damage equal to his printed Power.',
  'silver-star': `Tin Star. ${attach} When that unit would move onto a tile hiding an enemy trap, it spots the trap and stays put.`,
  'open-warrant': 'Wanted. Choose an enemy unit. It cannot move on its next turn.',
  'salt-oath': 'Line in the Sand. Until your next turn, any enemy unit that strikes your leader loses 2 Power first.',
  'night-jailer': hold('The Night Jailer'),
  'boot-clerk': `Body Count. When an enemy unit is destroyed, gain 1 money. ${delay('The Boot Hill Clerk')}`,
  'silver-jury': 'Hung Jury. Choose an enemy unit. This turn it cannot strike or strike back.',
  manacles: 'Irons. Attach to an enemy unit. It cannot move. On their turn, the rival may pay 2 money to break the Manacles and exile them.',
  'jail-key': 'Turnkey. Exile an item or device the rival owns. If it was attached to an enemy unit, that unit loses 1 Power.',
  'gallows-rope': 'Hangman’s Knot. Destroy an enemy unit with 2 Power or less. If there is none, draw 1 instead.',
  'night-watch': 'On Watch. At the start of your turn, look at the hidden tile nearest your units. If it hides a trap, the next of your units that would step onto a trap spots it and stays put.',
  coroner: 'Inquest. Whenever a unit is destroyed, look at the top card of your deck. If it is a Silver Star card, draw it.',
  'posse-bell': 'Form a Posse. Exhaust: move up to two of your Silver Star units one tile each.',
  'hang-fire': 'Slow. Hang Fire strikes last in melee. Late Shot. The first time a strike would destroy him, he stays at 1 Power and fires back at the unit that struck him, dealing damage equal to his full Power.',
  ledger: 'Paper Trail. Pin to your leader. While your leader is on the board, the first card you play or deploy each turn gains you 1 money.',
  baca: tough('Elfego Baca'),
  bat: tough('Bat Masterson'),
  garrett: ranged('Pat Garrett'),
  doc: fast('Doc Holliday'),
  mothman: 'Cryptid. Ranged. The Mothman can also strike an enemy two tiles away in a straight line, and that target cannot strike back.',
  'black-dog': 'Cryptid. Fast. The Black Dog strikes first in melee, and an enemy it kills cannot strike back. Tracker. The first time an enemy unit crosses onto your half, you may move the dog next to it.',
  'yellow-sign': 'Card Sharp. Look at the rival’s hand and choose a card; the rival discards it. Gain 1 money.',
  'at-the-window': 'Lamp in the Window. Look at every hidden tile. Then destroy one enemy trap, or deal 2 damage to an enemy unit.',
  'haunted-chamber': 'Locked Room. Choose a unit. Until your next turn, it cannot move or strike, and tricks played by its enemies cannot target it.',
  'heck-thomas': 'Manhunter. When Heck Thomas destroys a unit, draw 1.',
  'bill-tilghman': steady('Bill Tilghman'),
  'chris-madsen': tough('Chris Madsen'),
  'roy-bean': `Law West of the Pecos. When you deploy Judge Roy Bean, choose an enemy unit: it cannot move on its next turn. ${delay('Roy Bean')}`,
  'bill-mcdonald': tough('Capt. McDonald'),
  'isaac-parker': `Hanging Judge. When you deploy Judge Parker, destroy an enemy unit with 2 Power or less. ${delay('He')}`,
  'george-maledon': 'Hangman. Once each turn, when an enemy unit is destroyed, gain 1 money.',
  'seth-bullock': hold('Seth Bullock'),

  // ---------------- Department of the West
  crook: 'Pack Train. While Crook is on the board, your devices cost 1 less. Remount. Once each turn, Crook can let one of your other units that has already acted act again.',
  'five-wheel': `Empty Chamber. ${attach} The first time a strike would destroy that unit, it stays at 1 Power instead; then exile Five in the Wheel.`,
  'signal-glass': 'Heliograph. Choose a tile and look at it. Then deal 1 damage to an enemy unit standing lower than that tile.',
  'dead-volley': 'Volley Fire. Deal 2 damage to each enemy unit. Your units are not hit.',
  'empty-guidon': `${command('The Empty Guidon', 'it')} ${delay('It', 'it')}`,
  gatling: 'Crank It. Exhaust: deal 1 damage to each enemy unit.',
  bugle: 'Sound the Charge. Exhaust: one of your Army units that has already acted may act again.',
  'supply-wagon': 'Supply Run. Exhaust: gain 2 money, or only 1 if an enemy unit is next to your stronghold.',
  'picket-line': 'Picket. When an enemy unit moves next to the Picket Line, that unit loses 1 Power and cannot strike this turn.',
  'surgeon-kit': `Field Dressing. ${attach} The first time that unit takes damage and survives, it regains up to 2 lost Power; then exile Surgeon’s Roll.`,
  howitzer: 'Big Gun. Exhaust: deal 3 damage to an enemy unit.',
  'cut-wire': 'Cut the Wire. Place on an empty tile. While it is on the board, enemy tricks cost 1 more, and no unit can move onto that tile.',
  'empty-saddle': 'Riderless Horse. When another of your Army units (not your leader) is destroyed, you may exhaust Empty Saddle to return that unit to your hand.',
  sibley: 'Canvas Cover. Place on a tile. Enemy tricks cannot target your units on that tile.',
  ambulance: 'Litter Wagon. Exhaust: move one of your units up to two tiles. It cannot strike this turn.',
  'last-sentry': 'Lookout. Each turn, the first enemy unit to move next to the Last Sentry loses 2 Power.',
  flipper: 'Pack Train. While Flipper is on the board, your devices cost 1 less. Engineer. The first time each turn you play a device, draw 1.',
  'cave-in': `Cave-In. ${hidden('a collapse')} The first enemy unit to enter it is destroyed, and one enemy item or device next to it is exiled.`,
  custer: fast('Custer'),
  miles: tough('Nelson Miles'),
  cathay: tough('Cathay Williams', 'she'),
  benteen: tough('Benteen'),
  'damned-thing': 'Cryptid. Unseen. Enemy tricks and ranged strikes cannot target the Damned Thing, and units it strikes cannot strike back.',
  'owl-creek': 'Hanging Bridge. Destroy any unit with 2 Power or less. Its owner draws 1.',
  'comanche-horse': 'Survivor. The first time Comanche would take damage or lose Power, he takes none.',
  'emanuel-stance': fast('Sgt. Stance'),
  'al-sieber': 'Chief of Scouts. When you deploy Al Sieber, look at one hidden tile. Climber. If his first move in a turn is a climb, it does not spend his move.',
  'tom-custer': 'Two Medals. When Tom Custer destroys a unit, draw 1.',
  'ambrose-bierce': 'Surveyor. When you deploy Ambrose Bierce, look at one hidden tile. When he is destroyed, draw 1.',
  telegrapher: 'On the Wire. Once each turn, when you play a device, gain 1 money.',
  'mule-skinner': 'Supply. When you deploy the Mule Skinner, gain 1 money.',
  grierson: command('Grierson'),
  'gun-crew': `${ranged('The Gun Crew')} ${delay('It', 'it')}`,
  'lady-in-green': 'Cryptid. Winged. You may deploy the Lady in Green on any empty tile outside the rival’s half. Chill. When you deploy her, choose an enemy unit: it cannot move or strike on its next turn.',
  'buffalo-bill': `${ranged('Buffalo Bill')} Scout. When you deploy him, look at one hidden tile.`,

  // ---------------- High Grass Nation
  'sitting-bull': 'Vision. While Sitting Bull is on the board, at the start of your turn look at the hidden tile nearest your units, and the first of your units to move that turn may move one extra tile.',
  geronimo: 'High Ground. Geronimo deals 2 extra damage, not 1, when he strikes from higher ground. Break Away. The first time damage would destroy him, he survives at 1 Power and slips to a nearby empty tile.',
  joseph: 'Even Ground. While Chief Joseph is on the board, enemy ranged strikes cannot target your units.',
  quanah: 'Two Roads. Once each turn, return an item or device the rival owns to the rival’s hand.',
  parfleche: `Rawhide Case. ${attach} The first strike against that unit each turn deals 1 less damage.`,
  'painted-shield': `War Shield. ${attach} The first strike against that unit each turn deals 1 less damage.`,
  'ten-bears': 'Peace Talker. While Ten Bears is on the board, the first strike against each of your units each turn deals that unit no damage.',
  'winter-count': `Keeping Count. ${attach} At the start of your turn, draw 1.`,
  'pony-herd': 'Stampede. When you deploy the Pony Herd, you may move another of your units one tile.',
  'buffalo-skull': `Vengeance. ${attach} If a strike destroys that unit, the unit that struck it takes 2 damage.`,
  'trade-blanket': `Fair Trade. ${attach} That unit gains 1 Power while it carries the blanket. Pay 1 money: move Trade Blanket to another of your units.`,
  deadfall: `Deadfall. ${hidden('a deadfall')} The first enemy unit to enter it loses 2 Power and cannot strike this turn.`,
  sasquatch: `Cryptid. Tough. Whenever Sasquatch takes damage, it takes 1 less. Tall Tale. The first time it would take damage or lose Power, it takes none.`,
  thunderbird: 'Cryptid. Thunderclap. When you deploy the Thunderbird, deal 1 damage to each enemy unit.',
  piasa: 'Cryptid. Bounty. When the Piasa destroys a unit, gain 2 money. Looming. While it is on the board, each unit the rival deploys loses 1 Power.',
  gall: fast('Gall'),
  'rain-in-the-face': 'Last Shot. When Rain-in-the-Face is destroyed, he fires at an enemy unit next to him, dealing damage equal to his printed Power.',
  'moving-robe': `${fast('Moving Robe Woman', 'she')} Avenger. When she destroys a unit, draw 1.`,
  'two-moons': command('Two Moons'),
  lozen: 'Enemy-Sense. When you deploy Lozen, look at every hidden tile.',
  victorio: 'High Ground. Victorio deals 2 extra damage, not 1, when he strikes from higher ground.',
  satanta: 'Orator. When you deploy Satanta, gain 1 money and the rival loses 1 money.',
  'standing-bear': tough('Standing Bear'),
  'buffalo-calf-road': 'Rescue. When you deploy Buffalo Calf Road Woman, you may move another of your units one tile.',
  cochise: hold('Cochise'),
  'mustang-runner': `${fast('The Mustang Runner')} Open Range. He may move one extra tile each turn.`,
  'white-bull': 'Counts Coup. When White Bull destroys a unit, draw 1 and gain 1 money.',

  // ---------------- Thunder Lodge
  'red-cloud': 'Treaty Terms. While Red Cloud is on the board, the rival’s devices cost 1 more. Once each turn, you may exhaust Red Cloud to let one of your other units that has already acted act again.',
  'bone-whistle': 'Eagle-Bone Whistle. Exhaust: move one of your units one tile. It can still strike this turn.',
  'thunder-ridge': 'Rolling Thunder. Choose one of your units. It deals 2 damage to an enemy unit within two tiles that is not on higher ground than it, and that enemy cannot climb on its next turn.',
  'ridge-listener': 'Listener. When you deploy the Ridge Listener, look at one hidden tile. Climber. If his first move in a turn is a climb, it does not spend his move.',
  'river-mist': 'Hidden Crossing. Move one of your units up to two tiles. It cannot strike this turn.',
  'cold-ring': 'Snowbound. Choose a tile. Until your next turn, any unit on that tile cannot move.',
  'empty-lodge': `${harbor('The Empty Lodge', 'it')} Left Behind. When it is destroyed, gain 2 money.`,
  'shaft-viper': `Rattler. ${hidden('a viper')} The first enemy unit to enter it is destroyed.`,
  alkali: `Alkali Sink. ${hidden('a sink')} The first enemy unit to enter it loses 3 Power and cannot move on its next turn.`,
  'bear-lake': 'Cryptid. Hold. Enemy units next to the Bear Lake Monster cannot move, though they can still strike.',
  'crazy-horse': `${fast('Crazy Horse')} Hit and Run. After he strikes and survives, he may move one tile.`,
  'american-horse': harbor('American Horse'),
  'young-man-afraid': hold('Young Man Afraid'),
  'high-backbone': 'Decoy. The first time damage would destroy High Backbone, he survives at 1 Power and slips to a nearby empty tile.',
  'roman-nose': 'War Bonnet. The first time Roman Nose would take damage or lose Power, he takes none.',
  'black-elk': 'Healer. When you deploy Black Elk, one of your units regains up to 2 lost Power, and you look at one hidden tile.',
  'little-big-man': 'Strong Grip. When you deploy Little Big Man, choose an enemy unit: it cannot move or strike on its next turn.',
  'tall-bull': hold('Tall Bull'),
  'dog-soldier': hold('The Dog Soldier'),
  'dull-knife': 'The Way Home. At the start of your turn, gain 1 money.',
  'little-wolf': 'Long Walk. Little Wolf may move one extra tile each turn.',
  'weather-watcher': 'Weather Eye. When you deploy the Weather Watcher, look at one hidden tile. At the start of your turn, look at the hidden tile nearest your units.',
  'lodge-keeper': harbor('The Lodge Keeper'),
  'ridge-runner': `${fast('The Ridge Runner')} Climber. If his first move in a turn is a climb, it does not spend his move.`,
  'black-coal': 'Provider. When you deploy Black Coal, gain 1 money and draw 1.',
  'hail-caller': 'Hailstorm. When you deploy the Hail Caller, deal 1 damage to an enemy unit.',
};

/** Leader Lead powers (once a match). The UI prints "Lead · <label>. <text> Once a match." */
export const LEAD_TEXT = {
  jesse: 'Draw 1 and gain 2 money.',
  'faro-widow': 'Draw 1.',
  bass: 'Choose one of your units: it gains Tough, and the first time damage would destroy it, it stays at 1 Power instead. Draw 1.',
  crook: 'All of your units may act again this turn. Draw 1.',
  'sitting-bull': 'Look at every hidden tile on your half. One of your units that has already acted may act again.',
  'red-cloud': 'The rival loses 1 money. One of your units that has already acted may act again.',
};

export const LEAD_LABEL = {
  jesse: 'Rob the Bank',
  'faro-widow': 'House Cut',
  bass: 'Deputize',
  crook: 'Boots and Saddles',
  'sitting-bull': 'Rally the Camp',
  'red-cloud': 'Red Cloud’s War',
};
