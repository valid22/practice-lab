import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const pythonColors = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--accent)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syntax-number)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName),
    tags.standard(tags.variableName), tags.typeName, tags.className], color: "var(--syntax-function)" },
  { tag: tags.invalid, color: "var(--failure)" },
]);

const editorColors = EditorView.theme({
  "&": { color: "var(--editor-ink)", backgroundColor: "var(--editor-bg)" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent), transparent 74%)",
  },
  ".cm-matchingBracket, .cm-searchMatch": { backgroundColor: "var(--wash)", outline: "1px solid var(--accent-border)" },
  ".cm-panels, .cm-tooltip": { backgroundColor: "var(--surface)", color: "var(--ink)", borderColor: "var(--line)" },
  ".cm-panel .cm-button, .cm-panel .cm-textfield": {
    background: "var(--rail)", color: "var(--ink)", borderColor: "var(--control-border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--wash)", color: "var(--ink)" },
  ".cm-foldPlaceholder": { color: "var(--muted)", backgroundColor: "var(--rail)", borderColor: "var(--line)" },
});
const darkTheme = EditorView.theme({}, { dark: true });
const darkMode = () => ["dark", "night"].includes(document.documentElement.dataset.theme);

export function createPythonEditor(parent, { nonce, onChange, onPosition, onRun }) {
  const loadDraft = Annotation.define();
  const access = new Compartment();
  const theme = new Compartment();
  const accessMode = (disabled) => [EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)];
  let disabled = true;
  let dark = darkMode();

  const run = () => {
    onRun();
    return true;
  };

  const view = new EditorView({
    parent,
    extensions: [
      basicSetup,
      python(),
      editorColors,
      syntaxHighlighting(pythonColors),
      theme.of(dark ? darkTheme : []),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      EditorView.cspNonce.of(nonce),
      access.of(accessMode(disabled)),
      EditorView.contentAttributes.of({
        "aria-label": "Python code",
        "aria-describedby": "editor-keys",
        autocapitalize: "off",
        spellcheck: "false",
      }),
      Prec.high(keymap.of([
        { key: "Mod-Enter", run },
        { mac: "Ctrl-Enter", run },
        indentWithTab,
      ])),
      EditorView.updateListener.of((update) => {
        if (update.docChanged &&
            !update.transactions.some((transaction) => transaction.annotation(loadDraft))) {
          onChange(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          const cursor = update.state.selection.main.head;
          const line = update.state.doc.lineAt(cursor);
          onPosition(line.number, cursor - line.from + 1);
        }
      }),
    ],
  });

  document.addEventListener("practice-appearance-change", () => {
    const next = darkMode();
    if (next === dark) return;
    dark = next;
    view.dispatch({ effects: theme.reconfigure(dark ? darkTheme : []) });
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue(value, initial = false) {
      if (value === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: 0 },
        scrollIntoView: true,
        annotations: initial ? [Transaction.addToHistory.of(false), loadDraft.of(true)] : [],
      });
    },
    setDisabled(value) {
      if (value === disabled) return;
      disabled = value;
      view.dispatch({ effects: access.reconfigure(accessMode(value)) });
    },
    focus: () => view.focus(),
  };
}
