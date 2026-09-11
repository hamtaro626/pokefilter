// build-data.mjs — fetches Pokémon Champions data and writes data/pokemon.json
//
// Regulations are discovered, not hardcoded. Showdown's config/formats.ts lists
// each "[Gen 9 Champions] VGC 20xx Reg M-X" format together with the mod that
// holds its data: the current regulation lives in `champions`, older ones move
// to `championsregmX`, and eventually get deleted (M-A's was, when M-C launched).
// data/regulations.json records the last Showdown commit where each regulation
// was current, and a retired regulation is always built from that commit.
//
// Sources (all public, pinned to one Showdown commit per regulation):
//   - config/formats.ts                        which regulations exist + their mods
//   - mods/<mod>/formats-data.ts               legality + tier per regulation
//   - mods/<mod>/learnsets.ts (+ parent mods)  Champions move pools per regulation
//   - mods/champions/moves.ts                  Champions-modified move stats
//   - data/pokedex.ts                          stats, types, abilities
//   - play.pokemonshowdown.com moves.json      base move data
//   - mods/champions/items.ts + client items.js which items are available
//   - data/text/moves.ts, abilities.ts, items.ts  descriptions
//
// Usage: node scripts/build-data.mjs   (writes only when the data actually changed)
// Runs daily from .github/workflows/update-data.yml.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "smogon/pokemon-showdown";
const PLAY = "https://play.pokemonshowdown.com/data";
const CURRENT_MOD = "champions";
// Refuse to write if the current regulation looks broken (Showdown restructured
// its files, a parse went wrong…) rather than publishing an empty app.
const MIN_CURRENT_ROSTER = 100;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(projectRoot, "data", "pokemon.json");
const manifestPath = join(projectRoot, "data", "regulations.json");

async function fetchText(url, { optional = false } = {}) {
  const res = await fetch(url);
  if (optional && res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

const raw = (ref, path, opts) =>
  fetchText(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`, opts);

// Pin every file to one commit so a run never mixes two versions of Showdown.
async function latestCommit() {
  const headers = { Accept: "application/vnd.github.sha" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/master`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} resolving Showdown's latest commit`);
  return (await res.text()).trim();
}

// Showdown's .ts data files are just `export const X: SomeType = { ... };`
// Strip the wrapper and evaluate the object literal.
function parseTsObject(tsSource) {
  const start = tsSource.indexOf("= {");
  const end = tsSource.lastIndexOf("};");
  const objText = tsSource.slice(start + 2, end + 1);
  return new Function(`return (${objText});`)();
}

// The champions mod's moves.ts / items.ts can contain TS battle code, so they
// can't be eval'd. Line-parse just the simple overrides (basePower: 90,
// accuracy: 100, isNonstandard: "Past", …).
function parseModOverrides(tsSource) {
  const overrides = {};
  let current = null;
  for (const line of tsSource.split("\n")) {
    const open = line.match(/^\t([a-z0-9]+): \{$/);
    if (open) { current = open[1]; overrides[current] = {}; continue; }
    if (/^\t\},?$/.test(line)) { current = null; continue; }
    if (!current) continue;
    const field = line.match(/^\t\t(basePower|accuracy|pp|priority): (\d+|true),?$/) ||
                  line.match(/^\t\t(category|type): "([^"]+)",?$/) ||
                  line.match(/^\t\t(isNonstandard): (null|"[^"]+"),?$/);
    if (field) {
      const [, key, raw] = field;
      overrides[current][key] = /^\d+$/.test(raw) ? Number(raw)
        : raw === "true" ? true
        : raw === "null" ? null
        : raw.replace(/^"(.*)"$/, "$1");
    }
  }
  return overrides;
}

const toId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// formats.ts -> Map { "M-C" => "champions", "M-B" => "championsregmb" }
// (VGC and BSS entries share a mod; "(Bo3)" variants don't match the pattern)
function discoverRegulations(formatsTs) {
  const found = new Map();
  let label = null;
  for (const line of formatsTs.split("\n")) {
    if (line.includes('name: "')) {
      label = line.match(/name: "\[Gen 9 Champions\] (?:VGC \d{4}|BSS) Reg ([A-Z]-[A-Z])"/)?.[1] ?? null;
      continue;
    }
    const mod = label && line.match(/^\s*mod: '(\w+)'/);
    if (mod) { found.set(label, mod[1]); label = null; }
  }
  return found;
}

// One regulation's legality + learnsets at its commit, following the mod's
// `inherit:` chain (championsregmb -> champions) the way Showdown does.
async function loadRegulation(reg) {
  const chain = [];
  for (let mod = reg.mod; mod && chain.length < 5; ) {
    const [scripts, formats, learnsets] = await Promise.all(
      ["scripts", "formats-data", "learnsets"].map((file) =>
        raw(reg.ref, `data/mods/${mod}/${file}.ts`, { optional: true })));
    chain.push({ formats: formats && parseTsObject(formats), learnsets: learnsets ? parseTsObject(learnsets) : {} });
    mod = scripts?.match(/inherit: '(\w+)'/)?.[1];
  }
  const formatsData = chain.find((m) => m.formats)?.formats;
  if (!formatsData) throw new Error(`No formats-data.ts for Reg ${reg.label} (mod ${reg.mod} @ ${reg.ref})`);
  return { ...reg, formatsData, learnsets: chain.map((m) => m.learnsets) };
}

// A child mod's entry replaces its parent's, so check the chain in order.
// Mega/alt forms have no learnset of their own — fall back to the base species,
// then to any form of it (e.g. floettemega's learnset is keyed as floetteeternal).
function findLearnset(chain, id, baseId) {
  for (const key of [id, baseId]) {
    for (const learnsets of chain) if (learnsets[key]?.learnset) return learnsets[key].learnset;
  }
  for (const learnsets of chain) {
    const formKey = Object.keys(learnsets).find((k) => k.startsWith(baseId) && learnsets[k].learnset);
    if (formKey) return learnsets[formKey].learnset;
  }
  return null;
}

const sha = await latestCommit();
console.log(`Fetching data from Pokémon Showdown @ ${sha.slice(0, 7)}...`);
const [
  formatsTs, pokedexTs, movesModTs, movesJson, movesTextTs, abilitiesTextTs,
  itemsModTs, itemsJs, itemsTextTs,
] = await Promise.all([
  raw(sha, "config/formats.ts"),
  raw(sha, "data/pokedex.ts"),
  raw(sha, `data/mods/${CURRENT_MOD}/moves.ts`),
  fetchText(`${PLAY}/moves.json`),
  raw(sha, "data/text/moves.ts"),
  raw(sha, "data/text/abilities.ts"),
  raw(sha, `data/mods/${CURRENT_MOD}/items.ts`),
  fetchText(`${PLAY}/items.js`),
  raw(sha, "data/text/items.ts"),
]);

// ---- regulations: what Showdown lists today + what we've built before ----
const discovered = discoverRegulations(formatsTs);
if (!discovered.size) {
  throw new Error("No Champions regulations found in config/formats.ts — has Showdown renamed the formats?");
}
const currentLabel = [...discovered].find(([, mod]) => mod === CURRENT_MOD)?.[0] ?? [...discovered.keys()].sort().pop();
const known = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).regulations : [];
const byLabel = new Map(known.map((r) => [r.label, r]));
// The current regulation tracks Showdown's latest commit. A retired one stays
// frozen at the last commit where it was current: Showdown's retired-regulation
// mods only partly revert later changes (its M-B mod still inherits the Slash
// that M-C added to 37 learnsets), and they eventually get deleted outright.
for (const [label, mod] of discovered) {
  if (label === currentLabel || !byLabel.has(label)) {
    byLabel.set(label, { id: `reg${toId(label)}`, label, mod, ref: sha });
  }
}
const regulations = await Promise.all(
  [...byLabel.values()].sort((a, b) => b.label.localeCompare(a.label)).map(loadRegulation)); // newest first
