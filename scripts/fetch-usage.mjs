// fetch-usage.mjs — snapshots ranked usage data from championsbattledata.com
// into data/usage/usage.json, building a weekly time series.
//
//   node scripts/fetch-usage.mjs             # append today's snapshot (weekly job)
//   node scripts/fetch-usage.mjs --backfill  # rebuild series from the API's daily history
//
// The file holds per-date series aligned to `dates`:
//   { updated, dates: ["2026-07-16", ...],
//     formats: { Doubles: { garchomp: { moves: {"Rock Slide": [81.3, ...]}, ... } } } }
// null in a series = no data for that date.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://championsbattledata.com/api/battle";
const FORMATS = ["Doubles", "Singles"];
const CATEGORIES = {
  move: "moves",
  ability: "abilities",
  held_item: "items",
  stat_alignment: "natures",  // row.name is the nature ("Jolly")
  stat_points: "spreads",     // row has no name; key is built from the point fields
};

// Champions distributes 0-32 "stat points" per stat rather than 252 EVs.
const POINT_FIELDS = ["hp_points", "attack_points", "defense_points", "sp_atk_points", "sp_def_points", "speed_points"];
const MIN_DAYS_BETWEEN_SNAPSHOTS = 6;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(projectRoot, "data", "usage", "usage.json");
const backfill = process.argv.includes("--backfill");

const pokemon = JSON.parse(readFileSync(join(projectRoot, "data", "pokemon.json"), "utf8")).pokemon;
const baseIds = [...new Set(pokemon.map((p) => p.baseId))];
console.log(`${baseIds.length} base species, formats: ${FORMATS.join(", ")}`);

// dd_mm_yyyy -> yyyy-mm-dd
const isoDate = (d) => {
  const [dd, mm, yyyy] = d.split("_");
  return `${yyyy}-${mm}-${dd}`;
};
const today = new Date().toISOString().slice(0, 10);

// Fetch with limited concurrency to be polite to their server.
async function fetchAll(urls, concurrency = 6) {
  const results = new Array(urls.length);
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < urls.length) {
      const idx = i++;
      try {
        const res = await fetch(urls[idx]);
        results[idx] = res.ok ? await res.json() : null;
      } catch {
        results[idx] = null;
      }
      if (idx % 50 === 0) process.stdout.write(`  ${idx}/${urls.length}\r`);
    }
  }));
  return results;
}

// rows -> { moves: {name: pct}, abilities: {...}, items: {...},
//           natures: {...}, spreads: {"2/32/0/0/0/32": pct} }
function rowsToRecord(rows) {
  const rec = {};
  for (const row of rows) {
    const bucket = CATEGORIES[row.category];
    if (!bucket) continue;
    const pct = parseFloat(row.percentage);
    if (!Number.isFinite(pct)) continue;
    let key = row.name;
    if (bucket === "spreads") {
      const pts = POINT_FIELDS.map((f) => Number(row[f]) || 0);
      if (!pts.some((p) => p > 0)) continue;
      key = pts.join("/");
    }
    if (!key) continue;
    // a spread/nature can appear twice in one snapshot; keep the larger share
    const prev = rec[bucket]?.[key];
    (rec[bucket] ??= {})[key] = prev == null ? pct : Math.max(prev, pct);
  }
  return Object.keys(rec).length ? rec : null;
}

// snapshots: Map dateIso -> { format -> { baseId -> record } }
const snapshots = new Map();
// dateIso -> provenance ({kind:"ingame"} here; fetch-history.mjs adds "showdown")
const sourceByDate = new Map();

