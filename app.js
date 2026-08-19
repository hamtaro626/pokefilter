// PokéFilter — client-side filtering over data/pokemon.json

const TYPE_COLORS = {
  Normal: "#A8A77A", Fire: "#EE8130", Water: "#6390F0", Electric: "#F7D02C",
  Grass: "#7AC74C", Ice: "#96D9D6", Fighting: "#C22E28", Poison: "#A33EA1",
  Ground: "#E2BF65", Flying: "#A98FF3", Psychic: "#F95587", Bug: "#A6B91A",
  Rock: "#B6A136", Ghost: "#735797", Dragon: "#6F35FC", Dark: "#705746",
  Steel: "#B7B7CE", Fairy: "#D685AD",
};

const CATEGORY_COLORS = { Physical: "#C22E28", Special: "#6390F0", Status: "#A8A77A" };

const SPRITE_BASE = "https://play.pokemonshowdown.com/sprites/gen5";
const USAGE_API = "https://championsbattledata.com/api/battle";

// ---------- state ----------
const state = {
  format: "regmb",    // "regmb" (current) | "regma"
  types: [],          // ["Dragon", "Ground"] — max 2
  moves: [],          // move ids: ["earthquake", "rockslide"]
  ability: null,      // display name: "Intimidate"
  statMins: {},       // { spe: 100, bst: 500, ... }
  moveCategory: null, // null | "Physical" | "Special" | "Status" (picker filter)
  lv50: false,        // false = base stats, true = level-50 with 31 IVs
  sort: "bst",
};

let DATA = null;        // { pokemon, moveInfo, abilityInfo }
let MOVE_LIST = [];     // [{ id, ...moveInfo }] sorted by name
let ABILITY_LIST = [];  // ["Adaptability", ...]
let expandedId = null;  // card with the usage panel open
const usageCache = {};  // "Doubles/garchomp" -> rows

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
  for (const t of state.types) if (!p.types.includes(t)) return false;
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
  results.sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name);
    const sa = displayStats(a), sb = displayStats(b);
    return sb[state.sort] - sa[state.sort];
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
    const open = container.querySelector(`[data-id="${expandedId}"] .usage-panel`);
    if (open) loadUsage(expandedId);
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
    <div class="card-top" role="button" tabindex="0" title="Click for usage stats">
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
    ${expandedId === p.id ? usagePanelHtml() : ""}`;

  el.querySelector(".card-top").addEventListener("click", () => toggleUsage(p));
  return el;
}

function typeBadge(t) {
  return `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${t}</span>`;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---------- usage stats (live from championsbattledata.com) ----------
let usageFormat = "Doubles";

function usagePanelHtml() {
  return `<div class="usage-panel">
    <div class="usage-tabs">
      ${["Doubles", "Singles"].map((f) =>
        `<button class="usage-tab ${f === usageFormat ? "active" : ""}" data-uf="${f}">${f}</button>`).join("")}
      <span class="usage-note">current season ranked</span>
    </div>
    <div class="usage-body">Loading…</div>
  </div>`;
}

function toggleUsage(p) {
  expandedId = expandedId === p.id ? null : p.id;
  render();
}

async function loadUsage(id) {
  const p = DATA.pokemon.find((x) => x.id === id);
  const panel = document.querySelector(`[data-id="${id}"] .usage-panel`);
  if (!p || !panel) return;

  panel.querySelectorAll(".usage-tab").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      usageFormat = btn.dataset.uf;
      render();
    }));

  const body = panel.querySelector(".usage-body");
  const key = `${usageFormat}/${p.baseId}`;
  try {
    if (!usageCache[key]) {
      const res = await fetch(`${USAGE_API}/${usageFormat}/${p.baseId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      usageCache[key] = (await res.json()).rows;
    }
    const rows = usageCache[key];
    const section = (cat, title, n) => {
      const items = rows.filter((r) => r.category === cat).slice(0, n);
      if (!items.length) return "";
      return `<div class="usage-col"><h3>${title}</h3>${items.map((r) =>
        `<div class="usage-row"><span>${r.name}</span><span>${r.percentage}</span></div>`).join("")}</div>`;
    };
    body.innerHTML =
      section("move", "Moves", 8) + section("ability", "Abilities", 3) + section("held_item", "Items", 5) ||
      "No ranked data for this Pokémon.";
    if (p.baseId !== p.id) {
      body.innerHTML += `<p class="usage-note">Data is for ${p.baseId} including all its forms.</p>`;
    }
  } catch (err) {
    body.textContent = "No usage data available for this Pokémon.";
  }
}

// ---------- type chips ----------
function buildTypeChips() {
  const wrap = document.getElementById("type-chips");
  for (const type of Object.keys(TYPE_COLORS)) {
    const btn = document.createElement("button");
    btn.className = "type-chip";
    btn.textContent = type;
    btn.style.background = TYPE_COLORS[type];
    btn.addEventListener("click", () => {
      const i = state.types.indexOf(type);
      if (i >= 0) state.types.splice(i, 1);
      else {
        if (state.types.length === 2) state.types.shift(); // replace oldest
        state.types.push(type);
      }
      wrap.querySelectorAll(".type-chip").forEach((b) =>
        b.classList.toggle("active", state.types.includes(b.textContent)));
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

document.getElementById("clear-all").addEventListener("click", () => {
  state.types = [];
  state.moves = [];
  state.ability = null;
  state.statMins = {};
  state.moveCategory = null;
  document.querySelectorAll(".type-chip, .cat-chip").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("#stat-inputs input").forEach((i) => (i.value = ""));
  renderSelectedChips();
  render();
});
