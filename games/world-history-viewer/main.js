import {
  REGION_LABELS, REGION_ORDER,
  ageAtYear, formatAge, peopleAliveInYear, eventsInYear, timelineForPerson,
  groupByRegion, mostSpecificEra, formatEraLabel, periodForYear,
  ageBucket, AGE_BUCKET_LABELS, sortPeopleByAge, sortPeopleByRegion,
} from "./history.js";

const DEFAULT_YEAR = 1582;
const MIN_YEAR = -3000;
const MAX_YEAR = 2100;

const els = {
  yearForm: document.getElementById("yearForm"),
  yearInput: document.getElementById("yearInput"),
  periodLabel: document.getElementById("periodLabel"),
  eraStrip: document.getElementById("eraStrip"),
  regionGrid: document.getElementById("regionGrid"),
  aliveList: document.getElementById("aliveList"),
  aliveCount: document.getElementById("aliveCount"),
  sortSeg: document.getElementById("sortSeg"),
  ageFilters: document.getElementById("ageFilters"),
  eventGroups: document.getElementById("eventGroups"),
  eventsTitle: document.getElementById("eventsTitle"),
  emptyState: document.getElementById("emptyState"),
  overlay: document.getElementById("overlay"),
  detailPanel: document.getElementById("detailPanel"),
  prevYearBtn: document.getElementById("prevYearBtn"),
  nextYearBtn: document.getElementById("nextYearBtn"),
  jumpBack1: document.getElementById("jumpBack1"),
  jumpFwd1: document.getElementById("jumpFwd1"),
  jumpBack10: document.getElementById("jumpBack10"),
  jumpFwd10: document.getElementById("jumpFwd10"),
  shareBtn: document.getElementById("shareBtn"),
};

const state = {
  data: null,
  year: DEFAULT_YEAR,
  sort: "age-asc",
  ageFilter: null,
};

function clampYear(y) {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));
}

function yearFromUrl() {
  const params = new URLSearchParams(location.search);
  const y = parseInt(params.get("year"), 10);
  return Number.isFinite(y) ? clampYear(y) : DEFAULT_YEAR;
}

