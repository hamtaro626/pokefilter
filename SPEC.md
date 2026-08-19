# PokéFilter — SPEC (v0.3)

## v0.3 additions (2026-08-19)
- **Detail panel tabs**: click a card for Usage (as before) or **All moves** —
  the full Champions learnset with type/category/BP/accuracy, plus abilities
  with descriptions.
- **Weekly usage snapshots**: usage data now lives in `data/usage/usage.json`,
  refreshed by a GitHub Action every Monday 06:00 UTC (`.github/workflows/
  update-usage.yml`) — the app no longer polls championsbattledata.com live.
  Backfilled ~5 weekly points from the API's daily history; each usage row
  shows the latest % plus a ▲/▼ week-over-week trend (full history on hover).
  `node scripts/fetch-usage.mjs` runs a snapshot manually; `--backfill` rebuilds.
- **Type exclusion (NOT)**: type chips cycle include → exclude → off
  (e.g. Trick Room learners that are NOT Psychic).
- **Sort direction** toggle (↓/↑).
- **Mega filter**: All / No Megas / Megas only.
- **Name search**: substring filter on Pokémon name.

---

# v0.2 spec

## v0.2 additions (2026-08-19)
- **Regulation selector**: Reg M-B (current, 310 Pokémon) / Reg M-A (272).
  Legality from Showdown's `championsregma` mod; tiers shown per regulation.
- **Move/ability details**: pickers open on focus with the full scrollable
  list; move rows show type, Physical/Special/Status, BP, and accuracy;
  descriptions on hover (Showdown text data, with Champions-modified base
  powers merged in — e.g. Apple Acid is 90 BP in Champions, not 80).
- **Category filter**: Physical/Special/Status chips narrow the move picker.
- **IV toggle**: switch between base stats and Lv. 50 stats (31 IVs, neutral
  nature — the numbers the Champions UI shows). Stat filters follow the toggle.
- **Usage stats**: click any card for live ranked usage (moves, abilities,
  held items with %) from the championsbattledata.com API, Doubles/Singles tabs.
  Caveat: that API only retains the current season, so Reg M-A historical
  usage is not available anywhere — usage is always current-season.

---

# Original v0.1 spec

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
