import { companyTags } from "/companies.js";

const $ = (id) => document.getElementById(id);
const code = $("code");
const content = $("test-content");
const tabs = [...document.querySelectorAll("[data-tab]")];
const state = {
  problem: null, token: null, tab: "samples",
  sample: 0, hidden: 0, custom: 0, result: 0, cases: [], output: null, busy: false,
};
const labels = { samples: "Public tests", custom: "Custom tests", all: "Public + custom", submission: "Submission", snapshot: "Saved code" };
let noticeTimer;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className = "button") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function announce(message) {
  const notice = $("notice");
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4400);
}

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Practice-Token": state.token },
    body: JSON.stringify(body),
  };
  const response = await fetch("/api/" + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function stored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function storageKey(kind) {
  return "practice-lab:" + state.problem.id + ":function:" + kind;
}

function appendInline(node, text) {
  const pattern = /\x60([^\x60]+)\x60|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(text.slice(cursor, match.index));
    if (match[4]) {
      const link = element("a", match[4]);
      link.href = match[5];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.append(link);
    } else {
      const [tag, value] = match[1] ? ["code", match[1]] : match[2] ? ["strong", match[2]] : ["em", match[3]];
      node.append(element(tag, value));
    }
    cursor = match.index + match[0].length;
  }
  node.append(text.slice(cursor));
}

function renderMarkdown(text, target) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fence = /^\s*(\x60{3,}|~{3,})/;
  const heading = /^(#{1,6})\s+(.+)/;
  const listItem = /^\s*([-+*]|\d+\.)\s+(.+)/;
  target.replaceChildren();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    if (!line.trim()) continue;
    const marker = line.match(fence);
    const title = line.match(heading);
    const item = line.match(listItem);
    if (marker) {
      const body = [];
      while (index < lines.length && !lines[index].trimStart().startsWith(marker[1])) {
        body.push(lines[index++]);
      }
      index++;
      target.append(element("pre", body.join("\n")));
    } else if (title) {
      const node = element("h" + Math.min(6, title[1].length + 1));
      appendInline(node, title[2]);
      target.append(node);
    } else if (item) {
      const ordered = /\d/.test(item[1]);
      const list = element(ordered ? "ol" : "ul");
      let entry = item;
      while (entry && /\d/.test(entry[1]) === ordered) {
        const li = element("li");
        appendInline(li, entry[2]);
        list.append(li);
        entry = lines[index]?.match(listItem);
        if (entry && /\d/.test(entry[1]) === ordered) index++;
      }
      target.append(list);
    } else {
      const paragraph = [line.trim()];
      while (lines[index]?.trim() && ![fence, heading, listItem].some((pattern) => pattern.test(lines[index]))) {
        paragraph.push(lines[index++].trim());
      }
      const node = element("p");
      appendInline(node, paragraph.join(" "));
      target.append(node);
    }
  }
}

function caseBox(label, value, full = false) {
  const box = element("div", undefined, full ? "case-box full" : "case-box");
  box.append(element("h3", label), element("pre", value === "" ? "(empty)" : value));
  return box;
}

function caseGrid(test) {
  const grid = element("div", undefined, "case-grid");
  grid.append(caseBox("Arguments", test.input));
  if (test.expected !== null) grid.append(caseBox("Expected return", test.expected));
  return grid;
}

