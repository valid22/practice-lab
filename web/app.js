import { companyTags } from "/companies.js";
import { revealTests } from "/layout.js";
import { createPythonEditor } from "/editor.bundle.js";

const $ = (id) => document.getElementById(id);
const content = $("test-content");
const tabs = [...document.querySelectorAll("[data-tab]")];
const state = {
  problem: null, token: null, tab: "samples",
  sample: 0, hidden: 0, custom: 0, result: 0, cases: [], output: null, busy: false,
  complexity: {},
};
const labels = { samples: "Public tests", custom: "Custom tests", all: "Public + custom", submission: "Submission", snapshot: "Saved code" };
let noticeTimer;
const editor = createPythonEditor($("code"), {
  nonce: document.querySelector('meta[name="editor-style-nonce"]').content,
  onChange: updateDraft,
  onPosition: (line, column) => { $("position").textContent = "Ln " + line + ", Col " + column; },
  onRun: () => saveAttempt("run"),
});

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

function caseBox(label, value, { full = false, display = "clipped" } = {}) {
  const box = element("div", undefined, full ? "case-box full" : "case-box");
  const heading = element("div", undefined, "case-box-head");
  heading.append(element("h3", label));
  if (value) {
    const copy = button("Copy", async () => {
      try {
        await navigator.clipboard.writeText(value);
        announce(label + " copied.");
      } catch {
        announce("Clipboard unavailable. Check your browser permissions.");
      }
    }, "text-button copy-value");
    copy.setAttribute("aria-label", "Copy " + label.toLowerCase());
    heading.append(copy);
  }
  const preview = display === "clipped" && value.length > 320 ? value.slice(0, 320).trimEnd() + "…" : value;
  const body = element("div", undefined, "case-value");
  const text = element("pre", preview || "(empty)", "case-preview " + display);
  if (display === "scrollable") {
    text.tabIndex = 0;
    text.setAttribute("role", "region");
    text.setAttribute("aria-label", label);
  }
  body.append(text);
  box.append(heading, body);
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
  const reports = problem.reports || [];
  const hasSource = Boolean(problem.source || reports.length);
  const publicProblem = problem.source_kind === "public-problem";
  const sourceLabel = !hasSource ? "Practice drill" : publicProblem ? "Public problem adaptation" : "Reconstructed practice";
  labelsNode.replaceChildren(element("span", sourceLabel, hasSource ? "badge reconstructed" : "badge"));
  if (problem.companies.length) labelsNode.append(companyTags(problem.companies, true));
  if (problem.difficulty) {
    const difficulty = element("span", problem.difficulty, "badge");
    if (["easy", "medium", "hard"].includes(problem.difficulty.toLowerCase())) {
      difficulty.classList.add(problem.difficulty.toLowerCase());
    }
    labelsNode.append(difficulty);
  }
  $("topics").replaceChildren(...problem.topics.map((topic) => element("span", topic, "topic")));
  const limits = $("judge-limits");
  limits.textContent = "Time " + problem.judge.seconds + " s · Memory " + problem.judge.memory_mib + " MiB per case";
  limits.hidden = false;
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
  $("source-note").hidden = !hasSource;
  $("source-links").replaceChildren();
  if (hasSource) {
    $("source-heading").textContent = sourceLabel;
    $("source-description").textContent = publicProblem
      ? "Adapted from a published coding problem."
      : problem.source_kind === "interview-platform"
        ? "Adapted from a question attributed to OpenAI by Hello Interview."
        : "Practice versions based on publicly reported questions.";
    const sources = reports.length ? reports : [{
      url: problem.source,
      label: publicProblem ? "View the original problem" : "View the interview source",
    }];
    for (const source of sources) {
      const company = problem.companies.find(({ id }) => id === source.company);
      const label = source.label || [company?.name, source.round].filter(Boolean).join(" · ");
      const link = element("a", label);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const item = element("li");
      item.append(link);
      if (source.detail) item.append(" — " + source.detail);
      $("source-links").append(item);
    }
  }
  $("sample-count").textContent = problem.samples.length ? String(problem.samples.length) : "";
  document.querySelector(".statement").scrollTop = 0;
}

