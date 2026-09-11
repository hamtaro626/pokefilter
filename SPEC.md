# PokéFilter — SPEC (v0.6)

## v0.6 additions (2026-09-11)
- **Reg M-C** (launched 2026-09-09): 341 Pokémon, 31 new vs M-B — including
  Salamence/Mega Salamence, Mega Golisopod, Mega Baxcalibur, and the Mega-Z
  forms of Garchomp, Lucario, and Absol. None were removed. Cards for Pokémon
  not in the previous regulation get a **NEW** badge.
- **Regulations are discovered, not hardcoded.** `build-data.mjs` reads
  Showdown's `config/formats.ts` for `[Gen 9 Champions] VGC 20xx Reg X-Y`
  formats and the mod each uses; the regulation in the `champions` mod is
  current. The selector buttons are generated from `pokemon.json`.
- **Retired regulations are frozen at their last current commit.**
  `data/regulations.json` stores, per regulation, the Showdown commit it's
  built from: the latest one for the current regulation, and for a retired one
  the last commit where it was still current. Two reasons: Showdown deleted
  `championsregma` when M-C launched (breaking the v0.5 build), and its frozen
  `championsregmb` mod only partly reverts M-C's changes — it restores
  Archaludon's learnset but still inherits the Slash M-C added to 37 others, so
  building M-B from it would claim 44 Slash learners in a regulation where Slash
  didn't exist. M-A and M-B were seeded with `81c39fb` (the commit just before
  M-C). Trade-off: post-retirement Showdown fixes to an old regulation's data
  aren't picked up.
- **Per-regulation learnsets.** M-C changed existing learnsets (Slash added to
  37 species/forms; Archaludon lost Metal Burst and Mirror Coat; Politoed lost
  Pound), so a move filter now checks the selected regulation's learnset.
  `moves` holds the newest learnset; `movesByFormat` stores an older
  regulation's list only where it differs.
  Move *stats* (BP/accuracy) still come from the current regulation — the only
  per-regulation stat difference Showdown models today is PP.
- **Pinned to one Showdown commit per run**, and `pokedex.ts` now comes from
  that commit rather than the client's `pokedex.json` (which lagged a
  Mega Golisopod ability fix).
- **Daily automation.** `update-data.yml` (replaces `update-usage.yml`) runs
  the build daily and the usage snapshot on Mondays. The build only writes when
  data changed (ignoring timestamp/commit), and refuses to write if the current
  regulation has < 100 Pokémon, so a Showdown restructure fails loudly instead
  of publishing an empty app.
- **Usage snapshots carry `regulation` and `season`.** The API's ranked seasons
  (M4, M5, M6…) run about monthly and don't line up with regulations (M-B
  spanned M4-M5), so both are recorded. Trend arrows are suppressed (`↔`) across
  a regulation change, like they already were across sources.

### Not doing in v0.6
- Per-regulation move stats/PP, or item legality per regulation.
- Filtering usage by regulation — usage is always the live ladder, labelled.

---

# v0.5 spec

## v0.5 additions (2026-08-20)
- **Usage history back to release.** Champions launched 2026-04-08, but
  championsbattledata.com only keeps ~31 days (its oldest record is
  2026-07-16), so the earlier months are not obtainable from the in-game
  source at all — verified: `days` caps at 31, seasons M1-M3 404, older asset
  paths return the SPA shell, and the Wayback Machine holds one pre-July
  capture with no usage data in it.
- Those months are instead backfilled from **Smogon's monthly Showdown stats**
  (`scripts/fetch-history.mjs`), which cover the Champions ladder formats from
  April 2026 on. VGC maps to Doubles, BSS to Singles; the regulation with the
  most battles that month wins (Reg M-A through June).
- This is a **different player population**, so it is never silently mixed:
  every date carries a `sources[]` entry, historical rows are labelled
  "(Showdown)" on hover, the panel footer spells out the split, and a
  week-over-week arrow is **suppressed** (shown as `↔`) whenever the two points
  being compared come from different sources.
- Why it's trustworthy enough to include: the Showdown champions mod uses the
  same 0-32 stat point system, and on the one overlapping month (July 2026) its
  numbers track the in-game ones within a few points, with an identical top
  spread. Cutoff 0 (all ladder players) matched the in-game population best.
- Mega forms are merged into their base species by summing weighted counts,
  **except abilities** — a Mega's ability only applies post-Mega-evolution and
  the in-game source reports the pre-Mega ability instead.

---

# v0.4 spec

## v0.4 additions (2026-08-19)
- **Branding**: Alec's logo is now the site icon. `assets/icon-*.png` (16/32/48/
  180/192/512) are a square "Poké" crop — the full wordmark is illegible below
  ~64px, the crop stays readable at 16px — plus `site.webmanifest` so
  Add-to-Home-Screen works. The full wordmark is the page header.
  Source art kept at `assets/logo-original.png`.
- **Stat point spread usage**: the usage tab now has **Natures** (with their
  +/− stat, e.g. Jolly +Spe −SpA) and **Stat point spreads**, rendered the way
  players read them ("32 Atk / 32 Spe / 2 HP"), maxed stats highlighted.
  Champions gives **66 stat points, 32 max per stat** (confirmed empirically:
  2849/3073 observed spreads sum to exactly 66) — these are not 252-EV spreads.
- **Comma = OR in name search**: "garchomp, dragonite" matches either.

---

# v0.3 spec

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