function syncUrl() {
  const params = new URLSearchParams(location.search);
  params.set("year", String(state.year));
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setYear(y) {
  state.year = clampYear(y);
  els.yearInput.value = String(state.year);
  syncUrl();
  render();
}

function personById(id) {
  return state.data.people.find((p) => p.id === id);
}

// ---------- rendering ----------

function renderEraStrip() {
  const { eras } = state.data;
  els.eraStrip.innerHTML = "";
  for (const region of REGION_ORDER) {
    if (region === "other") continue;
    const era = mostSpecificEra(eras, region, state.year);
    if (!era) continue;
    const { emoji, label } = REGION_LABELS[region];
    const chip = document.createElement("div");
    chip.className = "era-chip";
    chip.dataset.region = region;
    chip.innerHTML = `<span class="flag">${emoji}</span><span>${label}: <b>${formatEraLabel(region, era, state.year)}</b></span>`;
    els.eraStrip.appendChild(chip);
  }
  els.periodLabel.innerHTML = `大分類: <b>${periodForYear(eras, state.year) ?? "不明"}</b>`;
}

function personNoteForYear(person) {
  const events = timelineForPerson(state.data.events, person.id).filter((e) => e.year === state.year);
  if (events.length === 0) return null;
  return events.map((e) => e.title).join(" / ");
}

function renderRegionCards() {
  const { people, eras } = state.data;
  const alive = peopleAliveInYear(people, state.year);
  const grouped = groupByRegion(alive);
  els.regionGrid.innerHTML = "";

  for (const region of REGION_ORDER) {
    if (region === "other" && grouped.other.length === 0) continue;
    const { emoji, label } = REGION_LABELS[region];
    const era = mostSpecificEra(eras, region, state.year);
    const card = document.createElement("section");
    card.className = "region-card";
    card.dataset.region = region;

    const peopleHtml = grouped[region].length
      ? grouped[region]
          .slice()
          .sort((a, b) => ageAtYear(b, state.year) - ageAtYear(a, state.year))
          .map((p) => {
            const note = personNoteForYear(p);
            return `
              <button class="person-mini" data-person="${p.id}">
                <div class="person-mini-top">
                  <span class="pname">${p.name}</span>
                  <span class="page mono">${formatAge(p, state.year)}</span>
                </div>
                <div class="poccupation">${p.occupation}</div>
                ${note ? `<div class="pnote">${note}</div>` : ""}
              </button>`;
          })
          .join("")
      : `<p class="empty">この年、記録されている主要人物はいません。</p>`;

    card.innerHTML = `
      <div class="region-card-head">
        <span class="name"><span class="flag">${emoji}</span>${label}</span>
      </div>
      <p class="era">${era ? formatEraLabel(region, era, state.year) : "時代区分の記録なし"}</p>
      ${peopleHtml}
    `;
    els.regionGrid.appendChild(card);
  }
}

function renderAliveList() {
  const { people } = state.data;
  let alive = peopleAliveInYear(people, state.year);

  if (state.ageFilter) {
    alive = alive.filter((p) => ageBucket(ageAtYear(p, state.year)) === state.ageFilter);
  }

  if (state.sort === "age-asc") alive = sortPeopleByAge(alive, state.year, "asc");
  else if (state.sort === "age-desc") alive = sortPeopleByAge(alive, state.year, "desc");
  else alive = sortPeopleByRegion(alive);

  els.aliveCount.textContent = `(${alive.length}人)`;
  els.aliveList.innerHTML = alive.length
    ? alive
        .map((p) => {
          const { emoji, label } = REGION_LABELS[p.region] ?? REGION_LABELS.other;
          return `
            <button class="alive-item" data-person="${p.id}" data-region="${p.region}">
              <span>
                <span class="name">${p.name}</span><br />
                <span class="region-tag">${emoji} ${label} ・ ${p.occupation}</span>
              </span>
              <span class="age mono">${formatAge(p, state.year)}</span>
            </button>`;
        })
        .join("")
    : `<p class="empty" style="grid-column:1/-1;">該当する人物はいません。</p>`;

  // age filter chips, built from who's actually alive this year (unfiltered)
  const allAlive = peopleAliveInYear(people, state.year);
  const presentBuckets = new Set(allAlive.map((p) => ageBucket(ageAtYear(p, state.year))).filter(Boolean));
  els.ageFilters.innerHTML = "";
  if (presentBuckets.size > 0) {
    const allBtn = document.createElement("button");
    allBtn.className = "filter-chip" + (state.ageFilter === null ? " active" : "");
    allBtn.textContent = "すべて";
    allBtn.addEventListener("click", () => { state.ageFilter = null; renderAliveList(); });
    els.ageFilters.appendChild(allBtn);
    for (const bucket of AGE_BUCKET_LABELS) {
      if (!presentBuckets.has(bucket)) continue;
      const btn = document.createElement("button");
      btn.className = "filter-chip" + (state.ageFilter === bucket ? " active" : "");
      btn.textContent = bucket;
      btn.addEventListener("click", () => { state.ageFilter = bucket; renderAliveList(); });
      els.ageFilters.appendChild(btn);
    }
  }
}

function renderEvents() {
  const { events } = state.data;
  const yearEvents = eventsInYear(events, state.year);
  els.eventsTitle.innerHTML = `${state.year}年の主な出来事 <span class="count">(${yearEvents.length}件)</span>`;
  const grouped = groupByRegion(yearEvents);
  els.eventGroups.innerHTML = "";

  for (const region of REGION_ORDER) {
    const list = grouped[region];
    if (!list || list.length === 0) continue;
    const { emoji, label } = REGION_LABELS[region];
    const group = document.createElement("div");
    group.className = "event-group";
    const dateStr = (e) => {
      if (e.month == null) return "";
      return e.day != null ? `${e.month}/${e.day}` : `${e.month}月`;
    };
    group.innerHTML = `
      <h3>${emoji} ${label}</h3>
      ${list
        .map((e) => {
          const peopleNames = e.people.map((pid) => personById(pid)?.name).filter(Boolean).join("・");
          return `
            <div class="event-card" data-region="${e.region}">
              <div class="ehead">
                <span class="title">${e.title}</span>
                <span class="date mono">${dateStr(e)}</span>
              </div>
              <div class="meta">${[e.location, peopleNames].filter(Boolean).join(" ・ ")}</div>
              <div class="desc">${e.description}</div>
              <button class="toggle" type="button">もっと読む</button>
            </div>`;
        })
        .join("")}
    `;
    els.eventGroups.appendChild(group);
  }

  els.eventGroups.querySelectorAll(".event-card").forEach((card) => {
    const desc = card.querySelector(".desc");
    const toggle = card.querySelector(".toggle");
    // Only show the expand affordance when the description actually clips.
    requestAnimationFrame(() => {
      if (desc.scrollHeight <= desc.clientHeight + 2) toggle.style.display = "none";
    });
    toggle.addEventListener("click", () => {
      card.classList.toggle("expanded");
      toggle.textContent = card.classList.contains("expanded") ? "閉じる" : "もっと読む";
    });
  });

  const hasAnything = yearEvents.length > 0 || peopleAliveInYear(state.data.people, state.year).length > 0;
  els.emptyState.style.display = hasAnything ? "none" : "block";
}

function render() {
  renderEraStrip();
  renderRegionCards();
  renderAliveList();
  renderEvents();
}

// ---------- person detail overlay ----------

function openPersonDetail(personId) {
  const person = personById(personId);
  if (!person) return;
  const timeline = timelineForPerson(state.data.events, personId);

  els.detailPanel.innerHTML = `
    <button class="detail-close" id="detailClose" aria-label="閉じる">×</button>
    <div class="detail-head">
      <p class="name">${person.name}</p>
      <p class="years mono">${person.birthYear}${person.approx ? "頃" : ""} – ${person.deathYear ?? "?"}</p>
      <span class="occupation">${person.occupation}</span>
      <p class="desc">${person.description}</p>
    </div>
    <ul class="timeline">
      ${timeline
        .map((e) => {
          const age = ageAtYear(person, e.year);
          const isCurrent = e.year === state.year;
          return `
            <li class="${isCurrent ? "current" : ""}">
              <span class="tyear mono">${e.year}</span>
              <span class="tdot"></span>
              <span class="tbody">
                <span class="tage mono">${age !== null ? (person.approx ? `約${age}歳` : `${age}歳`) : ""}</span>
                <div class="ttitle">${e.title}</div>
              </span>
            </li>`;
        })
        .join("")}
    </ul>
  `;
  els.overlay.classList.add("show");
  document.getElementById("detailClose").addEventListener("click", closePersonDetail);
  const currentLi = els.detailPanel.querySelector("li.current");
  if (currentLi) currentLi.scrollIntoView({ block: "center" });
}

function closePersonDetail() {
  els.overlay.classList.remove("show");
}

els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) closePersonDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePersonDetail();
});

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-person]");
  if (trigger) openPersonDetail(trigger.dataset.person);
});

