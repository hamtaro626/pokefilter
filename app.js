// PokéFilter — client-side filtering over data/pokemon.json

const TYPE_COLORS = {
  Normal: "#A8A77A", Fire: "#EE8130", Water: "#6390F0", Electric: "#F7D02C",
  Grass: "#7AC74C", Ice: "#96D9D6", Fighting: "#C22E28", Poison: "#A33EA1",
  Ground: "#E2BF65", Flying: "#A98FF3", Psychic: "#F95587", Bug: "#A6B91A",
  Rock: "#B6A136", Ghost: "#735797", Dragon: "#6F35FC", Dark: "#705746",
  Steel: "#B7B7CE", Fairy: "#D685AD",
};

const CATEGORY_COLORS = { Physical: "#C22E28", Special: "#6390F0", Status: "#A8A77A" };

// Champions spreads are 0-32 "stat points" per stat, in this order.
const SPREAD_ORDER = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

// nature -> [raised, lowered]; neutral natures omitted
const NATURES = {
  Adamant: ["Atk", "SpA"], Bold: ["Def", "Atk"], Brave: ["Atk", "Spe"],
  Calm: ["SpD", "Atk"], Careful: ["SpD", "SpA"], Gentle: ["SpD", "Def"],
  Hasty: ["Spe", "Def"], Impish: ["Def", "SpA"], Jolly: ["Spe", "SpA"],
  Lax: ["Def", "SpD"], Lonely: ["Atk", "Def"], Mild: ["SpA", "Def"],
  Modest: ["SpA", "Atk"], Naive: ["Spe", "SpD"], Naughty: ["Atk", "SpD"],
  Quiet: ["SpA", "Spe"], Rash: ["SpA", "SpD"], Relaxed: ["Def", "Spe"],
  Sassy: ["SpD", "Spe"], Timid: ["Spe", "Atk"],
};

const SPRITE_BASE = "https://play.pokemonshowdown.com/sprites/gen5";

// ---------- state ----------
const state = {
  format: "regmb",    // "regmb" (current) | "regma"
  nameQuery: [],      // substring terms, OR'd together (comma-separated input)
  types: [],          // must-have types — max 2
  excludeTypes: [],   // must-NOT-have types
  mega: "all",        // "all" | "hide" | "only"
  moves: [],          // move ids: ["earthquake", "rockslide"]
  ability: null,      // display name: "Intimidate"
  statMins: {},       // { spe: 100, bst: 500, ... }
  moveCategory: null, // null | "Physical" | "Special" | "Status" (picker filter)
  lv50: false,        // false = base stats, true = level-50 with 31 IVs
  sort: "bst",
  sortDir: "desc",    // "desc" | "asc"
};

let DATA = null;        // { pokemon, moveInfo, abilityInfo }
let MOVE_LIST = [];     // [{ id, ...moveInfo }] sorted by name
let ABILITY_LIST = [];  // ["Adaptability", ...]
let USAGE = null;       // data/usage/usage.json, lazy-loaded
let usagePromise = null;
let expandedId = null;  // card with the detail panel open
let detailTab = "usage";   // "usage" | "moves"
let usageFormat = "Doubles";

const isMega = (p) => /-Mega(-[XY])?$/.test(p.name);

// ---------- boot ----------
fetch("data/pokemon.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    MOVE_LIST = Object.entries(data.moveInfo)
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name));
    ABILITY_LIST = [...new Set(data.pokemon.flatMap((p) => p.abilities))].sort();
    buildTypeChips();
    render();
  })
  .catch((err) => {
    document.getElementById("result-count").textContent =
      "Could not load data — run: node scripts/build-data.mjs (and serve over http, not file://)";
    console.error(err);
  });

// ---------- stats: base vs level-50 (31 IVs, 0 EVs, neutral nature) ----------
function displayStats(p) {
  if (!state.lv50) return { ...p.stats, bst: p.bst };
  const s = {};
  for (const [k, b] of Object.entries(p.stats)) {
    s[k] = k === "hp"
      ? (b === 1 ? 1 : Math.floor((2 * b + 31) * 50 / 100) + 60) // Shedinja stays at 1
      : Math.floor((2 * b + 31) * 50 / 100) + 5;
  }
  s.bst = s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
  return s;
}

