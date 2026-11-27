// Section 5, Questions (step 09): one question per card, a chip row Q1..Q8 (lavender = current,
// green dot = right, red dot = checked but not right yet), Check with instant feedback, the
// explanation and the paper source. At the end, a gradient card with the first-try score and a
// link back to the section each missed question came from. Self-check: REVEAL_AT doesn't apply.
import * as store from "../../../shared/store.js";
import { chipRow, checkResult, summaryCard } from "../../../shared/ui.js";
import { answered, check, record, score, isDone, cleanState } from "./model.js";

const KEY = "hw:questions";

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...children.flat().filter((c) => c != null && c !== false));
  return e;
}

/** The bank, versioned like this module (the deploy adds ?v=<commit> to it), so no stale copy. */
async function loadBank() {
  const url = new URL("../../data/questions.json", import.meta.url);
  url.search = new URL(import.meta.url).search;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`questions.json: HTTP ${r.status}`);
  return r.json();
}

const sectionTitle = (id) => document.querySelector(`#${id} h2`)?.textContent.trim() ?? id;

export async function initQuestions({ root, progress }) {
  if (!root) return;
  let bank;
  try {
    bank = await loadBank();
  } catch {
    root.replaceChildren(h("p", { class: "qz-error" }, "The questions could not be loaded. Reload the page to try again."));
    return;
  }
  let s = cleanState(store.get(KEY), bank);
  const byId = Object.fromEntries(bank.map((q) => [q.id, q]));
  const save = () => store.set(KEY, s);

  const chips = h("div", { class: "qz-chips" });
  const card = h("article", { class: "qz-card", "aria-live": "off" });
  const aside = h("aside", { class: "qz-aside", "aria-label": "Your score" });
  root.replaceChildren(chips, h("div", { class: "qz-main" }, card, aside));

  const row = chipRow(chips, bank.map((q, i) => ({ id: q.id, label: `Q${i + 1}` })), {
    selected: s.current, label: "Questions",
    onSelect: (id) => { s = { ...s, current: id }; save(); renderCard(); },
  });

  const draft = (q) => {
    const d = s.drafts[q.id];
    if (q.type === "order") return Array.isArray(d) && answered(q, d) ? d : q.options.map((o) => o.id);
    if (q.type === "multi") return Array.isArray(d) ? d : [];
    return d ?? (q.type === "numeric" ? "" : null);
  };
  const setDraft = (q, v) => { s = { ...s, drafts: { ...s.drafts, [q.id]: v } }; save(); };

  function renderChips() {
    for (const b of chips.querySelectorAll(".chip")) {
      const a = s.attempts[b.dataset.id];
      const n = bank.findIndex((q) => q.id === b.dataset.id) + 1;
      b.classList.toggle("is-done", !!a?.correct);
      b.classList.toggle("is-missed", !!a && !a.correct);
      b.setAttribute("aria-label", `Question ${n}${a ? (a.correct ? ", right" : ", not right yet") : ""}`);
    }
  }

  function renderAside() {
    const r = score(s, bank);
    if (!isDone(s, bank)) {
      aside.replaceChildren(
        h("p", { class: "label" }, "Your score"),
        h("p", { class: "qz-count" }, h("strong", {}, `${r.checked}`), ` of ${r.total} checked`),
        h("p", { class: "qz-note" }, "Only your first try counts. Wrong answers can be tried again, and the explanation shows after every Check."),
      );
      return;
    }
    const value = h("div");
    summaryCard(value, { value: `${r.firstTry} / ${r.total}`, caption: "right on the first try" });
    const missed = r.missed.map((id) => {
      const q = byId[id];
      const target = q.anchor ?? q.section;
      return h("li", {}, h("span", { class: "qz-missed-q" }, `Q${bank.indexOf(q) + 1}`), " ", h("a", { href: `#${target}` }, `Back to ${sectionTitle(q.section)}`), h("span", { class: "qz-missed-src" }, ` · ${q.source}`));
    });
    aside.replaceChildren(
      value,
      missed.length
        ? h("div", { class: "qz-missed" }, h("p", { class: "label" }, "Missed on the first try"), h("ul", {}, missed))
        : h("p", { class: "qz-note" }, "Every question right on the first try."),
    );
  }

  /** Answer controls; `onChange` refreshes the Check button without rebuilding (keeps focus). */
  function answerArea(q, locked, onChange) {
    const name = `qz-${q.id}`;
    const value = locked ? s.attempts[q.id].answer : draft(q);
    if (q.type === "mc" || q.type === "multi") {
      const multi = q.type === "multi";
      return h("fieldset", { class: "qz-options", disabled: locked },
        h("legend", { class: "visually-hidden" }, multi ? "Pick all that apply" : "Pick one"),
        q.options.map((o) => {
          const on = multi ? value.includes(o.id) : value === o.id;
          return h("label", { class: "qz-option" },
            h("input", {
              type: multi ? "checkbox" : "radio", name, value: o.id, checked: on,
              onchange: (e) => {
                const cur = draft(q);
                setDraft(q, multi ? (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)) : o.id);
                onChange();
              },
            }),
            h("span", {}, o.text));
        }));
    }
    if (q.type === "numeric") {
      const i = h("input", {
        class: "input qz-num", type: "text", inputmode: "decimal", autocomplete: "off", disabled: locked,
        "aria-label": `Your answer in ${q.unit}`, placeholder: "0",
        oninput: (e) => { setDraft(q, e.target.value); onChange(); },
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); card.querySelector(".qz-check")?.click(); } },
      });
      i.value = String(value ?? "");
      return h("label", { class: "qz-numrow" }, i, h("span", { class: "qz-unit" }, q.unit));
    }
    // order: up / down buttons (keyboard and mouse); focus follows the moved item
    const text = Object.fromEntries(q.options.map((o) => [o.id, o.text]));
    const move = (i, d) => {
      const cur = [...draft(q)];
      [cur[i], cur[i + d]] = [cur[i + d], cur[i]];
      setDraft(q, cur);
      renderCard({ focus: `${cur[i + d]}:${d < 0 ? "up" : "down"}` });
    };
    return h("ol", { class: "qz-order", "aria-label": "Put these in order, top first" },
      value.map((id, i) => h("li", { class: "qz-order-item" },
        h("span", { class: "qz-order-n" }, String(i + 1)),
        h("span", { class: "qz-order-text" }, text[id]),
        h("span", { class: "qz-order-btns" },
          h("button", { type: "button", class: "btn qz-move", "data-focus": `${id}:up`, disabled: locked || i === 0, "aria-label": `Move “${text[id]}” up`, onclick: () => move(i, -1) }, "↑"),
          h("button", { type: "button", class: "btn qz-move", "data-focus": `${id}:down`, disabled: locked || i === value.length - 1, "aria-label": `Move “${text[id]}” down`, onclick: () => move(i, 1) }, "↓")))));
  }

  function renderCard({ focus } = {}) {
    const q = byId[s.current];
    const n = bank.indexOf(q) + 1;
    const a = s.attempts[q.id];
    const locked = !!a?.correct;
    const result = h("div", { class: "qz-result" });
    const checkBtn = h("button", { type: "button", class: "btn btn-primary qz-check", hidden: locked }, "Check");
    const refresh = () => { checkBtn.disabled = !answered(q, draft(q)); };
    checkBtn.addEventListener("click", () => {
      const ans = draft(q);
      if (!answered(q, ans)) return;
      s = record(s, q, ans);
      save();
      if (isDone(s, bank)) progress?.setDone("questions");
      renderChips();
      renderAside();
      renderCard({ focus: "result" });
    });
    const next = bank[n] ?? null;
    const nextBtn = h("button", { type: "button", class: "btn qz-next", onclick: () => { row.select(next.id); s = { ...s, current: next.id }; save(); renderCard({ focus: "prompt" }); } }, `Next: Q${n + 1} →`);
    card.replaceChildren(
      h("p", { class: "label qz-of" }, `Question ${n} of ${bank.length}`, q.type === "multi" ? " · pick all that apply" : q.type === "order" ? " · put in order" : ""),
      h("h3", { class: "qz-prompt", tabindex: "-1" }, q.prompt),
      answerArea(q, locked, refresh),
      h("div", { class: "qz-actions" }, checkBtn, next && nextBtn, a && !locked ? h("span", { class: "qz-tries" }, `Try ${a.tries + 1}`) : null),
      result,
    );
    refresh();
    if (a) {
      const fb = check(q, a.answer);
      checkResult(result.appendChild(h("div", { tabindex: "-1" })), a.correct, a.correct ? (a.firstCorrect ? "Right, on the first try." : `Right, after ${a.tries} tries.`) : fb.feedback);
      result.append(h("p", { class: "qz-expl" }, q.explanation), h("p", { class: "qz-src" }, `Source: ${q.source}`));
    }
    if (focus === "result") (locked && card.querySelector(".qz-next") || result.querySelector(".check-result"))?.focus();
    else if (focus === "prompt") card.querySelector(".qz-prompt").focus({ preventScroll: true });
    // after a move, keep focus on the moved item's button; at the top/bottom it is disabled, so use its other one
    else if (focus) (card.querySelector(`[data-focus="${focus}"]:not(:disabled)`) ?? card.querySelector(`[data-focus^="${focus.split(":")[0]}:"]:not(:disabled)`))?.focus();
  }

  renderChips();
  renderAside();
  renderCard();
  if (isDone(s, bank)) progress?.setDone("questions");
}
