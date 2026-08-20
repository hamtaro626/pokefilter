// fetch-history.mjs — backfills usage history for the months before
// championsbattledata.com's records begin (it only keeps ~31 days).
//
// Source: Smogon's monthly Pokémon Showdown stats, which cover the Champions
// ladder formats back to the game's April 2026 release. This is a DIFFERENT
// population than the in-game ladder, so every date it adds is tagged
// source:"showdown" and the app labels it as such.
//
// Showdown's champions mod uses the same 0-32 stat point system and the same
// formats, and on the overlapping month (July 2026) its numbers track the
// in-game ones within a few points, which is why this is usable at all.
//
//   node scripts/fetch-history.mjs            # add missing pre-in-game months
//   node scripts/fetch-history.mjs --force    # refetch even if already present
//
// Run once; the weekly Action only appends in-game snapshots and preserves these.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const STATS = "https://www.smogon.com/stats";
const CUTOFF = 0;            // all ladder players — closest match to the in-game population
const MONTHS = ["2026-04", "2026-05", "2026-06"];  // Champions released 2026-04-08
// in-game battle format -> Showdown format family (VGC is doubles, BSS is singles)
const FORMAT_FAMILIES = { Doubles: "gen9championsvgc2026reg", Singles: "gen9championsbssreg" };
const REGULATIONS = ["ma", "mb"];
// keep the top N per category so the file stays small; the UI shows fewer
const KEEP = { moves: 16, abilities: 6, items: 12, natures: 10, spreads: 12 };

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const usagePath = join(projectRoot, "data", "usage", "usage.json");
const usage = JSON.parse(readFileSync(usagePath, "utf8"));
const dex = JSON.parse(readFileSync(join(projectRoot, "data", "pokemon.json"), "utf8"));
const force = process.argv.includes("--force");

const toID = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const prettify = (id) => id.replace(/(^|\s)\w/g, (c) => c.toUpperCase());

// ---- id -> display name, so historical rows merge with the in-game rows ----
const moveNames = new Map(Object.entries(dex.moveInfo).map(([id, m]) => [id, m.name]));
const abilityNames = new Map(Object.keys(dex.abilityInfo).map((n) => [toID(n), n]));
const itemNames = new Map();
for (const perId of Object.values(usage.formats)) {
  for (const buckets of Object.values(perId)) {
    for (const name of Object.keys(buckets.items ?? {})) itemNames.set(toID(name), name);
    for (const name of Object.keys(buckets.moves ?? {})) moveNames.set(toID(name), name);
    for (const name of Object.keys(buckets.abilities ?? {})) abilityNames.set(toID(name), name);
  }
}
const displayName = (map, id) => map.get(id) ?? prettify(id);

// Showdown lists each form separately ("Garchomp-Mega"); the in-game data folds
// forms into their base species, so map every form id back to its baseId.
const baseIdById = new Map(dex.pokemon.map((p) => [p.id, p.baseId]));
const RAW_BUCKETS = ["Moves", "Abilities", "Items", "Spreads"];

const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

// pick the regulation variant that actually saw play that month
async function pickFormat(month, family) {
  const counts = [];
  for (const reg of REGULATIONS) {
    const name = family + reg;
    const res = await fetch(`${STATS}/${month}/${name}-${CUTOFF}.txt`);
    if (!res.ok) continue;
    const battles = Number((await res.text()).match(/Total battles: (\d+)/)?.[1] ?? 0);
    if (battles > 0) counts.push({ name, reg, battles });
  }
  counts.sort((a, b) => b.battles - a.battles);
  return counts[0] ?? null;
}