// ---------- filtering ----------
function matches(p) {
  if (!p.formats[state.format]) return false;
  if (state.nameQuery.length) {
    const name = p.name.toLowerCase();
    if (!state.nameQuery.some((term) => name.includes(term))) return false;
  }
  if (state.mega === "hide" && isMega(p)) return false;
  if (state.mega === "only" && !isMega(p)) return false;
  for (const t of state.types) if (!p.types.includes(t)) return false;
  for (const t of state.excludeTypes) if (p.types.includes(t)) return false;
  for (const m of state.moves) if (!p.moves.includes(m)) return false;
  if (state.ability && !p.abilities.includes(state.ability)) return false;
  const stats = displayStats(p);
  for (const [stat, min] of Object.entries(state.statMins)) {
    if (stats[stat] < min) return false;
  }
  return true;
}

function render() {
  const pool = DATA.pokemon.filter((p) => p.formats[state.format]);
  const results = pool.filter(matches);
  const dir = state.sortDir === "desc" ? 1 : -1;
  results.sort((a, b) => {
    if (state.sort === "name") return dir * a.name.localeCompare(b.name); // ↓ = A→Z
    const sa = displayStats(a), sb = displayStats(b);
    return dir * (sb[state.sort] - sa[state.sort]);
  });

  document.getElementById("result-count").textContent =
    `${results.length} of ${pool.length} Pokémon match`;

  const container = document.getElementById("results");
  container.innerHTML = "";
  if (results.length === 0) {
    container.innerHTML = `<p class="empty">No Pokémon in this regulation matches all of those filters. Try removing one.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const p of results) frag.appendChild(card(p));
  container.appendChild(frag);
  if (expandedId) {
    const p = DATA.pokemon.find((x) => x.id === expandedId);
    if (p && container.querySelector(`[data-id="${expandedId}"] .detail-panel`)) fillDetail(p);
  }
}

// ---------- result cards ----------
const STAT_ROWS = [
  ["hp", "HP"], ["atk", "Atk"], ["def", "Def"],
  ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"],
];

// Some Champions-exclusive Megas (Mega Falinks, Mega Raichu X…) have no
// Showdown sprite yet — fall back to championsbattledata.com's official art.
function fallbackSprite(name) {
  const m = name.match(/^(.*)-Mega(?:-([XY]))?$/);
  if (!m) return "";
  const file = `Mega ${m[1]}${m[2] ? " " + m[2] : ""}.png`;
  return encodeURI(`https://championsbattledata.com/pokemon_champions_assets/pokemon/${file}`);
}

function card(p) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = p.id;
  const stats = displayStats(p);
  const scale = state.lv50 ? 260 : 200;

  const statRows = STAT_ROWS.map(([key, label]) => {
    const v = stats[key];
    const base = p.stats[key];
    const pct = Math.min(100, (v / scale) * 100);
    const color = base >= 120 ? "#7AC74C" : base >= 90 ? "#F7D02C" : base >= 60 ? "#EE8130" : "#C22E28";
    return `<div class="stat-row">
      <span class="label">${label}</span><span class="value">${v}</span>
      <div class="stat-bar"><span style="width:${pct}%;background:${color}"></span></div>
    </div>`;
  }).join("");

  const abilities = p.abilities
    .map((a) => `<span title="${esc(DATA.abilityInfo[a] || "")}">${a}</span>`)
    .join(" · ");

  el.innerHTML = `
    <div class="card-top" role="button" tabindex="0" title="Click for usage & full moveset">
      <img src="${SPRITE_BASE}/${p.sprite}.png" alt="" loading="lazy"
           data-fb="${fallbackSprite(p.name)}"
           onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb}else{this.style.visibility='hidden'}">
      <div>
        <div class="card-name">${p.name}<span class="card-tier">${p.formats[state.format]}</span></div>
        <div class="card-types">${p.types.map(typeBadge).join("")}</div>
        <div class="card-abilities">${abilities}</div>
      </div>
    </div>
    <div class="card-stats">${statRows}</div>
    <div class="card-bst">${state.lv50 ? "Lv. 50 total" : "BST"} ${stats.bst}</div>
    ${expandedId === p.id ? `<div class="detail-panel"><div class="usage-body">Loading…</div></div>` : ""}`;

  el.querySelector(".card-top").addEventListener("click", () => {
    expandedId = expandedId === p.id ? null : p.id;
    render();
  });
  return el;
}