function openProblem(problem) {
  state.problem = problem;
  document.title = problem.title + " · Practice Lab";
  state.cases = stored(storageKey("custom"), []);
  const legacyDraft = stored("practice-lab:" + problem.id + ":draft", null);
  editor.setValue(stored(storageKey("draft"), legacyDraft ?? problem.starter), true);
  $("draft-status").textContent = legacyDraft !== null && editor.getValue() === legacyDraft ?
    "Older draft · update to a function" : "Draft autosaves";
  $("run-scope").value = problem.samples.length ? "samples" : "custom";
  renderProblem();
  setTab(problem.samples.length ? "samples" : "custom");
}

function updateDraft(value) {
  if (!state.problem) return;
  $("draft-status").textContent = store(storageKey("draft"), value) ? "Draft saved" : "Draft storage unavailable";
  if (state.complexityCode !== value && Object.keys(state.complexity).length) {
    state.complexity = {};
    if (state.tab === "complexity") renderView();
  }
}

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
  for (const control of content.querySelectorAll("[data-complexity-action]")) {
    control.disabled = state.busy;
  }
  editor.setDisabled(!state.problem);
}

function caseTabs(cases, current, onSelect, group) {
  const bar = element("div", undefined, "case-tabs");
  cases.forEach((test, index) => {
    const tab = button("Case " + (index + 1), () => {
      onSelect(index);
      content.querySelector('.case-tabs button[aria-pressed="true"]')?.focus();
    }, "");
    tab.setAttribute("aria-pressed", String(current === index));
    if (test.name) tab.title = test.name;
    if (test.status) {
      const kind = verdictKind(test.status);
      const icon = element("span", { passed: "✓", failed: "×", warning: "!", neutral: "–" }[kind], "case-verdict");
      icon.setAttribute("aria-hidden", "true");
      tab.classList.add("case-" + kind);
      const label = group ? group + " case " : "Case ";
      tab.setAttribute("aria-label", label + (index + 1) + ": " + test.status);
      tab.title = test.name ? test.name + " · " + test.status : test.status;
      tab.prepend(icon);
    }
    bar.append(tab);
  });
  return bar;
}

