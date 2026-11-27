// Section 3, the Figure 1 tutor (step 12): DOM only. The walk's rules live in model.js,
// the calls in api.js, the tree drawing in tree.js. Everything is saved in the store
// (STORE_KEY), so a reload restores the chat and the tree.

import * as store from "../../../shared/store.js";
import { TUTOR_ENABLED, tutorUrl } from "../../../shared/config.js";
import { chipRow } from "../../../shared/ui.js";
import { FORKS, PROPERTIES, TREE, scoreFork } from "../path/model.js";
import * as M from "./model.js";
import { askTutor, fetchPassage, FALLBACK_KINDS } from "./api.js";
import { renderTree } from "./tree.js";

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const label = (id) => TREE[id].label;
const forkById = (id) => FORKS.find((f) => f.id === id);
const propName = Object.fromEntries(PROPERTIES.map((p) => [p.id, p.name]));

const OFFLINE_HINT = {
  disabled: "The AI tutor is switched off for now. Guided mode: choose a branch, then the properties that support it.",
  quota: "The tutor has used up its free quota for now, so carry on in guided mode. You can try the tutor again later.",
  limit: "You've used all your tutor messages; carry on in guided mode.",
  error: "The tutor isn't answering right now, so carry on in guided mode. You can try it again later.",
};

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