function typeBadge(t) {
  return `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${t}</span>`;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---------- detail panel: usage (weekly snapshots) + full moveset ----------
function loadUsageFile() {
  usagePromise ??= fetch("data/usage/usage.json")
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((j) => (USAGE = j))
    .catch(() => null);
  return usagePromise;
}

function trendCell(series) {
  // series is aligned to USAGE.dates; latest value + change vs previous point
  let latest = null, prev = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] == null) continue;
    if (latest === null) latest = series[i];
    else { prev = series[i]; break; }
  }
  if (latest === null) return "";
  let delta = "";
  if (prev !== null) {
    const d = +(latest - prev).toFixed(1);
    if (d > 0) delta = ` <span class="trend up">▲${d}</span>`;
    else if (d < 0) delta = ` <span class="trend down">▼${Math.abs(d)}</span>`;
    else delta = ` <span class="trend flat">•</span>`;
  }
  const history = USAGE.dates.map((d, i) => `${d.slice(5)}: ${series[i] ?? "—"}%`).join("  ");
  return `<span title="${esc(history)}">${latest}%${delta}</span>`;
}

async function fillDetail(p) {
  const panel = document.querySelector(`[data-id="${p.id}"] .detail-panel`);
  if (!panel) return;

  panel.innerHTML = `
    <div class="usage-tabs">
      <button class="usage-tab ${detailTab === "usage" ? "active" : ""}" data-dt="usage">Usage</button>
      <button class="usage-tab ${detailTab === "moves" ? "active" : ""}" data-dt="moves">All moves</button>
      ${detailTab === "usage" ? ["Doubles", "Singles"].map((f) =>
        `<button class="usage-tab sub ${f === usageFormat ? "active" : ""}" data-uf="${f}">${f}</button>`).join("") : ""}
      <span class="usage-note">${detailTab === "usage" ? "updated weekly" : `${p.moves.length} moves`}</span>
    </div>
    <div class="usage-body">Loading…</div>`;

  panel.querySelectorAll("[data-dt]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); detailTab = btn.dataset.dt; fillDetail(p); }));
  panel.querySelectorAll("[data-uf]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); usageFormat = btn.dataset.uf; fillDetail(p); }));

  const body = panel.querySelector(".usage-body");

  if (detailTab === "moves") {
    const abilities = p.abilities.map((a) =>
      `<div class="usage-row"><span>${a}</span><span class="opt-desc">${esc(DATA.abilityInfo[a] || "")}</span></div>`).join("");
    const moves = p.moves.map((id) => {
      const m = DATA.moveInfo[id];
      const bp = m.category === "Status" ? "—" : m.basePower;
      const acc = m.accuracy === true ? "—" : m.accuracy + "%";
      return `<div class="usage-row" title="${esc(m.desc)}">
        <span>${m.name}</span>
        <span class="opt-meta">
          <span class="type-badge" style="background:${TYPE_COLORS[m.type] || "#666"}">${m.type}</span>
          <span class="cat-badge" style="background:${CATEGORY_COLORS[m.category] || "#666"}">${m.category.slice(0, 4)}</span>
          <span class="opt-nums">BP ${bp} · ${acc}</span>
        </span>
      </div>`;
    }).join("");
    body.innerHTML = `
      <div class="usage-col"><h3>Abilities</h3>${abilities}</div>
      <div class="usage-col moveset-list"><h3>Learnable moves</h3>${moves}</div>`;
    return;
  }

  // usage tab
  await loadUsageFile();
  const rec = USAGE?.formats?.[usageFormat]?.[p.baseId];
  if (!rec) {
    body.textContent = "No ranked usage data for this Pokémon.";
    return;
  }
  const section = (bucket, title, n, label = (k) => k) => {
    const entries = Object.entries(rec[bucket] ?? {})
      .map(([name, series]) => ({ name, series, latest: [...series].reverse().find((v) => v != null) ?? 0 }))
      .sort((a, b) => b.latest - a.latest)
      .slice(0, n);
    if (!entries.length) return "";
    return `<div class="usage-col"><h3>${title}</h3>${entries.map((e) =>
      `<div class="usage-row">${label(e.name)}${trendCell(e.series)}</div>`).join("")}</div>`;
  };

  // "2/32/0/0/0/32" -> "32 Atk / 32 Spe / 2 HP" (invested stats first, then HP)
  const spreadLabel = (key) => {
    const pts = key.split("/").map(Number);
    const parts = pts
      .map((v, i) => ({ v, stat: SPREAD_ORDER[i] }))
      .filter((p) => p.v > 0)
      .sort((a, b) => b.v - a.v)
      .map((p) => `<span class="spread-part${p.v >= 24 ? " max" : ""}">${p.v} ${p.stat}</span>`);
    const total = pts.reduce((a, b) => a + b, 0);
    return `<span class="spread" title="${total} of 66 stat points used">${
      parts.join('<span class="spread-sep">/</span>') || "no investment"}</span>`;
  };

  const natureLabel = (name) => {
    const n = NATURES[name];
    return `<span>${name}${n ? ` <span class="nature-mod">+${n[0]} −${n[1]}</span>` : ` <span class="nature-mod">neutral</span>`}</span>`;
  };

  body.innerHTML =
    (section("moves", "Moves", 8, (k) => `<span>${k}</span>`) +
     section("abilities", "Abilities", 3, (k) => `<span>${k}</span>`) +
     section("items", "Items", 5, (k) => `<span>${k}</span>`) +
     section("natures", "Natures", 4, natureLabel) +
     section("spreads", "Stat point spreads", 5, spreadLabel)) ||
    "No ranked usage data for this Pokémon.";
  if (rec.spreads) {
    body.innerHTML += `<p class="usage-note">Spreads are Champions stat points — 66 to spend, 32 max in any one stat.</p>`;
  }
  body.innerHTML += `<p class="usage-note">Snapshots: ${USAGE.dates.join(" · ")}${
    p.baseId !== p.id ? ` — data covers ${p.baseId} incl. all forms` : ""}</p>`;
}

// ---------- type chips (click cycles: off -> include -> exclude -> off) ----------
function buildTypeChips() {
  const wrap = document.getElementById("type-chips");
  for (const type of Object.keys(TYPE_COLORS)) {
    const btn = document.createElement("button");
    btn.className = "type-chip";
    btn.textContent = type;
    btn.style.background = TYPE_COLORS[type];
    btn.addEventListener("click", () => {
      if (state.types.includes(type)) {
        state.types = state.types.filter((t) => t !== type);
        state.excludeTypes.push(type);
      } else if (state.excludeTypes.includes(type)) {
        state.excludeTypes = state.excludeTypes.filter((t) => t !== type);
      } else {
        if (state.types.length === 2) state.types.shift(); // replace oldest include
        state.types.push(type);
      }
      wrap.querySelectorAll(".type-chip").forEach((b) => {
        b.classList.toggle("active", state.types.includes(b.textContent));
        b.classList.toggle("exclude", state.excludeTypes.includes(b.textContent));
      });
      render();
    });
    wrap.appendChild(btn);
  }
}

// ---------- autocomplete pickers ----------
function setupPicker({ inputId, listId, getOptions, renderOption, onPick }) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let highlighted = -1;

  function close() { list.hidden = true; highlighted = -1; }

  function update() {
    const q = input.value.trim().toLowerCase();
    const opts = getOptions(q); // empty query = full list, scrollable
    if (opts.length === 0) return close();
    list.innerHTML = "";
    opts.forEach((opt) => {
      const li = document.createElement("li");
      li.innerHTML = renderOption(opt);
      if (opt.title) li.title = opt.title;
      // mousedown (not click) so it fires before the input's blur
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(opt);
      });
      list.appendChild(li);
    });
    list.hidden = false;
    highlighted = -1;
  }

  function pick(opt) {
    onPick(opt);
    input.value = "";
    close();
    render();
  }

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 100));
  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll("li")];
    if (list.hidden || items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlighted = e.key === "ArrowDown"
        ? (highlighted + 1) % items.length
        : (highlighted - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("highlighted", i === highlighted));
      items[highlighted].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = highlighted >= 0 ? highlighted : 0;
      items[idx].dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      close();
    }
  });
  return { update };
}

