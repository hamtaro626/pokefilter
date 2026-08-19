# PokéFilter — SPEC (v0.1)

## What it is
A web app for Pokémon Champions competitive players. You describe what you want
(moves, ability, types, minimum base stats) and it instantly lists every
Champions-legal Pokémon that fits.

Example query: "Ground type, can learn Icy Wind AND Protect, base Speed ≥ 100."

## Who it's for
Competitive players building teams for Pokémon Champions (Switch/mobile, 2026).

## v0.1 features
- **Type filter**: pick 1–2 types; results must have all picked types.
- **Move filter**: pick any number of moves (search-as-you-type); results must
  be able to learn ALL of them in Champions.
- **Ability filter**: pick one ability; results must have it as a possible ability.
- **Stat filters**: minimum value per base stat (HP / Atk / Def / SpA / SpD / Spe)
  plus minimum base stat total.
- **Results**: sprite, name, types, abilities, base stats, Smogon tier, with a
  live match count. Sorted by base stat total (highest first) by default.
- Works entirely in the browser — no server, no login, loads one local JSON file.

## Data
- **Roster + learnsets**: Pokémon Showdown's `champions` mod
  (`data/mods/champions/learnsets.ts` and `formats-data.ts` on GitHub).
  A Pokémon is included if its tier is not `Illegal`. This is
  Champions-specific data — move pools differ from Scarlet/Violet.
- **Stats / types / abilities / names**: Showdown's `pokedex.json` and `moves.json`.
- **Sprites**: hotlinked from Pokémon Showdown's sprite server.
- **Mega Evolutions**: included as their own entries (own stats/types/abilities);
  learnset inherited from the base species.
- Stats shown are classic **base stats** (Garchomp Speed = 102), not the
  level-50 values the Champions UI displays.
- `scripts/build-data.mjs` fetches all of the above and writes
  `data/pokemon.json`. Re-run it whenever a new Champions season drops.

## Architecture
Static site: `index.html` + `style.css` + `app.js` + `data/pokemon.json`.
No framework, no build step, no dependencies. All filtering happens client-side.
Deployable to GitHub Pages / Netlify as-is.

## Explicitly NOT doing in v0.1
- Usage stats / "most common moveset" (championsbattledata.com API — good v0.2)
- Per-format legality (VGC Reg M-A vs M-B vs BSS) — we only show the tier label
- Other generations / games — Champions only (gen selector is the long-term goal)
- Damage calculator, speed tiers at level 50, natures, EVs, items
- Team builder / saving teams
- Accounts, sharing links, mobile app
- Auto-updating data (manual script re-run is fine for v0.1)

## Definition of done (v0.1)
Open the page, enter "Speed ≥ 100 + Earthquake + Rock Slide", and get a correct
list including Garchomp — instantly, offline-capable, deployed at a public URL.