const topN = (obj, n, total, scale) =>
  Object.entries(obj)
    .filter(([k]) => k !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .reduce((acc, [k, v]) => {
      const pct = Math.round((v / total) * scale * 10) / 10;
      if (pct > 0) acc[k] = pct;
      return acc;
    }, {});

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// chaos entry -> the same bucket shape the in-game snapshots use
function toRecord(mon) {
  const rec = {};
  const moveTotal = sum(mon.Moves);
  if (moveTotal > 0) {
    // percentages are per move slot, so they sum to ~400 across 4 slots
    rec.moves = Object.fromEntries(Object.entries(topN(mon.Moves, KEEP.moves, moveTotal, 400))
      .map(([id, pct]) => [displayName(moveNames, id), pct]));
  }
  const abilTotal = sum(mon.Abilities);
  if (abilTotal > 0) {
    rec.abilities = Object.fromEntries(Object.entries(topN(mon.Abilities, KEEP.abilities, abilTotal, 100))
      .map(([id, pct]) => [displayName(abilityNames, id), pct]));
  }
  const itemTotal = sum(mon.Items);
  if (itemTotal > 0) {
    rec.items = Object.fromEntries(Object.entries(topN(mon.Items, KEEP.items, itemTotal, 100))
      .map(([id, pct]) => [displayName(itemNames, id), pct]));
  }
  // "Jolly:2/32/0/0/0/32" carries both the nature and the stat point spread
  const spreadTotal = sum(mon.Spreads);
  if (spreadTotal > 0) {
    const spreads = {}, natures = {};
    for (const [key, v] of Object.entries(mon.Spreads)) {
      const [nature, points] = key.split(":");
      if (points) spreads[points] = (spreads[points] ?? 0) + v;
      if (nature) natures[nature] = (natures[nature] ?? 0) + v;
    }
    rec.spreads = topN(spreads, KEEP.spreads, spreadTotal, 100);
    rec.natures = topN(natures, KEEP.natures, spreadTotal, 100);
  }
  return Object.keys(rec).length ? rec : null;
}

// ---- collect one record set per (month, battle format) ----
const existing = new Set(usage.dates);
const added = [];   // { date, perFormat: { Doubles: {id: rec} }, meta }

for (const month of MONTHS) {
  const date = lastDayOfMonth(month);
  if (existing.has(date) && !force) {
    console.log(`${date} already present — skipping`);
    continue;
  }
  const perFormat = {};
  const meta = { kind: "showdown", month, formats: {} };
  for (const [battleFormat, family] of Object.entries(FORMAT_FAMILIES)) {
    const pick = await pickFormat(month, family);
    if (!pick) { console.log(`  ${month} ${battleFormat}: no format found`); continue; }
    process.stdout.write(`  ${month} ${battleFormat}: ${pick.name} (${pick.battles.toLocaleString()} battles) `);
    const res = await fetch(`${STATS}/${month}/chaos/${pick.name}-${CUTOFF}.json`);
    if (!res.ok) { console.log(`- chaos fetch failed ${res.status}`); continue; }
    const chaos = await res.json();
    const unmatched = [];
    // merge each species' forms by summing their weighted counts, then
    // normalize once — combining percentages directly would ignore form usage
    const mergedByBase = {};
    for (const [displayMon, mon] of Object.entries(chaos.data)) {
      const baseId = baseIdById.get(toID(displayMon));
      if (!baseId) { unmatched.push(displayMon); continue; }
      const target = (mergedByBase[baseId] ??= Object.fromEntries(RAW_BUCKETS.map((b) => [b, {}])));
      // A Mega's ability only applies after it Mega evolves; the in-game source
      // reports the pre-Mega ability (the Mega Stone shows up under items
      // instead), so folding in e.g. Sand Force would invent a value the rest
      // of the series never reports. Everything else is shared with the base.
      const isMegaForm = /-Mega\b/.test(displayMon);
      for (const bucket of RAW_BUCKETS) {
        if (isMegaForm && bucket === "Abilities") continue;
        for (const [k, v] of Object.entries(mon[bucket] ?? {})) {
          target[bucket][k] = (target[bucket][k] ?? 0) + v;
        }
      }
    }
    const byId = {};
    for (const [baseId, merged] of Object.entries(mergedByBase)) {
      const rec = toRecord(merged);
      if (rec) byId[baseId] = rec;
    }
    const matched = Object.keys(byId).length;
    perFormat[battleFormat] = byId;
    meta.formats[battleFormat] = { format: pick.name, regulation: pick.reg.toUpperCase().replace("M", "M-"), battles: pick.battles };
    console.log(`-> ${matched} species${unmatched.length ? `, ${unmatched.length} unknown (e.g. ${unmatched.slice(0, 3).join(", ")})` : ""}`);
  }
  if (Object.keys(perFormat).length) added.push({ date, perFormat, meta });
}

if (!added.length) {
  console.log("Nothing to add.");
  process.exit(0);
}

// ---- rebuild the aligned series with the new dates merged in ----
const sources = usage.sources ?? usage.dates.map(() => ({ kind: "ingame" }));
const combined = usage.dates.map((date, i) => ({ date, source: sources[i], perFormat: null, index: i }));
for (const a of added) combined.push({ date: a.date, source: a.meta, perFormat: a.perFormat, index: -1 });
combined.sort((x, y) => x.date.localeCompare(y.date));

const dates = combined.map((c) => c.date);
const formats = {};
for (const battleFormat of Object.keys(usage.formats)) {
  const perId = {};
  combined.forEach((entry, di) => {
    if (entry.index >= 0) {
      // carry an existing in-game column across
      for (const [id, buckets] of Object.entries(usage.formats[battleFormat] ?? {})) {
        for (const [bucket, series] of Object.entries(buckets)) {
          for (const [name, arr] of Object.entries(series)) {
            const v = arr[entry.index];
            if (v == null) continue;
            (((perId[id] ??= {})[bucket] ??= {})[name] ??= new Array(dates.length).fill(null))[di] = v;
          }
        }
      }
    } else {
      for (const [id, rec] of Object.entries(entry.perFormat[battleFormat] ?? {})) {
        for (const [bucket, entries] of Object.entries(rec)) {
          for (const [name, pct] of Object.entries(entries)) {
            (((perId[id] ??= {})[bucket] ??= {})[name] ??= new Array(dates.length).fill(null))[di] = pct;
          }
        }
      }
    }
  });
  formats[battleFormat] = perId;
}

writeFileSync(usagePath, JSON.stringify({
  updated: usage.updated,
  dates,
  sources: combined.map((c) => c.source),
  formats,
}));

console.log(`\nDates now: ${dates.map((d, i) => `${d}(${combined[i].source.kind === "showdown" ? "SD" : "in-game"})`).join(" ")}`);
console.log(`-> ${usagePath} (${Math.round(readFileSync(usagePath).length / 1024)} KB)`);