const current = regulations.find((r) => r.label === currentLabel);
for (const r of regulations) {
  console.log(`  Reg ${r.label}: mod ${r.mod} @ ${r.ref.slice(0, 7)}${r === current ? " (current)" : ""}`);
}

const pokedex = parseTsObject(pokedexTs);
const movesMod = parseModOverrides(movesModTs);     // Champions move overrides
const itemsMod = parseModOverrides(itemsModTs);     // Champions item availability
// the client's items.js is `exports.BattleItems = {...}` with battle code stripped
const itemsDex = new Function("exports", `${itemsJs}; return exports.BattleItems;`)({});
const itemsText = parseTsObject(itemsTextTs);
const movesDex = JSON.parse(movesJson);
const movesText = parseTsObject(movesTextTs);
const abilitiesText = parseTsObject(abilitiesTextTs);

const isLegal = (info) => Boolean(info?.tier && info.tier !== "Illegal");
const sameList = (a, b) => a.length === b.length && a.every((m, i) => m === b[i]);

// A species is in the dataset if it's legal in any regulation.
const legalIds = new Set(regulations.flatMap((r) =>
  Object.keys(r.formatsData).filter((id) => isLegal(r.formatsData[id]))));

const out = [];
const moveIdsUsed = new Set();
const abilityNamesUsed = new Set();