function renderProblem() {
  const problem = state.problem;
  $("problem-title").textContent = problem.title;
  const labelsNode = $("problem-labels");
  labelsNode.replaceChildren(element("span", problem.source ? "Reconstructed practice" : "Imported problem",
    problem.source ? "badge reconstructed" : "badge"));
  if (problem.companies.length) labelsNode.append(companyTags(problem.companies, true));
  if (problem.difficulty) {
    const difficulty = element("span", problem.difficulty, "badge");
    if (["easy", "medium", "hard"].includes(problem.difficulty.toLowerCase())) {
      difficulty.classList.add(problem.difficulty.toLowerCase());
    }
    labelsNode.append(difficulty);
  }
  $("topics").replaceChildren(...problem.topics.map((topic) => element("span", topic, "topic")));
  renderMarkdown(problem.statement, $("statement"));
  const examples = $("examples");
  examples.replaceChildren();
  if (problem.samples.length) examples.append(element("h2", "Examples"));
  problem.samples.forEach((test, index) => {
    const details = element("details");
    details.open = index === 0;
    details.append(element("summary", test.name), caseGrid(test));
    examples.append(details);
  });
  $("source-note").hidden = !problem.source;
  if (problem.source) $("source").href = problem.source;
  $("sample-count").textContent = problem.samples.length ? String(problem.samples.length) : "";
  document.querySelector(".statement").scrollTop = 0;
}

function openProblem(problem) {
  state.problem = problem;
  document.title = problem.title + " · Practice Lab";
  state.cases = stored(storageKey("custom"), []);
  const legacyDraft = stored("practice-lab:" + problem.id + ":draft", null);
  code.value = stored(storageKey("draft"), legacyDraft ?? problem.starter);
  code.setSelectionRange(0, 0);
  code.scrollTo(0, 0);
  $("draft-status").textContent = legacyDraft !== null && code.value === legacyDraft ?
    "Older draft · update to a function" : "Draft autosaves";
  $("run-scope").value = problem.samples.length ? "samples" : "custom";
  renderProblem();
  refreshEditor();
  setTab(problem.samples.length ? "samples" : "custom");
}

const tokenPattern = /#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b|\b\d+(?:\.\d+)?\b/g;

function refreshEditor() {
  const text = code.value;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    fragment.append(text.slice(cursor, match.index));
    const first = match[0][0];
    const kind = first === "#" ? "comment" : ['"', "'"].includes(first) ? "string" :
      /\d/.test(first) ? "number" : "keyword";
    fragment.append(element("span", match[0], "syn-" + kind));
    cursor = match.index + match[0].length;
  }
  fragment.append(text.slice(cursor) + "\n");
  $("highlight").replaceChildren(fragment);
  const lineCount = text.split("\n").length;
  $("line-gutter").textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n") + "\n";
  syncScroll();
  showPosition();
}

function syncScroll() {
  $("highlight").scrollTop = code.scrollTop;
  $("highlight").scrollLeft = code.scrollLeft;
  $("line-gutter").scrollTop = code.scrollTop;
}

function showPosition() {
  const lines = code.value.slice(0, code.selectionEnd).split("\n");
  $("position").textContent = "Ln " + lines.length + ", Col " + (lines.at(-1).length + 1);
}

function updateDraft() {
  if (!state.problem) return;
  $("draft-status").textContent = store(storageKey("draft"), code.value) ? "Draft saved" : "Draft storage unavailable";
  refreshEditor();
}

code.addEventListener("input", updateDraft);
code.addEventListener("scroll", syncScroll);
for (const name of ["click", "keyup", "select", "focus"]) code.addEventListener(name, showPosition);
let allowTab = false;
code.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    allowTab = true;
    return;
  }
  if (event.key === "Tab" && (allowTab || event.shiftKey)) {
    allowTab = false;
    return;
  }
  allowTab = false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (event.key === "Tab" || event.key === "Enter") {
    const before = code.value.slice(0, code.selectionStart);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const indent = line.match(/^\s*/)[0];
    const insertion = event.key === "Tab" ? "    " : "\n" + indent + (line.trimEnd().endsWith(":") ? "    " : "");
    event.preventDefault();
    // insertText preserves the native undo stack where supported.
    if (!document.execCommand("insertText", false, insertion)) {
      code.setRangeText(insertion, code.selectionStart, code.selectionEnd, "end");
      updateDraft();
    }
  }
});

