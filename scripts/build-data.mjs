// build-data.mjs — fetches Pokémon Champions data and writes data/pokemon.json
//
// Sources (all public):
//   - Showdown champions mod: learnsets.ts   (Champions move pools)
//   - Showdown champions mod: formats-data.ts (Reg M-B legality + tier)
//   - Showdown championsregma mod: formats-data.ts (Reg M-A legality + tier)
//   - Showdown champions mod: moves.ts       (Champions-modified move stats)
//   - Showdown pokedex.json / moves.json     (stats, types, abilities, move data)
//   - Showdown data/text/moves.ts, abilities.ts (descriptions)
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
const [
  learnsetsTs, formatsTs, formatsRegmaTs, movesModTs,
  pokedexJson, movesJson, movesTextTs, abilitiesTextTs,
] = await Promise.all([
  fetchText(`${RAW}/data/mods/champions/learnsets.ts`),
  fetchText(`${RAW}/data/mods/champions/formats-data.ts`),
  fetchText(`${RAW}/data/mods/championsregma/formats-data.ts`),
  fetchText(`${RAW}/data/mods/champions/moves.ts`),
  fetchText(`${PLAY}/pokedex.json`),
  fetchText(`${PLAY}/moves.json`),
  fetchText(`${RAW}/data/text/moves.ts`),
  fetchText(`${RAW}/data/text/abilities.ts`),
]);

const learnsets = parseTsObject(learnsetsTs);
const formatsData = parseTsObject(formatsTs);       // Reg M-B (current)
const formatsRegma = parseTsObject(formatsRegmaTs); // Reg M-A
// champions/moves.ts contains TS battle code, so it can't be eval'd.
// Line-parse just the simple stat overrides (basePower: 90, accuracy: 100, …).
function parseMoveOverrides(tsSource) {
  const overrides = {};
  let current = null;
  for (const line of tsSource.split("\n")) {
    const open = line.match(/^\t([a-z0-9]+): \{$/);
    if (open) { current = open[1]; overrides[current] = {}; continue; }
    if (/^\t\},?$/.test(line)) { current = null; continue; }
    if (!current) continue;
    const field = line.match(/^\t\t(basePower|accuracy|pp|priority): (\d+|true),?$/) ||
                  line.match(/^\t\t(category|type): "([^"]+)",?$/);
    if (field) {
      const [, key, raw] = field;
      overrides[current][key] = /^\d+$/.test(raw) ? Number(raw) : raw === "true" ? true : raw;
    }
  }
  return overrides;
}
const movesMod = parseMoveOverrides(movesModTs);    // Champions move overrides
const pokedex = JSON.parse(pokedexJson);
const movesDex = JSON.parse(movesJson);
const movesText = parseTsObject(movesTextTs);
const abilitiesText = parseTsObject(abilitiesTextTs);

const isLegal = (info) => Boolean(info?.tier && info.tier !== "Illegal");

// A species is in the dataset if it's legal in either regulation.
const allIds = new Set([...Object.keys(formatsData), ...Object.keys(formatsRegma)]);
const legal = [...allIds].filter((id) => isLegal(formatsData[id]) || isLegal(formatsRegma[id]));
console.log(`Legal in M-B or M-A: ${legal.length}`);

const toId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const out = [];
const moveIdsUsed = new Set();
const abilityNamesUsed = new Set();

for (const id of legal) {
  const dex = pokedex[id];
  if (!dex) {
    console.warn(`  ! no pokedex entry for ${id}, skipping`);
    continue;
  }

  // Mega/alt forms have no learnset of their own — inherit from base species.
  const baseId = dex.baseSpecies ? toId(dex.baseSpecies) : id;
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

  const abilities = Object.values(dex.abilities);
  abilities.forEach((a) => abilityNamesUsed.add(a));

  // Showdown sprite filename: baseid + "-" + formeid (e.g. "charizard-megax")
  const sprite = dex.forme ? `${toId(dex.baseSpecies)}-${toId(dex.forme)}` : toId(dex.name);

  out.push({
    id,
    baseId,                               // for the usage-stats API (keyed by base species)
    name: dex.name,                       // e.g. "Garchomp-Mega"
    sprite,
    num: dex.num,
    types: dex.types,
    abilities,
    stats: dex.baseStats,                 // { hp, atk, def, spa, spd, spe }
    bst: Object.values(dex.baseStats).reduce((a, b) => a + b, 0),
    formats: {
      // tier string when legal in that regulation, null otherwise
      regmb: isLegal(formatsData[id]) ? formatsData[id].tier : null,
      regma: isLegal(formatsRegma[id]) ? formatsRegma[id].tier : null,
    },
    moves,
  });
}

// ---- move details: base data + Champions overrides + description ----
const OVERRIDE_FIELDS = ["basePower", "accuracy", "pp", "category", "type", "priority"];
const moveInfo = {};
for (const m of moveIdsUsed) {
  const base = movesDex[m] ?? {};
  const mod = movesMod[m] ?? {};
  const info = {
    name: base.name ?? m,
    type: base.type ?? "?",
    category: base.category ?? "?",       // Physical | Special | Status
    basePower: base.basePower ?? 0,
    accuracy: base.accuracy ?? true,      // true = never misses
    pp: base.pp ?? 0,
    desc: movesText[m]?.shortDesc ?? "",
  };
  for (const f of OVERRIDE_FIELDS) {
    if (mod[f] !== undefined) info[f === "basePower" ? "basePower" : f] = mod[f];
  }
  moveInfo[m] = info;
}

// ---- ability descriptions ----
const abilityInfo = {};
for (const name of abilityNamesUsed) {
  abilityInfo[name] = abilitiesText[toId(name)]?.shortDesc ?? "";
}

out.sort((a, b) => b.bst - a.bst);

const dataset = {
  generatedAt: new Date().toISOString(),
  source: "smogon/pokemon-showdown champions + championsregma mods",
  pokemon: out,
  moveInfo,
  abilityInfo,
};

mkdirSync(join(projectRoot, "data"), { recursive: true });
const outPath = join(projectRoot, "data", "pokemon.json");
writeFileSync(outPath, JSON.stringify(dataset));

const mbCount = out.filter((p) => p.formats.regmb).length;
const maCount = out.filter((p) => p.formats.regma).length;
console.log(`Wrote ${out.length} Pokémon (Reg M-B: ${mbCount}, Reg M-A: ${maCount}), ${moveIdsUsed.size} moves`);
const missingDesc = Object.values(moveInfo).filter((m) => !m.desc).length;
console.log(`Moves missing descriptions: ${missingDesc}`);
console.log(`-> ${outPath}`);