const movePicker = setupPicker({
  inputId: "move-input",
  listId: "move-suggestions",
  getOptions: (q) =>
    MOVE_LIST.filter((m) =>
      (!q || m.name.toLowerCase().includes(q)) &&
      (!state.moveCategory || m.category === state.moveCategory) &&
      !state.moves.includes(m.id))
      .map((m) => ({ ...m, title: m.desc })),
  renderOption: (m) => {
    const acc = m.accuracy === true ? "—" : m.accuracy + "%";
    const bp = m.category === "Status" ? "—" : m.basePower;
    return `<span class="opt-name">${m.name}</span>
      <span class="opt-meta">
        <span class="type-badge" style="background:${TYPE_COLORS[m.type] || "#666"}">${m.type}</span>
        <span class="cat-badge" style="background:${CATEGORY_COLORS[m.category] || "#666"}">${m.category.slice(0, 4)}</span>
        <span class="opt-nums">BP ${bp} · Acc ${acc}</span>
      </span>`;
  },
  onPick: (opt) => {
    state.moves.push(opt.id);
    renderSelectedChips();
  },
});

setupPicker({
  inputId: "ability-input",
  listId: "ability-suggestions",
  getOptions: (q) =>
    ABILITY_LIST.filter((a) => !q || a.toLowerCase().includes(q))
      .map((a) => ({ label: a, title: DATA.abilityInfo[a] || "" })),
  renderOption: (a) =>
    `<span class="opt-name">${a.label}</span><span class="opt-desc">${esc(a.title)}</span>`,
  onPick: (opt) => {
    state.ability = opt.label; // single-select: replaces previous
    renderSelectedChips();
  },
});