function setTab(tab) {
  state.tab = tab;
  for (const control of tabs) {
    const selected = control.dataset.tab === tab;
    control.setAttribute("aria-selected", String(selected));
    control.tabIndex = selected ? 0 : -1;
  }
  content.setAttribute("aria-labelledby", "tab-" + tab);
  content.scrollTop = 0;
  renderView();
}

tabs.forEach((control, index) => {
  control.addEventListener("click", () => setTab(control.dataset.tab));
  control.addEventListener("keydown", (event) => {
    const positions = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length,
      Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    const target = tabs[positions[event.key]];
    setTab(target.dataset.tab);
    target.focus();
  });
});

function updateButtons() {
  const samples = Boolean(state.problem?.samples.length);
  const custom = Boolean(state.cases.length);
  const select = $("run-scope");
  select.options[0].disabled = !samples;
  select.options[1].disabled = !custom;
  select.options[2].disabled = !samples && !custom;
  if (select.options[select.selectedIndex]?.disabled) {
    if (samples) select.value = "samples";
    else if (custom) select.value = "custom";
  }
  select.disabled = state.busy || (!samples && !custom);
  $("run").disabled = select.disabled;
  $("save").disabled = state.busy || !state.problem;
  $("submit").disabled = state.busy || !state.problem?.hidden_count;
  $("reset").disabled = !state.problem;
  code.disabled = !state.problem;
}

function caseTabs(cases, current, onSelect) {
  const bar = element("div", undefined, "case-tabs");
  cases.forEach((test, index) => {
    const tab = button("Case " + (index + 1), () => {
      onSelect(index);
      content.querySelectorAll(".case-tabs button")[index]?.focus();
    }, "");
    tab.setAttribute("aria-pressed", String(current === index));
    if (test.name) tab.title = test.name;
    bar.append(tab);
  });
  return bar;
}

function renderSamples() {
  const samples = state.problem.samples;
  const test = samples[state.sample];
  if (!test) {
    content.append(element("p", "This problem has no public cases. Add a case in Custom to try your function.", "empty"));
    return;
  }
  content.append(caseTabs(samples, state.sample, (index) => {
    state.sample = index;
    renderView();
  }), element("h3", test.name, "case-title"), caseGrid(test));
}

function renderHidden() {
  const problem = state.problem;
  if (!problem.hidden_count) {
    content.append(element("p", "This problem has no hidden cases.", "empty"));
    return;
  }
  if (!problem.completed) {
    content.append(element("p", problem.hidden_count + " hidden cases. Pass a submission to unlock their inputs and expected returns.", "empty"));
    return;
  }
  const test = problem.hidden[state.hidden];
  content.append(caseTabs(problem.hidden, state.hidden, (index) => {
    state.hidden = index;
    renderView();
  }), element("h3", test.name, "case-title"), caseGrid(test));
}

function persistCases() {
  if (!store(storageKey("custom"), state.cases)) announce("Custom tests could not be saved in this browser.");
  updateButtons();
}

function customField(label, value, type, limit, update) {
  const wrapper = element("label", label);
  const control = element(type);
  control.value = value;
  control.maxLength = limit;
  if (type === "textarea") {
    control.rows = 3;
    control.spellcheck = false;
  }
  control.addEventListener("input", () => { update(control.value); persistCases(); });
  wrapper.append(control);
  return wrapper;
}

