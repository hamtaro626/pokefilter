// fetch-usage.mjs — snapshots ranked usage data from championsbattledata.com
// into data/usage/usage.json, building a weekly time series.
//
//   node scripts/fetch-usage.mjs                 # append today's snapshot (weekly job)
//   node scripts/fetch-usage.mjs --backfill      # rebuild series from the API's daily history
//   node scripts/fetch-usage.mjs --fill-missing  # add past in-game dates for Pokémon that
//                                                # have no data yet (from each date's season)
//
// The file holds per-date series aligned to `dates`, keyed by each Pokémon's
// usageId — its own form (zoroarkhisui has its own data), except Megas, which
// use the form they Mega Evolve from:
//   { updated, dates: ["2026-07-16", ...], sources: [{ kind, season, regulation }, ...],
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

// Where the API files a Pokémon under a different id than Showdown's.
const API_ID = {
  floetteeternal: "floette",  // Eternal Floette (Mega Floette's pre-Mega form) is just "Floette"
  vivillon: "vivillonfancy",  // Vivillon is filed under its Fancy Pattern
};
const apiId = (id) => API_ID[id] ?? id;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(projectRoot, "data", "usage", "usage.json");
const backfill = process.argv.includes("--backfill");
const fillMissing = process.argv.includes("--fill-missing");

const dataset = JSON.parse(readFileSync(join(projectRoot, "data", "pokemon.json"), "utf8"));
const usageIds = [...new Set(dataset.pokemon.map((p) => p.usageId))];
// Each date's source records the regulation being played, so the app never
// draws a trend arrow across a regulation change.
const regulation = dataset.regulations?.find((r) => r.current)?.label ?? null;
console.log(`${usageIds.length} Pokémon/forms, formats: ${FORMATS.join(", ")}, Reg ${regulation ?? "?"}`);

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

// For a form it doesn't track, the API answers with a different one (persian
// returns Alolan Persian), so only accept data for exactly the id we asked for.
const isFor = (json, id) => json?.showdownId === apiId(id);

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

// snapshots: Map dateIso -> { format -> { usageId -> record } }
const snapshots = new Map();
// dateIso -> provenance ({kind:"ingame", season, regulation} here; fetch-history.mjs adds "showdown")
const sourceByDate = new Map();
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;