for (const id of legalIds) {
  const dex = pokedex[id];
  if (!dex) {
    console.warn(`  ! no pokedex entry for ${id}, skipping`);
    continue;
  }
  const baseId = dex.baseSpecies ? toId(dex.baseSpecies) : id;

  const formats = {};        // regulation id -> tier string when legal, null otherwise
  const learnsetByReg = {};
  for (const reg of regulations) {
    const info = reg.formatsData[id];
    formats[reg.id] = isLegal(info) ? info.tier : null;
    if (!formats[reg.id]) continue;
    const learnset = findLearnset(reg.learnsets, id, baseId);
    if (learnset) learnsetByReg[reg.id] = Object.keys(learnset).sort();
  }

  // `moves` is the learnset in the newest regulation it's legal in; older
  // regulations only get their own list where it differs (e.g. M-C added
  // Slash to 37 learnsets).
  const primary = regulations.find((r) => learnsetByReg[r.id]);
  if (!primary) {
    console.warn(`  ! no learnset for ${id} (base ${baseId}), skipping`);
    continue;
  }
  const moves = learnsetByReg[primary.id];
  const movesByFormat = {};
  for (const [regId, list] of Object.entries(learnsetByReg)) {
    list.forEach((m) => moveIdsUsed.add(m));
    if (!sameList(list, moves)) movesByFormat[regId] = list;
  }

  const abilities = Object.values(dex.abilities);
  abilities.forEach((a) => abilityNamesUsed.add(a));

  // Showdown sprite filename: baseid + "-" + formeid (e.g. "charizard-megax")
  const sprite = dex.forme ? `${toId(dex.baseSpecies)}-${toId(dex.forme)}` : toId(dex.name);

  const entry = {
    id,
    baseId,                               // for the usage-stats API (keyed by base species)
    name: dex.name,                       // e.g. "Garchomp-Mega"
    sprite,
    num: dex.num,
    types: dex.types,
    abilities,
    stats: dex.baseStats,                 // { hp, atk, def, spa, spd, spe }
    bst: Object.values(dex.baseStats).reduce((a, b) => a + b, 0),
    formats,
    moves,
  };
  if (Object.keys(movesByFormat).length) entry.movesByFormat = movesByFormat;
  out.push(entry);
}

// ---- move details: base data + Champions overrides + description ----
const OVERRIDE_FIELDS = ["basePower", "accuracy", "pp", "category", "type", "priority"];
const moveInfo = {};
for (const m of [...moveIdsUsed].sort()) {
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
    if (mod[f] !== undefined) info[f] = mod[f];
  }
  moveInfo[m] = info;
}

// ---- ability descriptions ----
const abilityInfo = {};
for (const name of [...abilityNamesUsed].sort()) {
  abilityInfo[name] = abilitiesText[toId(name)]?.shortDesc ?? "";
}

// ---- item descriptions, for items available in the current regulation ----
// champions/items.ts only toggles availability, so Showdown's text applies.
// Keyed by id because the usage source spells names its own way.
const itemInfo = {};
for (const id of Object.keys(itemsDex).sort()) {
  const nonstandard = "isNonstandard" in (itemsMod[id] ?? {}) ? itemsMod[id].isNonstandard : itemsDex[id].isNonstandard;
  if (nonstandard) continue;
  itemInfo[id] = { name: itemsDex[id].name, desc: itemsText[id]?.shortDesc ?? "" };
}

out.sort((a, b) => b.bst - a.bst || a.id.localeCompare(b.id));

// ---- report + sanity check ----
const rosterSize = (reg) => out.filter((p) => p.formats[reg.id]).length;
regulations.forEach((reg, i) => {
  const older = regulations[i + 1];
  const added = older ? out.filter((p) => p.formats[reg.id] && !p.formats[older.id]).map((p) => p.name) : [];
  console.log(`Reg ${reg.label}${reg === current ? " (current)" : ""}: ${rosterSize(reg)} Pokémon` +
    (added.length ? ` — ${added.length} new since ${older.label}: ${added.join(", ")}` : ""));
});
if (rosterSize(current) < MIN_CURRENT_ROSTER) {
  throw new Error(`Reg ${current.label} has only ${rosterSize(current)} Pokémon — refusing to write (expected ${MIN_CURRENT_ROSTER}+).`);
}

const dataset = {
  generatedAt: new Date().toISOString(),
  showdownCommit: sha,
  source: "smogon/pokemon-showdown Champions regulation mods",
  regulations: regulations.map((r) => ({ id: r.id, label: r.label, current: r === current })),
  pokemon: out,
  moveInfo,
  abilityInfo,
  itemInfo,
};

// Skip the write when nothing but the timestamp/commit changed, so the daily
// job only commits real updates.
const withoutRunInfo = ({ generatedAt, showdownCommit, ...rest }) => JSON.stringify(rest);
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
if (previous && withoutRunInfo(previous) === withoutRunInfo(dataset)) {
  console.log("No changes since the last build — nothing written.");
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset));
writeFileSync(manifestPath, JSON.stringify({
  _note: "Written by scripts/build-data.mjs. ref = the Showdown commit each regulation is built from: " +
    "the latest one for the current regulation, the last one where it was current for retired ones.",
  regulations: regulations.map(({ id, label, mod, ref }) => ({ id, label, mod, ref })),
}, null, 2) + "\n");

console.log(`Wrote ${out.length} Pokémon, ${moveIdsUsed.size} moves`);
const missingDesc = Object.values(moveInfo).filter((m) => !m.desc).length;
console.log(`Moves missing descriptions: ${missingDesc}`);
console.log(`-> ${outPath}`);
