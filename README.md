# PokéFilter

Find every **Pokémon Champions** Pokémon that matches your team's needs:
moves, ability, types, and minimum base stats. See [SPEC.md](SPEC.md) for scope.

## Run it locally

```bash
cd pokefilter
python3 -m http.server 8451
```

Then open <http://localhost:8451> in your browser.

(The page must be served over http — opening `index.html` directly with
`file://` blocks the data file from loading.)

## Data updates are automatic

A GitHub Action (`.github/workflows/update-data.yml`) runs **daily at 06:00 UTC**:

1. `node scripts/build-data.mjs` rebuilds `data/pokemon.json` from Pokémon
   Showdown. New regulations are **discovered automatically** from Showdown's
   format list, so when Reg M-D ships the app gains an "M-D" button, its new
   Pokémon, learnsets, and move changes — no code edits needed. The script only
   writes when something actually changed, so quiet days produce no commit.
2. On **Mondays** it also appends a usage snapshot (see below).

If Showdown ever restructures its files, the build refuses to write (it checks
the current regulation still has 100+ Pokémon) and the Action fails — GitHub
emails you, and the live site keeps its last good data.

Manual run, same as the Action:

```bash
node scripts/build-data.mjs
```

### How old regulations survive

Showdown keeps the current regulation in its `champions` mod, moves the previous
one to `championsregmX`, and eventually deletes it (M-A was deleted when M-C
launched). Those retired mods also only partly undo later changes. So
`data/regulations.json` records, for each retired regulation, the last Showdown
commit where it was still current, and the build always reads it from there —
old regulations show exactly what was legal while they were live.

## Usage stats

Ranked usage (from championsbattledata.com) is snapshotted **weekly** (Mondays)
into `data/usage/usage.json`, building a time series the app uses for
week-over-week trend arrows. Each snapshot is tagged with the regulation being
played, and no trend arrow is drawn across a regulation change. Manual runs:

```bash
node scripts/fetch-usage.mjs             # append a snapshot now
node scripts/fetch-usage.mjs --backfill  # rebuild from the API's daily history
```

### History before 2026-07-16

championsbattledata.com only retains ~31 days, so everything before its oldest
record comes from [Smogon's monthly Showdown stats](https://www.smogon.com/stats/)
instead, covering Champions back to its April 2026 release:

```bash
node scripts/fetch-history.mjs           # add the pre-in-game months (run once)
```

That is a **different player population** than the in-game ladder, so those
dates are tagged `source: "showdown"`, labelled in the UI, and excluded from
week-over-week trend arrows. Note `fetch-usage.mjs --backfill` rebuilds from
the in-game API alone — re-run `fetch-history.mjs` afterwards to restore the
historical months. The weekly Action preserves them automatically.

## Files

| File | What it is |
|---|---|
| `index.html` / `style.css` / `app.js` | The whole app — static, no build step |
| `data/pokemon.json` | Every Champions-legal Pokémon (all regulations) with stats, abilities, per-regulation legality and learnsets |
| `data/regulations.json` | Known regulations and the Showdown commit each was built from |
| `data/usage/usage.json` | Weekly usage time series |
| `scripts/build-data.mjs` | Regenerates `data/pokemon.json` from Showdown's GitHub data |
| `scripts/fetch-usage.mjs` / `fetch-history.mjs` | Usage snapshots / pre-July history |
| `.github/workflows/update-data.yml` | Daily data + Monday usage automation |
| `SPEC.md` | Scope, data decisions, and the explicit not-doing lists |