// existing usage.json -> snapshots / sourceByDate, preserving each date's source
function loadExisting() {
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

// The API's ranked seasons (M4, M5, …) run about monthly and don't line up with
// regulations, so snapshots record both. Ask a few Pokémon until one has data.
async function currentSeason() {
  for (const id of usageIds.slice(0, 20)) {
    try {
      const json = await (await fetch(`${API}/Doubles/${apiId(id)}?days=1`)).json();
      if (json?.daily?.[0]?.season) return json.daily[0].season;
    } catch {}
  }
  console.warn("Could not determine the current ranked season");
  return null;
}

if (backfill) {
  for (const format of FORMATS) {
    console.log(`Backfilling ${format} (daily history, current season)...`);
    const urls = usageIds.map((id) => `${API}/${format}/${apiId(id)}?days=31`);
    const responses = await fetchAll(urls);
    responses.forEach((json, i) => {
      if (!json?.daily || !isFor(json, usageIds[i])) return;
      for (const day of json.daily) {
        const date = isoDate(day.date);
        const rec = rowsToRecord(day.rows ?? []);
        if (!rec) continue;
        if (!snapshots.has(date)) snapshots.set(date, {});
        sourceByDate.set(date, { kind: "ingame", season: day.season ?? null, regulation });
        (snapshots.get(date)[format] ??= {})[usageIds[i]] = rec;
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
} else if (fillMissing) {
  if (!existing) {
    console.log("No usage.json yet — take a snapshot first.");
    process.exit(1);
  }
  loadExisting();
  // in-game dates grouped by the ranked season they were snapshotted in
  const datesBySeason = {};
  existing.dates.forEach((date, di) => {
    const src = existing.sources?.[di];
    if (src?.kind === "ingame" && src.season) (datesBySeason[src.season] ??= new Set()).add(date);
  });
  const seasons = Object.keys(datesBySeason);
  let filled = 0;
  for (const format of FORMATS) {
    const missing = usageIds.filter((id) => !existing.formats[format]?.[id]);
    console.log(`${format}: ${missing.length} Pokémon/forms without data, checking seasons ${seasons.join(", ")}...`);
    const jobs = missing.flatMap((id) => seasons.map((season) => ({ id, season })));
    // days=31 is the API's cap; every season so far has fewer daily files than that
    const responses = await fetchAll(jobs.map(({ id, season }) => `${API}/${format}/${apiId(id)}?season=${season}&days=31`));
    responses.forEach((json, i) => {
      const { id, season } = jobs[i];
      if (!json?.daily || !isFor(json, id)) return;
      for (const day of json.daily) {
        const date = isoDate(day.date);
        if (!datesBySeason[season].has(date)) continue;
        const rec = rowsToRecord(day.rows ?? []);
        if (!rec) continue;
        (snapshots.get(date)[format] ??= {})[id] = rec;
        filled++;
      }
    });
  }
  console.log(`\nFilled ${filled} Pokémon-date records`);
} else {
  // Weekly job: append the current snapshot under today's date.
  if (existing) {
    const last = existing.dates[existing.dates.length - 1];
    if ((new Date(today) - new Date(last)) / 86400000 < MIN_DAYS_BETWEEN_SNAPSHOTS) {
      console.log(`Last snapshot ${last} is <${MIN_DAYS_BETWEEN_SNAPSHOTS} days old — nothing to do.`);
      process.exit(0);
    }
    loadExisting();
  }
  const season = await currentSeason();
  for (const format of FORMATS) {
    console.log(`Fetching current ${format} data (season ${season ?? "?"})...`);
    const urls = usageIds.map((id) => `${API}/${format}/${apiId(id)}`);
    const responses = await fetchAll(urls);
    const records = responses.map((json, i) => (isFor(json, usageIds[i]) ? rowsToRecord(json.rows ?? []) : null));
    // "Current" is the site's newest daily file, and some Pokémon skip a day
    // (Maushold and Eternal Floette had none on 2026-09-13) — fall back to that
    // Pokémon's own newest file from the past week of this season.
    const gaps = records.map((rec, i) => (rec ? null : i)).filter((i) => i != null);
    const recent = await fetchAll(gaps.map((i) => `${API}/${format}/${apiId(usageIds[i])}?days=7`));
    let recovered = 0;
    recent.forEach((json, g) => {
      const day = isFor(json, usageIds[gaps[g]]) ? json.daily?.[0] : null; // newest first
      if (!day || (season && day.season !== season)) return;
      records[gaps[g]] = rowsToRecord(day.rows ?? []);
      if (records[gaps[g]]) recovered++;
    });
    console.log(`  ${recovered} missing from "current" taken from their newest daily file`);
    records.forEach((rec, i) => {
      if (!rec) return;
      snapshots.set(today, snapshots.get(today) ?? {});
      sourceByDate.set(today, { kind: "ingame", season, regulation });
      (snapshots.get(today)[format] ??= {})[usageIds[i]] = rec;
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
  updated: fillMissing ? existing.updated : today,
  dates,
  sources: dates.map((d) => sourceByDate.get(d) ?? { kind: "ingame" }),
  formats,
}));

const covered = Object.keys(formats.Doubles).length;
console.log(`\nWrote ${dates.length} snapshot dates (${dates[0]} → ${dates[dates.length - 1]}), ` +
  `${covered}/${usageIds.length} Pokémon/forms with Doubles data`);
console.log(`-> ${outPath} (${Math.round(readFileSync(outPath).length / 1024)} KB)`);