function renderCustom() {
  const test = state.cases[state.custom];
  const controls = element("div", undefined, "custom-controls");
  const add = button("＋ Add test", () => {
    state.cases.push({ name: "Custom " + (state.cases.length + 1), input: "[]", expected: null });
    state.custom = state.cases.length - 1;
    persistCases();
    $("run-scope").value = "custom";
    renderView();
    content.querySelector("textarea")?.focus();
  });
  add.disabled = state.cases.length >= 20;
  controls.append(caseTabs(state.cases, state.custom, (index) => {
    state.custom = index;
    renderView();
  }), add);
  content.append(controls);
  if (!test) {
    content.append(element("p", "Pass positional arguments as a JSON array. You can also check the return value.", "empty"));
    return;
  }
  const name = customField("Test name", test.name, "input", 100, (value) => { test.name = value; });
  name.classList.add("custom-name");
  const grid = element("div", undefined, "case-grid");
  const argumentsField = customField("Arguments (JSON array)", test.input, "textarea", 32000, (value) => { test.input = value; });
  const expected = customField("Expected return (JSON)", test.expected ?? "", "textarea", 32000, (value) => { test.expected = value; });
  expected.hidden = test.expected === null;
  grid.append(argumentsField, expected);
  const check = element("input");
  check.type = "checkbox";
  check.checked = test.expected !== null;
  check.addEventListener("change", () => {
    test.expected = check.checked ? expected.querySelector("textarea").value : null;
    expected.hidden = !check.checked;
    persistCases();
  });
  const checkLabel = element("label", undefined, "check-label");
  checkLabel.append(check, "Check expected return");
  const remove = button("Remove test", () => {
    state.cases.splice(state.custom, 1);
    state.custom = Math.max(0, Math.min(state.custom, state.cases.length - 1));
    persistCases();
    renderView();
    content.querySelector(".custom-controls > .button")?.focus();
  }, "text-button");
  content.append(name, grid, checkLabel, remove);
}

function renderResults() {
  if (state.running) {
    content.append(element("p", "Running tests…", "empty"));
    return;
  }
  const run = state.output;
  if (!run) {
    content.append(element("p", "Run tests to see feedback here, or open a saved run in Attempts.", "empty"));
    return;
  }
  if (run.error) {
    content.append(element("p", run.error, "form-error"));
    return;
  }
  const results = run.results;
  const selected = results[state.result] || results[0];
  const publicResults = results.filter((result) => !result.hidden);
  const checked = publicResults.filter((result) => result.expected !== null).length;
  const passed = publicResults.filter((result) => result.status === "Passed").length;
  const head = element("div", undefined, "result-head");
  const summary = checked ? passed + "/" + checked + (run.hidden_summary ? " public checks passed" : " checks passed") :
    publicResults.length + " runs";
  head.append(element("h3", summary, "case-title"), element("small", "Attempt #" + run.id, "muted"));
  if (run.hidden_summary) {
    const { passed: hiddenPassed, total } = run.hidden_summary;
    head.append(element("span", hiddenPassed + "/" + total + " hidden checks passed", "badge"));
  }
  content.append(head);
  if (!selected) return;
  const statusRow = element("div", undefined, "result-head");
  const kind = selected.status === "Passed" ? "passed" : selected.status === "Ran" ? "" :
    selected.status.endsWith("limit") ? "warning" : "failed";
  statusRow.append(element("strong", (selected.hidden ? "Hidden · " : "") + (selected.name || "Test case")),
    element("span", selected.status + " · " + selected.elapsed_ms + " ms", "badge " + kind));
  const grid = caseGrid(selected);
  if ("returned" in selected) {
    grid.append(caseBox("Your return", selected.returned, true));
    if (selected.stdout) grid.append(caseBox("Printed output", selected.stdout, true));
  } else {
    grid.append(caseBox("Your output", selected.stdout, true));
  }
  if (selected.stderr) grid.append(caseBox("Standard error", selected.stderr, true));
  content.append(caseTabs(results, state.result, (index) => {
    state.result = index;
    renderView();
  }), statusRow, grid);
}