// ---------- navigation wiring ----------

els.yearForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const y = parseInt(els.yearInput.value, 10);
  if (Number.isFinite(y)) setYear(y);
});
els.prevYearBtn.addEventListener("click", () => setYear(state.year - 1));
els.nextYearBtn.addEventListener("click", () => setYear(state.year + 1));
els.jumpBack1.addEventListener("click", () => setYear(state.year - 1));
els.jumpFwd1.addEventListener("click", () => setYear(state.year + 1));
els.jumpBack10.addEventListener("click", () => setYear(state.year - 10));
els.jumpFwd10.addEventListener("click", () => setYear(state.year + 10));

els.sortSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sort]");
  if (!btn) return;
  state.sort = btn.dataset.sort;
  els.sortSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  renderAliveList();
});

els.shareBtn.addEventListener("click", async () => {
  syncUrl();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    const original = els.shareBtn.textContent;
    els.shareBtn.textContent = "コピーしました";
    setTimeout(() => { els.shareBtn.textContent = original; }, 1400);
  } catch {
    window.prompt("このURLをコピーしてください:", url);
  }
});

window.addEventListener("popstate", () => setYear(yearFromUrl()));

// ---------- boot ----------

fetch("./data.json")
  .then((res) => res.json())
  .then((data) => {
    state.data = data;
    state.year = yearFromUrl();
    els.yearInput.value = String(state.year);
    syncUrl();
    render();
  });
