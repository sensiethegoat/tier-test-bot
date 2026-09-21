// Best → worst. Index 0 is the highest tier.
export const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];

// MCTiers-style points, counted from each gamemode's peak tier.
export const POINTS = { HT1: 60, LT1: 45, HT2: 30, LT2: 20, HT3: 10, LT3: 6, HT4: 4, LT4: 3, HT5: 2, LT5: 1 };

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
  EU: 'Europe',
  NA: 'North America',
  AS: 'Asia',
  AU: 'Oceania',
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

export const tierIndex = (tier) => TIERS.indexOf(tier);

export function bestTier(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return tierIndex(a) <= tierIndex(b) ? a : b;
}

export const titleFor = (points) => TITLES.find(([min]) => points >= min)[1];
