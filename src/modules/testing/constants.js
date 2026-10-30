// Canonical order, best → worst. Servers using the 10-tier set simply never use the MT tiers,
// so this one list orders and compares tiers for every server.
export const ALL_TIERS = [
  'HT1', 'MT1', 'LT1',
  'HT2', 'MT2', 'LT2',
  'HT3', 'MT3', 'LT3',
  'HT4', 'MT4', 'LT4',
  'HT5', 'MT5', 'LT5',
];

/** 10 = MCTiers style (HT/LT), 15 = MCPVP style (HT/MT/LT). Chosen per server. */
export const TIER_SETS = {
  10: ALL_TIERS.filter((t) => !t.startsWith('MT')),
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

/** 10 = MCTiers style (HT/LT), 15 = MCPVP style (HT/MT/LT). Chosen per server. */
// Points a gamemode contributes, counted from its peak tier. The 10-tier numbers are MCTiers';
// the 15-tier scale keeps the same shape with the mid tiers in between.
const POINTS = {
  10: { HT1: 60, LT1: 45, HT2: 30, LT2: 20, HT3: 10, LT3: 6, HT4: 4, LT4: 3, HT5: 2, LT5: 1 },
  15: {
    HT1: 60, MT1: 52, LT1: 45,
    HT2: 30, MT2: 25, LT2: 20,
    HT3: 12, MT3: 9, LT3: 8,
    HT4: 6, MT4: 5, LT4: 4,
    HT5: 3, MT5: 2, LT5: 1,
  },
};

// Total points → overall tier badge, like MCPVP's "LT1 · 330 Points".
const OVERALL = {
  15: [
    ['HT1', 400], ['MT1', 350], ['LT1', 300],
    ['HT2', 250], ['MT2', 200], ['LT2', 150],
    ['HT3', 125], ['MT3', 100], ['LT3', 75],
    ['HT4', 50], ['MT4', 30], ['LT4', 15],
    ['HT5', 5], ['MT5', 1], ['LT5', 0],
  ],
};
OVERALL[10] = OVERALL[15].filter(([tier]) => !tier.startsWith('MT'));

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
export const overallTier = (cfg, points) => OVERALL[setOf(cfg)].find(([, min]) => points >= min)[0];

export const titleFor = (points) => TITLES.find(([min]) => points >= min)[1];
