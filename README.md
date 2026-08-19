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

## Refresh the data

Data comes from Pokémon Showdown's `champions` mod. When a new Champions
season adds Pokémon or moves:

```bash
node scripts/build-data.mjs
```

This rewrites `data/pokemon.json`. Nothing else needs to change.

## Files

| File | What it is |
|---|---|
| `index.html` / `style.css` / `app.js` | The whole app — static, no build step |
| `data/pokemon.json` | 310 Champions-legal Pokémon with stats, abilities, learnsets |
| `scripts/build-data.mjs` | Regenerates `data/pokemon.json` from Showdown's GitHub data |
| `SPEC.md` | v0.1 scope, data decisions, and the explicit not-doing list |
