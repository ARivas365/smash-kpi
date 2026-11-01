// Datos fijos: roster, stages, tipos de partida y definición de KPIs.

// [nombre, alias para el buscador]
export const ROSTER = [
  ['Mario'], ['Donkey Kong', 'DK'], ['Link'], ['Samus'], ['Dark Samus', 'Samus Oscura'],
  ['Yoshi'], ['Kirby'], ['Fox'], ['Pikachu'], ['Luigi'], ['Ness'],
  ['Captain Falcon', 'Falcon'], ['Jigglypuff', 'Puff'], ['Peach'], ['Daisy'], ['Bowser'],
  ['Ice Climbers', 'ICs Escaladores'], ['Sheik'], ['Zelda'], ['Dr. Mario', 'Doc'], ['Pichu'],
  ['Falco'], ['Marth'], ['Lucina'], ['Young Link', 'YL Link Niño'], ['Ganondorf', 'Ganon'],
  ['Mewtwo'], ['Roy'], ['Chrom'], ['Mr. Game & Watch', 'GnW Sr. Game'], ['Meta Knight', 'MK'],
  ['Pit'], ['Dark Pit', 'Pit Sombrío'], ['Zero Suit Samus', 'ZSS Samus Zero'], ['Wario'],
  ['Snake'], ['Ike'], ['Pokémon Trainer', 'PT Entrenador'], ['Diddy Kong', 'Diddy'],
  ['Lucas'], ['Sonic'], ['King Dedede', 'Rey Dedede DDD'], ['Olimar', 'Alph'], ['Lucario'],
  ['R.O.B.', 'ROB'], ['Toon Link', 'TL'], ['Wolf'], ['Villager', 'Aldeano'], ['Mega Man'],
  ['Wii Fit Trainer', 'Entrenadora WFT'], ['Rosalina & Luma', 'Estela Destello Rosa'],
  ['Little Mac', 'Mac'], ['Greninja'], ['Mii Brawler', 'Luchador Mii'],
  ['Mii Swordfighter', 'Espadachín Mii'], ['Mii Gunner', 'Tirador Mii'], ['Palutena', 'Palu'],
  ['Pac-Man'], ['Robin'], ['Shulk'], ['Bowser Jr.', 'Bowsy'], ['Duck Hunt'], ['Ryu'],
  ['Ken'], ['Cloud'], ['Corrin'], ['Bayonetta', 'Bayo'], ['Inkling'], ['Ridley'],
  ['Simon'], ['Richter'], ['King K. Rool', 'KKR'], ['Isabelle', 'Canela'], ['Incineroar', 'Incin'],
  ['Piranha Plant', 'Planta Piraña'], ['Joker'], ['Hero', 'Héroe'], ['Banjo & Kazooie', 'Banjo'],
  ['Terry'], ['Byleth'], ['Min Min'], ['Steve', 'Alex Zombie Enderman'], ['Sephiroth', 'Sephi'],
  ['Pyra/Mythra', 'Aegis Pyra Mythra'], ['Kazuya'], ['Sora'],
];

export const STAGE_GROUPS = [
  ['Starters', ['Battlefield', 'Hollow Bastion', 'Small Battlefield', 'Town & City', 'Pokémon Stadium 2']],
  ['Counterpicks', ['Smashville', 'Final Destination', 'Kalos', 'Otro']],
];
export const STARTERS = STAGE_GROUPS[0][1];
export const LEGAL = [...STARTERS, ...STAGE_GROUPS[1][1].filter(s => s !== 'Otro')];

export const TYPES = [
  ['torneo', 'Torneo'],
  ['casual', 'Casual'],
  ['practica', 'Práctica'],
];
export const TYPE_LABEL = Object.fromEntries(TYPES);

// fmt: pct (0-1 → %), signed (+0.50), ratio (1.25), perc (% de daño)
// better: si un valor más alto es mejor ('high') o peor ('low')
export const KPIS = {
  winGames:     { label: '% victoria (games)',        short: 'Win',      fmt: 'pct',    better: 'high' },
  winSets:      { label: '% victoria (sets)',         short: 'Sets',     fmt: 'pct',    better: 'high' },
  stockDiff:    { label: 'Diferencial de stocks',     short: 'Stocks ±', fmt: 'signed', better: 'high' },
  openingRatio: { label: 'Opening ratio',             short: 'Openings', fmt: 'ratio',  better: 'high' },
  openingsPerKill: { label: 'Openings por kill',      short: 'Op/kill',  fmt: 'ratio',  better: 'low'  },
  earlyDeaths:  { label: 'Muertes tempranas (<80%)',  short: 'Muero <80', fmt: 'pct',   better: 'low'  },
  killPct:      { label: '% promedio al que mato',    short: 'Mato a',   fmt: 'perc',   better: 'low'  },
  deathPct:     { label: '% promedio al que muero',   short: 'Muero a',  fmt: 'perc',   better: 'high' },
  recoveryRate: { label: 'Muertes por recovery',      short: 'Recovery', fmt: 'pct',    better: 'low'  },
  limitConv:    { label: 'Conversión de Limit',       short: 'Limit',    fmt: 'pct',    better: 'high' },
};

// Formato preparado para el futuro mod de PC que cuenta ataques por partida.
export const ATTACK_EXAMPLE = {
  format: 'smash-kpi-attacks',
  version: 1,
  source: 'mod-pc',
  matches: [
    {
      gameId: null,
      startedAt: '2026-11-01T21:10:00-03:00',
      endedAt: '2026-11-01T21:14:30-03:00',
      myChar: 'Cloud',
      oppChar: 'Pikachu',
      stage: 'Battlefield',
      attacks: {
        me:  { jab: 6, ftilt: 3, utilt: 4, dtilt: 5, dash_attack: 2, fsmash: 1, usmash: 1, dsmash: 2, nair: 9, fair: 7, bair: 5, uair: 6, dair: 1, grab: 4, neutral_b: 3, side_b: 2, up_b: 2, down_b: 3 },
        opp: { jab: 4, ftilt: 2, nair: 8, fair: 5, bair: 3, uair: 4, grab: 6, neutral_b: 10, side_b: 4, up_b: 3, down_b: 1 },
      },
    },
  ],
};