function verdictKind(status) {
  if (status === "Passed") return "passed";
  if (status === "Ran" || status === "Not run") return "neutral";
  return status.endsWith("limit") ? "warning" : "failed";
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
    content.append(element("p", "This problem has no private cases.", "empty"));
    return;
  }
  if (!problem.completed) {
    content.append(element("p", problem.hidden_count + " private cases. Pass a submission to unlock their inputs and expected returns.", "empty"));
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

function resultGroups(run, showCases) {
  const groups = { public: [], custom: [], private: [] };
  run.results.forEach((test, index) => {
    // Older combined runs stored public samples first and did not tag custom cases.
    const legacy = test.hidden ? "private" :
      run.scope === "custom" || (run.scope === "all" && index >= state.problem.samples.length) ? "custom" : "public";
    groups[test.group ?? legacy].push({ test, index });
  });

  const sections = element("div", undefined, "result-groups");
  for (const [group, cases] of Object.entries(groups)) {
    const privateSummary = group === "private" ? run.hidden_summary : null;
    if (!cases.length && !privateSummary) continue;
    const name = group[0].toUpperCase() + group.slice(1);
    const section = element("section", undefined, "result-group");
    section.setAttribute("aria-label", name + " results");
    const header = element("div", undefined, "result-group-head");
    const checked = privateSummary?.total ?? cases.filter(({ test }) => test.expected !== null).length;
    const passed = privateSummary?.passed ?? cases.filter(({ test }) => test.status === "Passed").length;
    const unchecked = privateSummary ? 0 : cases.length - checked;
    const summary = [checked ? passed + "/" + checked + " passed" : "",
      unchecked ? unchecked + " unchecked" : ""].filter(Boolean).join(" · ");
    header.append(element("h3", name), element("span", summary, "muted"));
    section.append(header);
    if (cases.length && showCases) {
      section.append(caseTabs(cases.map(({ test }) => test),
        cases.findIndex(({ index }) => index === state.result), (index) => {
          state.result = cases[index].index;
          renderView();
        }, name));
    } else if (!cases.length) {
      header.append(element("span", "Locked", "badge"));
    }
    const verdicts = Object.entries(privateSummary?.verdicts ?? {});
    if (!cases.length && verdicts.length) {
      const details = verdicts.map(([status, count]) => count + " " + status.toLowerCase());
      section.append(element("p", details.join(" · "), "muted private-verdicts"));
    }
    sections.append(section);
  }
  return sections;
}

function resultMetrics(test) {
  const metrics = element("dl", undefined, "result-metrics");
  const hasTime = test.status !== "Not run" && Number.isFinite(test.elapsed_ms);
  const memory = Number.isFinite(test.peak_memory_bytes) && test.peak_memory_bytes > 0
    ? (test.peak_memory_bytes / (1024 * 1024)).toFixed(1) + " MiB" : null;
  for (const [label, value, description] of [
    ["Time", hasTime ? test.elapsed_ms + " ms" : null, "Elapsed time including Python startup"],
    ["Peak memory", memory, "Peak resident memory of the Python process"],
  ]) {
    const metric = element("div");
    metric.title = value === null ? "Unavailable for this case" : description;
    metric.append(element("dt", label), element("dd", value ?? "—"));
    metrics.append(metric);
  }
  return metrics;
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
  // Older submissions may only have a wrong answer in their visible results.
  const wrong = run.scope === "submission"
    ? run.first_wrong_answer ?? run.results.find((test) => test.status === "Wrong answer")
    : null;
  content.append(element("p", "Attempt #" + run.id, "result-attempt"), resultGroups(run, !wrong));
  const selected = wrong ?? (run.results[state.result] || run.results[0]);
  if (!selected) return;
  const statusRow = element("div", undefined, "result-head selected-case");
  const caseHeading = element("div", undefined, "selected-case-title");
  const status = selected.status ?? "Wrong answer";
  caseHeading.append(element("h3", selected.name || (wrong ? "First wrong answer" : "Test case"), "case-title"),
    element("span", status, "badge " + verdictKind(status)));
  if (wrong) {
    const group = wrong.group === "private" || wrong.hidden ? "Private" : "Public";
    caseHeading.append(element("span", group, "badge"));
  }
  statusRow.append(caseHeading, resultMetrics(selected));
  // Older private failures saved the return value alone.
  const grid = "input" in selected ? caseGrid(selected) : element("div", undefined, "case-grid");
  if ("returned" in selected) {
    grid.append(caseBox("Your return", selected.returned, { full: true, display: "scrollable" }));
    if (selected.stdout) grid.append(caseBox("Printed output", selected.stdout, { full: true, display: "scrollable" }));
  } else {
    grid.append(caseBox("Your output", selected.stdout, { full: true, display: "scrollable" }));
  }
  if (selected.stderr) grid.append(caseBox("Standard error", selected.stderr, { full: true, display: "expanded" }));
  content.append(statusRow, grid);
  if (!("input" in selected)) {
    content.append(element("p", "Submit again to see the full failing case.", "muted"));
  }
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
      if (editor.getValue() !== attempt.code && !window.confirm("Replace the editor draft with this saved attempt?")) return;
      editor.setValue(attempt.code);
      editor.focus();
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

function renderComplexity() {
  const actions = element("div", undefined, "complexity-actions");
  for (const [mode, label, runningLabel] of [
    ["source", "Analyze code", "Analyzing…"], ["benchmark", "Benchmark", "Benchmarking…"],
  ]) {
    if (mode === "benchmark" && !state.problem.benchmark) continue;
    const control = button(state.complexityRunning === mode ? runningLabel : label,
      () => runComplexity(mode), mode === "source" ? "button primary" : "button");
    control.dataset.complexityAction = mode;
    control.disabled = state.busy;
    actions.append(control);
  }
  content.append(actions);
  if (!state.problem.benchmark) {
    content.append(element("p", "Benchmark inputs are unavailable for this problem.", "muted"));
  }

  const source = state.complexity.source;
  const benchmark = state.complexity.benchmark;
  if (!source && !benchmark) {
    content.append(element("p", "Analyze the draft for a time estimate or benchmark growth on generated inputs.", "muted"));
  }
  if (source) {
    const section = element("section", undefined, "complexity-report");
    section.append(element("h3", "Time estimate from code"),
      element("p", source.label ?? source.message, source.label ? "complexity-estimate" : "muted"));
    if (source.reasons?.length) {
      const reasons = element("ul", undefined, "muted");
      for (const reason of source.reasons) reasons.append(element("li", reason));
      section.append(reasons);
    }
    if (source.label) section.append(element("p",
      "A source-based estimate can miss costs from helper calls and input-dependent behavior.", "muted"));
    content.append(section);
  }
  if (benchmark) renderBenchmark(benchmark);
}

function renderBenchmark(report) {
  const section = element("section", undefined, "complexity-report");
  section.append(element("h3", "Benchmark"));
  content.append(section);
  if (report.message) {
    section.append(element("p", report.message));
    return;
  }
  section.append(element("p", report.description, "muted"));
  if (report.failure) {
    const { size, status, stderr } = report.failure;
    section.append(element("p", "Benchmark stopped at n = " + size + " · " + status));
    if (stderr) section.append(element("pre", stderr, "complexity-error"));
  } else {
    const metrics = element("dl", undefined, "result-metrics");
    for (const [label, value] of [["Time growth", report.time_growth], ["Memory growth", report.memory_growth]]) {
      const metric = element("div");
      metric.append(element("dt", label), element("dd", value));
      metrics.append(metric);
    }
    section.append(metrics);
  }
  if (!report.samples.length) return;
  const table = element("table", undefined, "complexity-table");
  const header = table.createTHead().insertRow();
  for (const label of ["Input size (n)", "Median time", "Peak Python allocation"]) {
    const cell = element("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  const body = table.createTBody();
  for (const sample of report.samples) {
    const time = sample.time_ns < 1000000
      ? (sample.time_ns / 1000).toFixed(2) + " µs"
      : (sample.time_ns / 1000000).toFixed(2) + " ms";
    const memory = sample.allocated_bytes < 1024
      ? sample.allocated_bytes + " B"
      : (sample.allocated_bytes / 1024).toFixed(2) + " KiB";
    const row = body.insertRow();
    for (const value of [sample.size.toLocaleString(), time, memory]) row.append(element("td", value));
  }
  section.append(table, element("p",
    "Growth estimates apply to these inputs. Each time is the median of five calls. Memory measures peak Python allocations during a separate call.",
    "muted"));
}

async function runComplexity(mode) {
  if (state.busy || !state.problem) return;
  const code = editor.getValue();
  const body = { problem_id: state.problem.id, code, mode };
  state.busy = true;
  state.complexityRunning = mode;
  renderView();
  let result;
  try {
    result = await api("complexity", body);
  } catch (error) {
    result = { message: error.message };
  } finally {
    state.busy = false;
    state.complexityRunning = null;
  }
  if (code === editor.getValue()) {
    state.complexityCode = code;
    state.complexity[mode] = result;
  } else {
    announce("Draft changed during analysis. Run again to analyze the current code.");
  }
  if (state.tab === "complexity") {
    const restoreFocus = document.activeElement === document.body;
    renderView();
    if (restoreFocus) content.querySelector('[data-complexity-action="' + mode + '"]').focus();
  } else updateButtons();
}

function renderView() {
  updateButtons();
  content.replaceChildren();
  if (!state.problem) return;
  const views = { samples: renderSamples, hidden: renderHidden, custom: renderCustom,
    results: renderResults, complexity: renderComplexity, history: renderHistory };
  views[state.tab]();
}

async function saveAttempt(action) {
  const run = action !== "save";
  const trigger = $(action);
  if (state.busy || !state.problem || trigger.disabled) return;
  const problem = state.problem;
  const body = { problem_id: problem.id, code: editor.getValue() };
  state.busy = true;
  if (run) {
    revealTests();
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
        if (!problem.completed) announce("Problem complete. Private cases unlocked.");
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
  if (editor.getValue() === state.problem.starter || !window.confirm("Replace the current draft with the starter code?")) return;
  editor.setValue(state.problem.starter);
  editor.focus();
});
document.addEventListener("keydown", (event) => {
  if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