export function initTutor({ root, badge, progress }) {
  if (!root) return;
  let state = M.restore(store.get(M.STORE_KEY), newId);
  const url = tutorUrl();
  let busy = false;
  let fb = { forkId: null, pick: null, props: new Set() }; // guided-mode selections, not saved until Check
  let advanceTimer = null;
  let shown = 0; // messages already in the log (we append, so screen readers hear only new ones)
  let note = ""; // a one-line notice under the chat input (too fast, too long)

  const save = () => store.set(M.STORE_KEY, state);
  const setState = (s) => { state = s; save(); render(); };

  // ---------- skeleton ----------
  const svgHost = h("div", { class: "tree-svg" });
  const strip = h("ol", { class: "chips tree-strip", "aria-label": "Your path so far" });
  const treeToggle = h("button", { class: "btn btn-ghost tree-toggle", type: "button", "aria-expanded": "false", onclick: () => {
    const open = treeToggle.getAttribute("aria-expanded") !== "true";
    treeToggle.setAttribute("aria-expanded", String(open));
    treePane.classList.toggle("is-open", open);
    treeToggle.textContent = open ? "Hide Figure 1" : "Show Figure 1";
  } }, "Show Figure 1");
  const propChips = h("ul", { class: "chips prop-chips", "aria-label": "Properties you used" });
  const treePane = h("div", { class: "tutor-tree" },
    h("div", { class: "tree-strip-row" }, strip, treeToggle),
    svgHost,
    h("p", { class: "label" }, "Properties you argued with (§2.1)"),
    propChips,
  );
  const log = h("ol", { class: "chat-log", "aria-live": "polite", "aria-label": "Conversation with the tutor" });
  const controls = h("div", { class: "tutor-controls" });
  const chatPane = h("div", { class: "tutor-chat" }, log, controls);
  const recapHost = h("div", { class: "tutor-recap-host" });
  const drawer = buildDrawer();
  root.replaceChildren(h("div", { class: "tutor-panes" }, treePane, chatPane), recapHost, drawer.el);

  // ---------- start ----------
  // No gate: the tutor starts live (guided mode only when it is switched off or fails).
  if (state.mode === null) state = TUTOR_ENABLED ? M.start(state, "live") : M.start(state, "fallback", "disabled");
  if (state.mode === "live" && !TUTOR_ENABLED) state = M.goOffline(state, "disabled");
  // older saved walks that stopped at the class code carry on live
  if (state.mode === "fallback" && (state.offline === "no_code" || state.offline === "class_code")) state = TUTOR_ENABLED ? M.goLive(state) : M.goOffline(state, "disabled");
  save();
  render();

  // ---------- rendering ----------
  function render() {
    badge.hidden = state.mode !== "fallback";
    renderTreePane();
    renderLog();
    renderControls();
    renderRecap();
    if (M.isDone(state)) progress?.setDone("tutor");
  }

  function renderTreePane() {
    const view = M.treeView(state);
    const cur = M.currentForkId(state);
    renderTree(svgHost, view, {
      onNode,
      canAsk: (id) => {
        if (state.mode === "fallback") return cur && !state.forks[cur].revealed && forkById(cur).options.some((o) => o.id === id) ? `Choose ${label(id)}` : null;
        if (state.mode === "live") return M.nodeQuestion(state, id);
        return null;
      },
    });
    strip.replaceChildren(...FORKS.map((f, i) => {
      const fs = state.forks[f.id];
      const short = label(f.congaPick).split(",")[0].replace(" (CONGA)", "");
      const text = fs.revealed ? short : i === state.fork ? "now" : "…";
      return h("li", {}, h("span", { class: `chip${i === state.fork ? " is-selected" : ""}${fs.revealed ? " is-done" : ""}` },
        h("span", { class: "chip-sub" }, f.id), h("span", {}, text)));
    }));
    const used = new Set(M.propertiesUsed(state));
    propChips.replaceChildren(...PROPERTIES.map((p) =>
      h("li", {}, h("span", { class: `chip prop-chip${used.has(p.id) ? " is-selected" : ""}`, title: p.name },
        h("span", {}, p.id), h("span", { class: "chip-sub" }, p.name)))));
  }

  function renderLog() {
    if (shown > state.messages.length) { log.replaceChildren(); shown = 0; }
    for (const m of state.messages.slice(shown)) log.append(messageEl(m));
    shown = state.messages.length;
    log.scrollTop = log.scrollHeight;
  }

  function messageEl(m) {
    const li = h("li", { class: `chat-msg is-${m.role}${m.kind ? ` is-${m.kind}` : ""}` },
      h("span", { class: "sr-only" }, m.role === "tutor" ? "Tutor: " : "You: "),
      h("p", {}, m.text));
    if (m.cites?.length) {
      li.append(h("div", { class: "chat-cites" }, h("span", { class: "label" }, "Paper:"),
        ...m.cites.map((id) => h("button", { class: "badge badge-violet cite-badge", type: "button", onclick: () => openCite(id), "aria-label": `Open passage ${id}` }, `§${id}`))));
    }
    return li;
  }

  function renderControls() {
    const cur = M.currentForkId(state);
    if (cur && state.forks[cur].revealed) return controls.replaceChildren(nextStep(cur));
    if (state.mode === "fallback") return controls.replaceChildren(cur ? guided(cur) : offlineFooter());
    return controls.replaceChildren(liveControls(cur));
  }

  // ---------- guided (fallback) mode ----------
  function guided(forkId) {
    if (fb.forkId !== forkId) fb = { forkId, pick: null, props: new Set() };
    const f = forkById(forkId);
    const check = h("button", { class: "btn btn-primary", type: "button", onclick: () => {
      const r = M.fallbackAnswer(state, fb.pick, [...fb.props]);
      setState(r.state);
    } }, "Check");
    const refresh = () => { check.disabled = !(fb.pick && fb.props.size >= 1 && fb.props.size <= 3); };
    const branches = h("div", {});
    chipRow(branches, f.options.map((o) => ({ id: o.id, label: o.label })), {
      selected: fb.pick, label: "Your branch", onSelect: (id) => { fb.pick = id; refresh(); renderTreePane(); },
    });
    const props = h("div", { class: "chips", role: "group", "aria-label": "Properties that support your branch (1 to 3)" },
      ...PROPERTIES.map((p) => {
        const b = h("button", { class: "chip", type: "button", "aria-pressed": String(fb.props.has(p.id)), title: p.name }, h("span", {}, p.id), h("span", { class: "chip-sub" }, p.name));
        b.addEventListener("click", () => {
          if (fb.props.has(p.id)) fb.props.delete(p.id);
          else if (fb.props.size < 3) fb.props.add(p.id);
          b.setAttribute("aria-pressed", String(fb.props.has(p.id)));
          refresh();
        });
        return b;
      }));
    refresh();
    return h("div", { class: "guided" },
      offlineHint(),
      h("p", { class: "label" }, "1 · Your branch"), branches,
      h("p", { class: "label" }, "2 · Which properties support it? Choose 1 to 3"), props,
      h("div", { class: "btn-row" }, check, h("button", { class: "btn btn-ghost", type: "button", onclick: () => showForkPassage(forkId) }, "Show the passage")),
    );
  }

  function offlineHint() {
    const reason = state.offline ?? "error";
    const p = h("div", { class: "tutor-hint" }, h("p", {}, OFFLINE_HINT[reason] ?? OFFLINE_HINT.error));
    if (!TUTOR_ENABLED || reason === "limit") return p;
    p.append(h("button", { class: "btn btn-ghost", type: "button", onclick: () => setState(M.goLive(state)) }, "Try the tutor again"));
    return p;
  }

  function offlineFooter() {
    return h("div", { class: "guided" }, h("p", { class: "tutor-note" }, "You've walked the whole tree. Your recap is below."));
  }

  // ---------- after a reveal: result, then the next fork ----------
  function nextStep(forkId) {
    const f = forkById(forkId);
    const fs = state.forks[forkId];
    const next = () => setState(M.advance(state));
    const isLast = forkId === FORKS.at(-1).id;
    const box = h("div", { class: "guided" });
    if (fs.revealedBy === "fallback" || state.mode === "fallback") {
      const sc = scoreFork(forkId, { pick: fs.pick, properties: fs.properties });
      const ok = sc.pickCorrect;
      const used = fs.properties.map((p) => `${p}${f.properties.includes(p) ? " ✓" : ""}`).join(", ") || "none";
      const r = h("div", {});
      r.className = `check-result ${ok ? "is-ok" : "is-bad"}`;
      r.setAttribute("role", "status");
      r.append(h("div", {},
        h("p", {}, fs.pick ? `You chose ${label(fs.pick)}; the paper takes ${label(f.congaPick)}.` : `The paper takes ${label(f.congaPick)}.`),
        h("p", {}, `Your properties: ${used}. The paper's argument rests on ${M.keyPropertiesText(forkId)}.`),
        f.interpretation ? h("p", { class: "tutor-note" }, f.interpretation) : null));
      box.append(r);
    }
    box.append(h("div", { class: "btn-row" },
      h("button", { class: "btn btn-primary", type: "button", onclick: next }, isLast ? "See your recap" : "Next fork"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => showForkPassage(forkId) }, "Show the passage")));
    return box;
  }

  // ---------- live chat ----------
  const REASON = { quota: "quota", limit: "limit" };

  function liveControls(cur) {
    const input = h("textarea", { class: "input chat-input", rows: "2", maxlength: "600", placeholder: cur ? "Your branch and why (P1–P5)…" : "Ask about CONGA…", "aria-label": "Your message" });
    const sendBtn = h("button", { class: "btn btn-primary", type: "submit", disabled: busy }, "Send");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    const form = h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t && !busy) send(t, input); } }, input, sendBtn);
    const quick = cur ? h("div", { class: "chips quick-replies", role: "group", "aria-label": "Quick replies" },
      ...forkById(cur).options.map((o) => quickBtn(`I'd pick ${o.label}`, () => send(`I'd pick ${o.label}.`))),
      quickBtn("Why?", () => send("Why?")),
      quickBtn("Show the passage", () => showForkPassage(cur), true),
      quickBtn("Show me", () => { setState(M.revealCurrent(state, "button")); scheduleAdvance(); })) : null;
    return h("div", { class: "live" },
      quick,
      h("p", { class: "tutor-note" }, "Chats are saved for the class discussion."),
      form,
      h("p", { class: "tutor-note live-note", role: "status" }, note));
  }

  function quickBtn(text, onclick, always = false) {
    return h("button", { class: "chip quick", type: "button", disabled: busy && !always, onclick }, text);
  }

  async function send(text, input) {
    if (busy) return;
    const before = state;
    busy = true;
    note = "";
    const body = M.requestBody(before, text); // history = the turns before this message
    state = M.addStudent(before, text);
    save();
    renderLog();
    renderControls();
    const typing = h("li", { class: "chat-msg is-tutor is-typing" }, h("span", { class: "sr-only" }, "The tutor is typing"),
      h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "dot" }));
    log.append(typing);
    log.scrollTop = log.scrollHeight;
    const r = await askTutor(url, body);
    typing.remove();
    busy = false;
    if (r.ok) {
      const a = M.applyReply(state, r.data);
      let s = a.state;
      if (a.reveal) s = M.revealCurrent(s, r.data.ready_to_reveal ? "tutor" : "turns");
      setState(s);
      if (a.reveal) scheduleAdvance();
      return;
    }
    if (FALLBACK_KINDS.has(r.kind)) {
      setState(M.goOffline(state, REASON[r.kind] ?? "error"));
      return;
    }
    // too fast / too long / bad request: not processed, so take the message back
    note = r.kind === "too_fast" ? "One message every few seconds, please: try again in a moment."
      : r.kind === "too_long" ? "Please keep your message under 600 characters." : "That message couldn't be sent; try rephrasing.";
    state = before;
    shown = Infinity; // re-render the log without the message
    setState(state);
    const box = controls.querySelector(".chat-input");
    if (box) { box.value = text; box.focus(); }
  }

  function scheduleAdvance() {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      const cur = M.currentForkId(state);
      if (cur && state.forks[cur].revealed && !busy) setState(M.advance(state));
    }, reduceMotion() ? 600 : 2500);
  }

  function onNode(id) {
    if (state.mode === "fallback") {
      const cur = M.currentForkId(state);
      if (!cur || state.forks[cur].revealed || !forkById(cur).options.some((o) => o.id === id)) return;
      fb.pick = id;
      renderControls();
      renderTreePane();
      return;
    }
    if (state.mode === "live" && !busy) {
      const q = M.nodeQuestion(state, id);
      if (q) send(q);
    }
  }

  // ---------- recap ----------
  function renderRecap() {
    if (!M.isDone(state)) return recapHost.replaceChildren();
    const r = M.recap(state);
    const rows = r.rows.map((x) => h("tr", { class: x.agree ? "" : "is-diff" },
      h("th", { scope: "row" }, `${x.forkId}`, h("span", { class: "chip-sub" }, ` ${x.section}`)),
      h("td", {}, h("span", { class: "recap-pick" }, x.pickLabel ?? "–"), " ",
        x.agree ? h("span", { class: "badge" }, "same") : h("span", { class: "badge badge-gold" }, "differs"),
        x.agree ? null : h("span", { class: "recap-paper" }, `paper: ${x.congaLabel}`)),
      h("td", { class: "col-paper" }, x.congaLabel),
      h("td", {}, [...x.hit.map((p) => `${p} ✓`), ...x.extra].join(", ") || "–"),
      h("td", { class: "recap-missed" }, x.missed.join(", ") || "–")));
    const missedText = Object.entries(r.missed).map(([p, forks]) => `${p} ${propName[p]} (${forks.join(", ")})`).join("; ");
    const usedSet = new Set(r.propertiesUsed);
    const propSummary = h("ul", { class: "chips recap-props", "aria-label": "Properties across your walk" },
      ...PROPERTIES.map((p) => {
        const state_ = usedSet.has(p.id) ? "used" : r.missed[p.id] ? "missed" : "unused";
        return h("li", {}, h("span", { class: `chip prop-chip${state_ === "used" ? " is-selected" : ""}${state_ === "missed" ? " is-missed" : ""}`, title: `${p.name}: ${state_}` },
          h("span", {}, p.id), h("span", { class: "chip-sub" }, state_ === "used" ? "used" : state_ === "missed" ? "missed" : "–")));
      }));
    const field = (key, q, ph) => {
      const t = h("textarea", { class: "input", rows: "2", maxlength: "300", placeholder: ph, "aria-label": q });
      t.value = state.recap[key] ?? "";
      t.addEventListener("input", () => { state.recap[key] = t.value; save(); });
      return h("label", { class: "mda" }, h("span", { class: "label" }, q), t);
    };
    recapHost.replaceChildren(h("div", { class: "tutor-recap panel-inset" },
      h("h3", {}, "Your walk against the paper"),
      h("div", { class: "table-scroll" }, h("table", { class: "recap-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Fork"), h("th", { scope: "col" }, "You"), h("th", { scope: "col", class: "col-paper" }, "Paper"), h("th", { scope: "col" }, "You used"), h("th", { scope: "col" }, "Paper's, missed"))),
        h("tbody", {}, rows))),
      h("p", {}, r.disagreements.length
        ? `You and the paper parted ways at ${r.disagreements.join(", ")}. We'll come back to those in class.`
        : "You took the paper's branch at every fork."),
      h("p", { class: "label" }, "Properties across the walk: used vs missed"),
      propSummary,
      h("p", {}, missedText ? `The paper also relied on ${missedText}.` : "You named every property the paper relies on."),
      h("p", { class: "label" }, "CONGA in Unit 4's words: who measures, who decides, who acts?"),
      h("div", { class: "mda-grid" },
        field("measure", "Who measures, and what?", "e.g. which devices, measuring what"),
        field("decide", "Who decides, and when?", "e.g. which switch, per what unit"),
        field("act", "Who acts, and with what information?", "e.g. how the decision reaches the packets")),
    ));
  }

  // ---------- passage drawer ----------
  function showForkPassage(forkId) {
    const n = forkById(forkId).passageId.split("-")[1];
    const article = document.getElementById(`passage-${n}-title`)?.closest("article");
    const title = article?.querySelector(".passage-title")?.textContent?.replace(/^\d+/, "").trim() ?? "";
    const text = article?.querySelector(".passage-text")?.textContent?.replace(/\s+/g, " ").trim() ?? "The passage is in section 1 (Read).";
    drawer.open(`Read · passage ${n}${title ? `: ${title}` : ""}`, text);
  }

  async function openCite(id) {
    drawer.open(`CONGA §${id.split("-p")[0]}`, "Loading…");
    const r = await fetchPassage(url, id);
    if (r.ok) drawer.open(`CONGA §${r.data.section} · page ${r.data.page} · ${r.data.id}`, r.data.text);
    else drawer.open(`CONGA §${id}`, "This passage can't be loaded right now.");
  }

  function buildDrawer() {
    const title = h("h3", { id: "tutor-drawer-title" });
    const body = h("div", { class: "drawer-body" });
    const close = h("button", { class: "btn btn-ghost", type: "button", "aria-label": "Close the passage" }, "Close");
    const el = h("aside", { class: "tutor-drawer panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "tutor-drawer-title", hidden: true },
      h("div", { class: "drawer-head" }, title, close), body);
    let opener = null;
    const hide = () => { el.hidden = true; opener?.focus?.(); };
    close.addEventListener("click", hide);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    return {
      el,
      open(t, text) {
        if (el.hidden) opener = document.activeElement;
        title.textContent = t;
        body.replaceChildren(...text.split(/\n\n+/).map((p) => h("p", {}, p)));
        el.hidden = false;
        close.focus();
      },
    };
  }

  return { get state() { return state; } };
}
