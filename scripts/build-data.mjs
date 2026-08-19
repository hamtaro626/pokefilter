// build-data.mjs — fetches Pokémon Champions data and writes data/pokemon.json
//
// Sources (all public):
//   - Showdown champions mod: learnsets.ts (Champions move pools)
//   - Showdown champions mod: formats-data.ts (which Pokémon are legal + tier)
//   - Showdown pokedex.json  (stats, types, abilities, display names)
//   - Showdown moves.json    (move id -> display name)
//
// Usage: node scripts/build-data.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAW = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master";
const PLAY = "https://play.pokemonshowdown.com/data";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// Showdown's .ts data files are just `export const X: SomeType = { ... };`
// Strip the wrapper and evaluate the object literal.
function parseTsObject(tsSource) {
  const start = tsSource.indexOf("= {");
  const end = tsSource.lastIndexOf("};");
  const objText = tsSource.slice(start + 2, end + 1);
  return new Function(`return (${objText});`)();
}

console.log("Fetching data from Pokémon Showdown...");
const [learnsetsTs, formatsTs, pokedexJson, movesJson] = await Promise.all([
  fetchText(`${RAW}/data/mods/champions/learnsets.ts`),
  fetchText(`${RAW}/data/mods/champions/formats-data.ts`),
  fetchText(`${PLAY}/pokedex.json`),
  fetchText(`${PLAY}/moves.json`),
]);

const learnsets = parseTsObject(learnsetsTs); // { speciesId: { learnset: { moveId: [...] } } }
const formatsData = parseTsObject(formatsTs); // { speciesId: { tier, isNonstandard? } }
const pokedex = JSON.parse(pokedexJson);      // { speciesId: { name, types, baseStats, abilities, ... } }
const movesDex = JSON.parse(movesJson);       // { moveId: { name, ... } }

// A species is in Champions if formats-data gives it a real tier.
const legal = Object.entries(formatsData).filter(
  ([, info]) => info.tier && info.tier !== "Illegal"
);
console.log(`Champions-legal entries in formats-data: ${legal.length}`);

const out = [];
const moveIdsUsed = new Set();

for (const [id, info] of legal) {
  const dex = pokedex[id];
  if (!dex) {
    console.warn(`  ! no pokedex entry for ${id}, skipping`);
    continue;
  }

  // Mega/alt forms have no learnset of their own — inherit from base species.
  const baseId = dex.baseSpecies
    ? dex.baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, "")
    : id;
  // Fallback chain: exact id -> base species -> a form of the base species
  // (e.g. floettemega's learnset is keyed as floetteeternal).
  const formKey = Object.keys(learnsets).find((k) => k.startsWith(baseId));
  const learnset =
    learnsets[id]?.learnset ??
    learnsets[baseId]?.learnset ??
    (formKey ? learnsets[formKey].learnset : undefined);
  if (!learnset) {
    console.warn(`  ! no learnset for ${id} (base ${baseId}), skipping`);
    continue;
  }

  const moves = Object.keys(learnset).sort();
  moves.forEach((m) => moveIdsUsed.add(m));

  // Showdown sprite filename: baseid + "-" + formeid (e.g. "charizard-megax")
  const toId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sprite = dex.forme
    ? `${toId(dex.baseSpecies)}-${toId(dex.forme)}`
    : toId(dex.name);

  out.push({
    id,
    name: dex.name,                       // e.g. "Garchomp-Mega"
    sprite,
    num: dex.num,                         // national dex number, for sprites
    types: dex.types,                     // ["Dragon", "Ground"]
    abilities: Object.values(dex.abilities), // ["Sand Veil", "Rough Skin"]
    stats: dex.baseStats,                 // { hp, atk, def, spa, spd, spe }
    bst: Object.values(dex.baseStats).reduce((a, b) => a + b, 0),
    tier: info.tier,
    moves,                                // move ids, e.g. "rockslide"
  });
}

// Move id -> display name table (only for moves that actually appear).
const moveNames = {};
for (const m of moveIdsUsed) {
  moveNames[m] = movesDex[m]?.name ?? m;
}

out.sort((a, b) => b.bst - a.bst);

const dataset = {
  generatedAt: new Date().toISOString(),
  source: "smogon/pokemon-showdown champions mod",
  pokemon: out,
  moveNames,
};

mkdirSync(join(projectRoot, "data"), { recursive: true });
const outPath = join(projectRoot, "data", "pokemon.json");
writeFileSync(outPath, JSON.stringify(dataset));

console.log(`Wrote ${out.length} Pokémon, ${moveIdsUsed.size} distinct moves`);
console.log(`-> ${outPath}`);
