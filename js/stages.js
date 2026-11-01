// Miniaturas de los stages (img/stages/*.jpg, incluidas en la app para que funcionen offline).

const STAGE_IMG = {
  'Battlefield': 'battlefield',
  'Hollow Bastion': 'hollow-bastion',
  'Small Battlefield': 'small-battlefield',
  'Town & City': 'town-and-city',
  'Pokémon Stadium 2': 'pokemon-stadium-2',
  'Smashville': 'smashville',
  'Final Destination': 'final-destination',
  'Kalos': 'kalos',
};

const OTHER = `<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#323748"/>
  <text x="80" y="60" text-anchor="middle" font-size="38" font-weight="800" fill="#9aa1b3" font-family="system-ui, sans-serif">?</text></svg>`;

export function stageArt(name) {
  const file = STAGE_IMG[name];
  return file ? `<img src="img/stages/${file}.jpg" alt="" width="480" height="270" decoding="async">` : OTHER;
}
