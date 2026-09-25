// Pure, DOM/fetch-independent query functions over the { people, events, eras }
// dataset. Runnable directly under Node for unit testing.

export const REGION_LABELS = {
  japan: { emoji: "🇯🇵", label: "日本" },
  china: { emoji: "🇨🇳", label: "中国" },
  europe: { emoji: "🇪🇺", label: "ヨーロッパ" },
  middleeast: { emoji: "🕌", label: "中東" },
  other: { emoji: "🌏", label: "その他" },
};

export const REGION_ORDER = ["japan", "china", "europe", "middleeast", "other"];

// Age in the given year, using simple year subtraction (the app's only time
// unit is a calendar year, so an exact birthday-aware age can't be derived
// from the query itself). Returns null before birth or after death.
// `approx` on the returned object mirrors person.approx: a birth year that
// is itself uncertain, not just the lack of day-level precision.
export function ageAtYear(person, year) {
  if (year < person.birthYear) return null;
  if (person.deathYear != null && year > person.deathYear) return null;
  return year - person.birthYear;
}

export function formatAge(person, year) {
  const age = ageAtYear(person, year);
  if (age === null) return null;
  return person.approx ? `約${age}歳` : `${age}歳`;
}

export function isAlive(person, year) {
  return ageAtYear(person, year) !== null;
}

export function peopleAliveInYear(people, year) {
  return people.filter((p) => isAlive(p, year));
}

export function eventsInYear(events, year) {
  return events
    .filter((e) => e.year === year)
    .slice()
    .sort((a, b) => (a.month ?? 99) - (b.month ?? 99) || (a.day ?? 99) - (b.day ?? 99));
}

export function timelineForPerson(events, personId) {
  return events
    .filter((e) => e.people.includes(personId))
    .slice()
    .sort((a, b) => a.year - b.year || (a.month ?? 99) - (b.month ?? 99) || (a.day ?? 99) - (b.day ?? 99));
}

export function groupByRegion(items) {
  const groups = {};
  for (const region of REGION_ORDER) groups[region] = [];
  for (const item of items) {
    const region = REGION_LABELS[item.region] ? item.region : "other";
    if (!groups[region]) groups[region] = [];
    groups[region].push(item);
  }
  return groups;
}

// The era(s) covering `year` for a region, narrowest span first, so a
// nested sub-era (e.g. a reign within a dynasty) is preferred over its
// broader parent when both match.
export function erasForYear(eras, region, year) {
  return eras
    .filter((e) => e.region === region && year >= e.startYear && year < e.endYear)
    .sort((a, b) => (a.endYear - a.startYear) - (b.endYear - b.startYear));
}

export function mostSpecificEra(eras, region, year) {
  const matches = erasForYear(eras, region, year);
  return matches.length > 0 ? matches[0] : null;
}

// Broadest global-history bucket (古代/中世/近世/近代/現代) for a year,
// independent of region, derived from the era table's own `period` tags
// so it stays data-driven rather than a second hardcoded breakpoint list.
// Uses the Japan era table as the reference timeline since it has full
// coverage back to prehistory.
export function periodForYear(eras, year) {
  const era = mostSpecificEra(eras, "japan", year);
  return era ? era.period : null;
}

// Human-readable era label. Japan shows the era name bare; a reign-style
// China era (with reignStartYear) is rendered as "王朝・元号N年"; other
// regions are shown as "大分類・era名" to give both scales at a glance.
export function formatEraLabel(region, era, year) {
  if (!era) return "記録なし";
  if (era.reignStartYear != null) {
    const reignYear = year - era.reignStartYear + 1;
    return `${era.dynastyName}・${era.reignName}${reignYear}年`;
  }
  if (region === "japan") return era.name;
  return `${era.period}・${era.name}`;
}

export function eraSummaryForYear(eras, region, year) {
  const era = mostSpecificEra(eras, region, year);
  return formatEraLabel(region, era, year);
}

const DECADE_BUCKETS = [
  [0, 19, "10代以下"],
  [20, 29, "20代"],
  [30, 39, "30代"],
  [40, 49, "40代"],
  [50, 59, "50代"],
  [60, 69, "60代"],
  [70, Infinity, "70代以上"],
];

export function ageBucket(age) {
  if (age === null || age === undefined) return null;
  const bucket = DECADE_BUCKETS.find(([min, max]) => age >= min && age <= max);
  return bucket ? bucket[2] : null;
}

export const AGE_BUCKET_LABELS = DECADE_BUCKETS.map((b) => b[2]);

export function sortPeopleByAge(people, year, direction = "asc") {
  const withAge = people.map((p) => ({ person: p, age: ageAtYear(p, year) }));
  withAge.sort((a, b) => (direction === "asc" ? a.age - b.age : b.age - a.age));
  return withAge.map((x) => x.person);
}

export function sortPeopleByRegion(people) {
  return people.slice().sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));
}
