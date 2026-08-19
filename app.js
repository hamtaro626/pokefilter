// PokéFilter — client-side filtering over data/pokemon.json

const TYPE_COLORS = {
  Normal: "#A8A77A", Fire: "#EE8130", Water: "#6390F0", Electric: "#F7D02C",
  Grass: "#7AC74C", Ice: "#96D9D6", Fighting: "#C22E28", Poison: "#A33EA1",
  Ground: "#E2BF65", Flying: "#A98FF3", Psychic: "#F95587", Bug: "#A6B91A",
  Rock: "#B6A136", Ghost: "#735797", Dragon: "#6F35FC", Dark: "#705746",
  Steel: "#B7B7CE", Fairy: "#D685AD",
};

const SPRITE_BASE = "https://play.pokemonshowdown.com/sprites/gen5";

// ---------- state ----------
const state = {
  types: [],          // ["Dragon", "Ground"] — max 2
  moves: [],          // move ids: ["earthquake", "rockslide"]
  ability: null,      // display name: "Intimidate"
  statMins: {},       // { spe: 100, bst: 500, ... }
  sort: "bst",
};

let DATA = null;        // { pokemon, moveNames }
let MOVE_LIST = [];     // [{ id, name }] sorted by name
let ABILITY_LIST = [];  // ["Adaptability", ...]

// ---------- boot ----------
fetch("data/pokemon.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    MOVE_LIST = Object.entries(data.moveNames)
      .map(([id, name]) => ({ id, name }))
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

// ---------- filtering ----------
function matches(p) {
  for (const t of state.types) if (!p.types.includes(t)) return false;
  for (const m of state.moves) if (!p.moves.includes(m)) return false;
  if (state.ability && !p.abilities.includes(state.ability)) return false;
  for (const [stat, min] of Object.entries(state.statMins)) {
    const val = stat === "bst" ? p.bst : p.stats[stat];
    if (val < min) return false;
  }
  return true;
}

function render() {
  const results = DATA.pokemon.filter(matches);
  results.sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name);
    if (state.sort === "bst") return b.bst - a.bst;
    return b.stats[state.sort] - a.stats[state.sort];
  });

  document.getElementById("result-count").textContent =
    `${results.length} of ${DATA.pokemon.length} Pokémon match`;

  const container = document.getElementById("results");
  container.innerHTML = "";
  if (results.length === 0) {
    container.innerHTML = `<p class="empty">No Pokémon in Champions matches all of those filters. Try removing one.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const p of results) frag.appendChild(card(p));
  container.appendChild(frag);
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

  const statRows = STAT_ROWS.map(([key, label]) => {
    const v = p.stats[key];
    const pct = Math.min(100, (v / 200) * 100);
    const color = v >= 120 ? "#7AC74C" : v >= 90 ? "#F7D02C" : v >= 60 ? "#EE8130" : "#C22E28";
    return `<div class="stat-row">
      <span class="label">${label}</span><span class="value">${v}</span>
      <div class="stat-bar"><span style="width:${pct}%;background:${color}"></span></div>
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="card-top">
      <img src="${SPRITE_BASE}/${p.sprite}.png" alt="" loading="lazy"
           data-fb="${fallbackSprite(p.name)}"
           onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb}else{this.style.visibility='hidden'}">
      <div>
        <div class="card-name">${p.name}<span class="card-tier">${p.tier}</span></div>
        <div class="card-types">${p.types.map(typeBadge).join("")}</div>
        <div class="card-abilities">${p.abilities.join(" · ")}</div>
      </div>
    </div>
    <div class="card-stats">${statRows}</div>
    <div class="card-bst">BST ${p.bst}</div>`;
  return el;
}

function typeBadge(t) {
  return `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${t}</span>`;
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
function setupPicker({ inputId, listId, getOptions, onPick }) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let highlighted = -1;

  function close() { list.hidden = true; highlighted = -1; }

  function update() {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const opts = getOptions(q).slice(0, 12);
    if (opts.length === 0) return close();
    list.innerHTML = "";
    opts.forEach((opt) => {
      const li = document.createElement("li");
      li.textContent = opt.label;
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = highlighted >= 0 ? highlighted : 0;
      items[idx].dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      close();
    }
  });
}

setupPicker({
  inputId: "move-input",
  listId: "move-suggestions",
  getOptions: (q) =>
    MOVE_LIST.filter((m) => m.name.toLowerCase().includes(q) && !state.moves.includes(m.id))
      .map((m) => ({ label: m.name, id: m.id })),
  onPick: (opt) => {
    state.moves.push(opt.id);
    renderSelectedChips();
  },
});

setupPicker({
  inputId: "ability-input",
  listId: "ability-suggestions",
  getOptions: (q) =>
    ABILITY_LIST.filter((a) => a.toLowerCase().includes(q))
      .map((a) => ({ label: a })),
  onPick: (opt) => {
    state.ability = opt.label; // single-select: replaces previous
    renderSelectedChips();
  },
});

function renderSelectedChips() {
  const moveWrap = document.getElementById("move-selected");
  moveWrap.innerHTML = "";
  for (const id of state.moves) {
    const chip = document.createElement("button");
    chip.className = "selected-chip";
    chip.textContent = DATA.moveNames[id];
    chip.title = "Remove";
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
    chip.title = "Remove";
    chip.addEventListener("click", () => {
      state.ability = null;
      renderSelectedChips();
      render();
    });
    abilityWrap.appendChild(chip);
  }
}

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
  document.querySelectorAll(".type-chip").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("#stat-inputs input").forEach((i) => (i.value = ""));
  renderSelectedChips();
  render();
});