let historyRequest = 0;
async function renderHistory() {
  const id = state.problem.id;
  const request = ++historyRequest;
  content.append(element("p", "Loading attempts…", "empty"));
  try {
    const history = await api("problems/" + id + "/attempts");
    if (state.problem.id !== id || state.tab !== "history" || request !== historyRequest) return;
    content.replaceChildren();
    if (!history.length) content.append(element("p", "Run a test or save a code snapshot to start your history.", "empty"));
    for (const attempt of history) {
      const row = element("div", undefined, "history-item");
      const description = element("div");
      description.append(element("strong", labels[attempt.scope] || "Attempt"),
        element("small", new Date(attempt.created).toLocaleString() + (attempt.total ? " · " +
          (attempt.checked ? attempt.passed + "/" + attempt.checked + " passed" : attempt.total + " cases") : "")));
      const actions = element("div", undefined, "history-actions");
      if (attempt.total) actions.append(button("Results", () => loadAttempt(attempt.id, false)));
      actions.append(button("Restore code", () => loadAttempt(attempt.id, true)));
      row.append(description, actions);
      content.append(row);
    }
  } catch (error) {
    if (state.problem.id === id && state.tab === "history" && request === historyRequest) {
      content.replaceChildren(element("p", error.message, "form-error"));
    }
  }
}

async function loadAttempt(attemptId, restore) {
  const problem = state.problem;
  try {
    const attempt = await api("problems/" + problem.id + "/attempts/" + attemptId);
    if (state.problem !== problem || state.tab !== "history") return;
    if (restore) {
      if (code.value !== attempt.code && !window.confirm("Replace the editor draft with this saved attempt?")) return;
      code.value = attempt.code;
      code.setSelectionRange(0, 0);
      updateDraft();
      code.focus();
      announce("Restored attempt #" + attempt.id + ".");
    } else {
      state.output = attempt;
      state.result = 0;
      setTab("results");
      $("tab-results").focus();
    }
  } catch (error) {
    announce(error.message);
  }
}

function renderView() {
  updateButtons();
  content.replaceChildren();
  if (!state.problem) return;
  const views = { samples: renderSamples, hidden: renderHidden, custom: renderCustom, results: renderResults, history: renderHistory };
  views[state.tab]();
}

async function saveAttempt(action) {
  const run = action !== "save";
  const trigger = $(action);
  if (state.busy || !state.problem || trigger.disabled) return;
  const problem = state.problem;
  const body = { problem_id: problem.id, code: code.value };
  state.busy = true;
  if (run) {
    if (action === "run") {
      body.scope = $("run-scope").value;
      if (body.scope !== "samples") body.cases = state.cases;
    }
    state.running = true;
    state.result = 0;
    setTab("results");
  }
  updateButtons();
  const idleLabel = trigger.lastChild.textContent;
  trigger.lastChild.textContent = action === "submit" ? "Submitting…" : run ? " Running…" : "Saving…";
  try {
    const result = await api(action, body);
    if (run) {
      state.output = result;
      if (result.unlocked) {
        if (!problem.completed) announce("Problem complete. Hidden cases unlocked.");
        problem.completed = true;
        problem.hidden = result.unlocked;
      }
    } else {
      announce("Saved attempt #" + result.id + ".");
    }
  } catch (error) {
    if (run) state.output = { error: error.message };
    else announce(error.message);
  } finally {
    state.busy = false;
    state.running = false;
    trigger.lastChild.textContent = idleLabel;
    updateButtons();
    if (state.problem === problem && ["results", "history", "hidden"].includes(state.tab)) renderView();
  }
}

$("run").addEventListener("click", () => saveAttempt("run"));
$("submit").addEventListener("click", () => saveAttempt("submit"));
$("save").addEventListener("click", () => saveAttempt("save"));
$("reset").addEventListener("click", () => {
  if (code.value === state.problem.starter || !window.confirm("Replace the current draft with the starter code?")) return;
  code.value = state.problem.starter;
  code.setSelectionRange(0, 0);
  updateDraft();
  code.focus();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    saveAttempt("run");
  }
});

async function start() {
  updateButtons();
  const list = new URLSearchParams(location.search).get("list");
  if (list) $("back-to-problems").href = "/?" + new URLSearchParams(list);
  try {
    const detail = await api(location.pathname.slice(1));
    state.token = detail.token;
    openProblem(detail.problem);
  } catch (error) {
    $("problem-title").textContent = "Workspace unavailable";
    $("statement").append(element("p", error.message));
  }
}

start();