function renderSelectedChips() {
  const moveWrap = document.getElementById("move-selected");
  moveWrap.innerHTML = "";
  for (const id of state.moves) {
    const info = DATA.moveInfo[id];
    const chip = document.createElement("button");
    chip.className = "selected-chip";
    chip.textContent = info.name;
    chip.title = `${info.desc}  (BP ${info.category === "Status" ? "—" : info.basePower}, Acc ${info.accuracy === true ? "—" : info.accuracy + "%"})`;
    chip.addEventListener("click", () => {
      state.moves = state.moves.filter((m) => m !== id);
      renderSelectedChips();
      render();
    });
    moveWrap.appendChild(chip);
  }

  const abilityWrap = document.getElementById("ability-selected");
  abilityWrap.innerHTML = "";
  if (state.ability) {
    const chip = document.createElement("button");
    chip.className = "selected-chip";
    chip.textContent = state.ability;
    chip.title = DATA.abilityInfo[state.ability] || "";
    chip.addEventListener("click", () => {
      state.ability = null;
      renderSelectedChips();
      render();
    });
    abilityWrap.appendChild(chip);
  }
}

// ---------- name search ----------
// comma acts as OR: "garchomp, dragonite" matches either
document.getElementById("name-input").addEventListener("input", (e) => {
  state.nameQuery = e.target.value
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  render();
});

// ---------- mega filter ----------
document.querySelectorAll(".mega-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mega = btn.dataset.mega;
    document.querySelectorAll(".mega-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.mega === state.mega));
    render();
  });
});

// ---------- move category filter ----------
document.querySelectorAll(".cat-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cat = btn.dataset.cat;
    state.moveCategory = state.moveCategory === cat ? null : cat;
    document.querySelectorAll(".cat-chip").forEach((b) =>
      b.classList.toggle("active", b.dataset.cat === state.moveCategory));
    const input = document.getElementById("move-input");
    input.focus();
    movePicker.update();
  });
});

// ---------- format selector ----------
document.querySelectorAll(".format-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.format = btn.dataset.format;
    document.querySelectorAll(".format-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.format === state.format));
    render();
  });
});

// ---------- IV toggle ----------
document.getElementById("iv-toggle").addEventListener("change", (e) => {
  state.lv50 = e.target.checked;
  document.getElementById("stat-mode-label").textContent =
    state.lv50 ? "Minimum stats at Lv. 50 (31 IVs, neutral)" : "Minimum base stats";
  render();
});

// ---------- stat inputs ----------
document.querySelectorAll("#stat-inputs input").forEach((input) => {
  input.addEventListener("input", () => {
    const stat = input.dataset.stat;
    const val = parseInt(input.value, 10);
    if (Number.isFinite(val) && val > 0) state.statMins[stat] = val;
    else delete state.statMins[stat];
    render();
  });
});

// ---------- sort & clear ----------
document.getElementById("sort-select").addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

document.getElementById("sort-dir").addEventListener("click", (e) => {
  state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
  e.target.textContent = state.sortDir === "desc" ? "↓" : "↑";
  e.target.title = state.sortDir === "desc" ? "Highest first" : "Lowest first";
  render();
});

document.getElementById("clear-all").addEventListener("click", () => {
  state.nameQuery = [];
  state.types = [];
  state.excludeTypes = [];
  state.mega = "all";
  state.moves = [];
  state.ability = null;
  state.statMins = {};
  state.moveCategory = null;
  document.getElementById("name-input").value = "";
  document.querySelectorAll(".type-chip, .cat-chip").forEach((b) => b.classList.remove("active", "exclude"));
  document.querySelectorAll(".mega-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mega === "all"));
  document.querySelectorAll("#stat-inputs input").forEach((i) => (i.value = ""));
  renderSelectedChips();
  render();
});
