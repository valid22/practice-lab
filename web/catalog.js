import { companyTags } from "/companies.js";

const $ = (id) => document.getElementById(id);
const filters = $("catalog-filters");
const controls = Array.from(filters.elements);
const difficultyRank = new Map([["Easy", 1], ["Medium", 2], ["Hard", 3]]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let problems = [];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function tags(names) {
  const group = element("div", undefined, "tag-group");
  for (const name of names) group.append(element("span", name, "topic"));
  return group;
}

function difficultyBadge(difficulty) {
  const color = (difficulty || "").toLowerCase();
  const style = difficultyRank.has(difficulty) ? " " + color : "";
  return element("span", difficulty || "Unrated", "badge" + style);
}

function problemRow(problem, listQuery) {
  const row = element("tr");
  const title = element("th");
  title.scope = "row";
  const link = element("a", problem.title, "problem-link");
  link.href = "/problems/" + encodeURIComponent(problem.id) +
    (listQuery ? "?" + new URLSearchParams({ list: listQuery }) : "");
  title.append(link);
  row.append(title);
  const cells = [
    companyTags(problem.companies),
    difficultyBadge(problem.difficulty),
    tags(problem.topics),
    element("span", problem.completed ? "Completed" : "To do", problem.completed ? "badge passed" : "catalog-status"),
  ];
  for (const item of cells) {
    const cell = element("td");
    cell.append(item);
    row.append(cell);
  }
  return row;
}

function selectOptions(control, options) {
  const defaultOption = control.options[0];
  control.replaceChildren(defaultOption);
  for (const [value, label] of options) {
    const option = element("option", label);
    option.value = value;
    control.append(option);
  }
}

function facetOptions(items) {
  return [...new Set(items.filter(Boolean))].sort(collator.compare).map((name) => [name, name]);
}

function render() {
  const params = new URLSearchParams();
  for (const control of controls) {
    if (control.value) params.set(control.name, control.value);
  }
  const listQuery = params.toString();
  const url = "/" + (listQuery ? "?" + listQuery : "");
  if (url !== location.pathname + location.search) history.replaceState(null, "", url);

  const terms = $("search").value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const company = $("company").value;
  const difficulty = $("difficulty").value;
  const topic = $("topic").value;
  const status = $("status").value;
  const visible = problems.filter((problem) => {
    const searchable = [problem.title, ...problem.topics, ...problem.companies.map((tag) => tag.name)].join(" ").toLowerCase();
    return terms.every((term) => searchable.includes(term)) &&
      (!company || problem.companies.some((tag) => tag.id === company)) &&
      (!difficulty || problem.difficulty === difficulty) &&
      (!topic || problem.topics.includes(topic)) &&
      (!status || problem.completed === (status === "done"));
  });

  const byTitle = (a, b) => collator.compare(a.title, b.title);
  const rank = (problem) => difficultyRank.get(problem.difficulty);
  const byDifficulty = (a, b, direction) => {
    if (!rank(a) || !rank(b)) return Number(Boolean(rank(b))) - Number(Boolean(rank(a))) || byTitle(a, b);
    return direction * (rank(a) - rank(b)) || byTitle(a, b);
  };
  const sorters = {
    title: byTitle,
    easy: (a, b) => byDifficulty(a, b, 1),
    hard: (a, b) => byDifficulty(a, b, -1),
    done: (a, b) => Number(b.completed) - Number(a.completed) || byTitle(a, b),
  };
  if (Object.hasOwn(sorters, $("sort").value)) visible.sort(sorters[$("sort").value]);

  $("catalog-count").textContent = visible.length + (visible.length === 1 ? " problem" : " problems");
  $("clear-filters").hidden = !listQuery;
  $("catalog-results").hidden = visible.length === 0;
  $("catalog-empty").hidden = visible.length !== 0;
  $("catalog-empty").textContent = problems.length ? "No problems match your search and filters." : "There are no problems in the catalog yet.";
  $("catalog-rows").replaceChildren(...visible.map((problem) => problemRow(problem, listQuery)));
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/library");
    if (!response.ok) throw new Error("The problem catalog could not be loaded.");
    ({ problems } = await response.json());
    const companies = new Map(problems.flatMap((problem) => problem.companies.map((company) => [company.id, company.name])));
    selectOptions($("company"), [...companies].sort((a, b) => collator.compare(a[1], b[1])));
    selectOptions($("difficulty"), facetOptions(problems.map((problem) => problem.difficulty))
      .sort((a, b) => (difficultyRank.get(a[0]) ?? 4) - (difficultyRank.get(b[0]) ?? 4)));
    selectOptions($("topic"), facetOptions(problems.flatMap((problem) => problem.topics)));
    const query = new URLSearchParams(location.search);
    for (const control of controls) {
      const value = query.get(control.name) || "";
      if (control.tagName === "INPUT" || Array.from(control.options).some((option) => option.value === value)) {
        control.value = value;
      }
      control.disabled = false;
    }
    const completed = problems.filter((problem) => problem.completed).length;
    $("catalog-progress").textContent = completed + " of " + problems.length + " completed";
    $("catalog-progress").hidden = !problems.length;
    render();
  } catch {
    $("catalog-count").textContent = "The problem catalog could not be loaded. Reload this page to try again.";
  }
}

filters.addEventListener("submit", (event) => event.preventDefault());
filters.addEventListener("input", render);
$("clear-filters").addEventListener("click", () => {
  filters.reset();
  render();
  $("search").focus();
});
for (const control of controls) control.disabled = true;
window.addEventListener("pageshow", (event) => {
  if (event.persisted) loadCatalog();
});
loadCatalog();