if (backfill) {
  for (const format of FORMATS) {
    console.log(`Backfilling ${format} (daily history)...`);
    const urls = baseIds.map((id) => `${API}/${format}/${id}?season=M4&days=31`);
    const responses = await fetchAll(urls);
    responses.forEach((json, i) => {
      if (!json?.daily) return;
      for (const day of json.daily) {
        const date = isoDate(day.date);
        const rec = rowsToRecord(day.rows ?? []);
        if (!rec) continue;
        if (!snapshots.has(date)) snapshots.set(date, {});
        sourceByDate.set(date, { kind: "ingame" });
        (snapshots.get(date)[format] ??= {})[baseIds[i]] = rec;
      }
    });
  }
  // keep roughly weekly spacing: walk dates oldest-first, keep one per 6+ days,
  // but always keep the newest date.
  const allDates = [...snapshots.keys()].sort();
  const kept = [];
  for (const d of allDates) {
    if (!kept.length || (new Date(d) - new Date(kept[kept.length - 1])) / 86400000 >= MIN_DAYS_BETWEEN_SNAPSHOTS) {
      kept.push(d);
    }
  }
  const newest = allDates[allDates.length - 1];
  if (!kept.includes(newest)) kept.push(newest);
  for (const d of allDates) if (!kept.includes(d)) snapshots.delete(d);
  console.log(`Kept weekly-spaced dates: ${kept.join(", ")}`);
} else {
  // Weekly job: append the current snapshot under today's date.
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  if (existing) {
    const last = existing.dates[existing.dates.length - 1];
    if ((new Date(today) - new Date(last)) / 86400000 < MIN_DAYS_BETWEEN_SNAPSHOTS) {
      console.log(`Last snapshot ${last} is <${MIN_DAYS_BETWEEN_SNAPSHOTS} days old — nothing to do.`);
      process.exit(0);
    }
    // reload existing series into snapshots, preserving each date's source
    existing.dates.forEach((date, di) => {
      sourceByDate.set(date, existing.sources?.[di] ?? { kind: "ingame" });
      const perFormat = {};
      for (const format of FORMATS) {
        for (const [id, buckets] of Object.entries(existing.formats[format] ?? {})) {
          for (const [bucket, series] of Object.entries(buckets)) {
            for (const [name, arr] of Object.entries(series)) {
              if (arr[di] == null) continue;
              (((perFormat[format] ??= {})[id] ??= {})[bucket] ??= {})[name] = arr[di];
            }
          }
        }
      }
      snapshots.set(date, perFormat);
    });
  }
  for (const format of FORMATS) {
    console.log(`Fetching current ${format} data...`);
    const urls = baseIds.map((id) => `${API}/${format}/${id}`);
    const responses = await fetchAll(urls);
    responses.forEach((json, i) => {
      const rec = rowsToRecord(json?.rows ?? []);
      if (!rec) return;
      snapshots.set(today, snapshots.get(today) ?? {});
      sourceByDate.set(today, { kind: "ingame" });
      (snapshots.get(today)[format] ??= {})[baseIds[i]] = rec;
    });
  }
}

// ---- serialize: per-name series aligned to sorted dates ----
const dates = [...snapshots.keys()].sort();
const formats = {};
for (const format of FORMATS) {
  const perId = {};
  dates.forEach((date, di) => {
    for (const [id, rec] of Object.entries(snapshots.get(date)?.[format] ?? {})) {
      for (const [bucket, entries] of Object.entries(rec)) {
        for (const [name, pct] of Object.entries(entries)) {
          const series = (((perId[id] ??= {})[bucket] ??= {})[name] ??= new Array(dates.length).fill(null));
          series[di] = pct;
        }
      }
    }
  });
  formats[format] = perId;
}

mkdirSync(join(projectRoot, "data", "usage"), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  updated: today,
  dates,
  sources: dates.map((d) => sourceByDate.get(d) ?? { kind: "ingame" }),
  formats,
}));

const covered = Object.keys(formats.Doubles).length;
console.log(`\nWrote ${dates.length} snapshot dates (${dates[0]} → ${dates[dates.length - 1]}), ` +
  `${covered}/${baseIds.length} species with Doubles data`);
console.log(`-> ${outPath} (${Math.round(readFileSync(outPath).length / 1024)} KB)`);
