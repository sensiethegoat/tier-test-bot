// Canonical order, best → worst. MVT only uses the HT/LT system.
// This keeps tier comparison consistent while removing the MT tiers entirely.
export const ALL_TIERS = [
  'HT1', 'LT1',
  'HT2', 'LT2',
  'HT3', 'LT3',
  'HT4', 'LT4',
  'HT5', 'LT5',
];

/** 10 = MCTiers style (HT/LT). 15 is kept as a compatibility alias for older configs, but without MT tiers. */
export const TIER_SETS = {
  10: ALL_TIERS,
  15: ALL_TIERS,
};

export const MVT_CATEGORIES = [
  {
    name: 'Vanilla',
    kits: [
      'Diamond Sword',
      'Netherite Sword',
      'Diamond Potion',
      'Netherite Potion',
      'Axe',
      'No Axe',
      'UHC',
      'Shieldless UHC',
      'ElytraMace',
      'SpearMace',
      'ElytraSpear',
      'Diamond SMP',
      'Netherite SMP',
      'Mace SMP',
      'Crystal PvP',
    ],
  },
  {
    name: 'Modded KB',
    kits: [
      'BedFight',
      'Boxing',
      'Bridge',
      'Build UHC',
      'FireballFight',
      'MidFight',
      'NoDebuff',
      'SkyWars',
      'Sumo',
      'Survival Games',
      'Battlerush',
    ],
  },
  {
    name: 'MCBE-J',
    kits: [
      'Sword',
      'Axe',
      'UHC',
      'Mace',
      'SMP',
      'Pot',
      'Netherite OP',
      'Crystal PvP',
      'Diamond SMP',
      'SpearMace',
      'Cart',
      'Shieldless UHC',
    ],
  },
];

export const MVT_GAMEMODE_NAMES = MVT_CATEGORIES.flatMap(({ name, kits }) =>
  kits.map((kit) => `${name} - ${kit}`),
);

export function isMvtGamemode(gamemode) {
  return MVT_GAMEMODE_NAMES.some((name) => name.toLowerCase() === String(gamemode).toLowerCase());
}

/** 10 = MCTiers style (HT/LT), 15 = compatibility alias without MT tiers. */
const POINTS = {
  10: { HT1: 60, LT1: 45, HT2: 30, LT2: 20, HT3: 10, LT3: 6, HT4: 4, LT4: 3, HT5: 2, LT5: 1 },
  15: { HT1: 60, LT1: 45, HT2: 30, LT2: 20, HT3: 10, LT3: 6, HT4: 4, LT4: 3, HT5: 2, LT5: 1 },
};

const OVERALL = {
  10: [
    ['HT1', 60], ['LT1', 45],
    ['HT2', 30], ['LT2', 20],
    ['HT3', 10], ['LT3', 6],
    ['HT4', 4], ['LT4', 3],
    ['HT5', 2], ['LT5', 1],
  ],
  15: [
    ['HT1', 60], ['LT1', 45],
    ['HT2', 30], ['LT2', 20],
    ['HT3', 10], ['LT3', 6],
    ['HT4', 4], ['LT4', 3],
    ['HT5', 2], ['LT5', 1],
  ],
};

export const TITLES = [
  [400, 'Combat Grandmaster'],
  [250, 'Combat Master'],
  [100, 'Combat Ace'],
  [50, 'Combat Specialist'],
  [20, 'Combat Cadet'],
  [10, 'Combat Novice'],
  [0, 'Rookie'],
];

export const REGIONS = {
  NA: 'North America',
  EU: 'Europe',
  AS: 'Asia',
  OC: 'Oceania',
  SA: 'South America',
  ME: 'Middle East',
};

// Which Minecraft accounts a server accepts. Cracked = offline-mode, not checked against Mojang.
export const ACCOUNT_MODES = {
  premium: 'Premium only',
  cracked: 'Cracked only',
  both: 'Premium and cracked',
};

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

// Gamemode names end up inside button custom IDs, so keep them to a safe charset.
export const GAMEMODE_RE = /^[A-Za-z0-9 ]{1,24}$/;

export const DAY = 86_400_000;
export const TICKET_DELETE_DELAY = 10_000;

export const tierIndex = (tier) => ALL_TIERS.indexOf(tier);

export function bestTier(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return tierIndex(a) <= tierIndex(b) ? a : b;
}

const setOf = (cfg) => (cfg?.tier_set === 15 ? 15 : 10);

/** The tiers a server uses, best → worst. */
export const tiersOf = (cfg) => TIER_SETS[setOf(cfg)];

/** Points one gamemode is worth at this tier, on this server's scale. */
export const pointsFor = (cfg, tier) => POINTS[setOf(cfg)][tier] ?? POINTS[15][tier] ?? 0;

/** The overall tier badge for a points total. */
export const overallTier = (cfg, points) => {
  const list = OVERALL[setOf(cfg)];
  return list.find(([, min]) => points >= min)?.[0] ?? 'LT5';
};

export const titleFor = (points) => TITLES.find(([min]) => points >= min)?.[1] ?? 'Rookie';
