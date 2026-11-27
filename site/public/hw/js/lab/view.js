// Section 4, the asymmetry lab (step 06, redesigned in step 14): DOM only. Rules and numbers
// live in state.js and model.js; the drawing in draw.js. One stepper, one instruction line,
// one scheme switch above one graph, one results card beside it; below, only the current
// step's question (or the demands table in the Sandbox). Everything is saved under STORE_KEY.

import * as store from "../../../shared/store.js";
import { areaChart } from "../../../shared/ui.js";
import * as L from "./state.js";
import { createFabric, fmt } from "./draw.js";

const pct = (x) => `${Math.round(x * 100)}%`;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

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
/** replaceChildren without ever printing "null" */
const fill = (host, ...kids) => host.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));

const STEPS = [
  { id: "fig2", label: "1 · Figure 2", done: "fig2" },
  { id: "fig3", label: "2 · Figure 3", done: "fig3" },
  { id: "ecmpWins", label: "3 · ECMP wins?", done: "ecmpWins" },
  { id: "whyNot", label: "4 · Why not", done: "whyNot" },
  { id: "sandbox", label: "Sandbox" },
];
const WHY_NOT_PROMPTS = ["Stale feedback", "2-tier only", "PoA = 2", "A shared last hop"];

export function initLab({ root, progress }) {
  if (!root) return;
  let s = L.restore(store.get(L.STORE_KEY));
  let popLink = null; // the link whose capacity popover is open
  const save = () => store.set(L.STORE_KEY, s);
  const set = (n) => { s = n; save(); render(); };
  const quiet = (n) => { s = n; save(); }; // typing / dragging: save without re-rendering

  const stepper = h("ol", { class: "lab-stepper", "aria-label": "Lab steps" });
  const instr = h("div", { class: "lab-instr" });
  const seg = h("div", { class: "lab-seg", role: "group", "aria-label": "Scheme" });
  const graph = h("div", { class: "lab-graph" });
  const pop = h("div", { class: "lab-pop panel", role: "dialog", "aria-label": "Link capacity", hidden: true });
  const graphHint = h("p", { class: "lab-hint" });
  const card = h("div", { class: "lab-card" });
  const main = h("div", { class: "lab-main" }, h("div", { class: "lab-graph-col" }, seg, h("div", { class: "lab-graph-wrap" }, graph, pop), graphHint), card);
  const below = h("div", { class: "lab-below" });
  fill(root, stepper, instr, main, below);

  const fabric = createFabric(graph, {
    onLink: (phys, x, y) => { popLink = phys; renderPop(x, y); renderGraph(); },
    onSelectSource: (leaf) => {
      const { demands } = L.effective(s);
      const mine = demands.map((d, i) => [d, i]).filter(([d]) => d.src === leaf).map(([, i]) => i);
      if (!mine.length) return;
      const next = mine[(mine.indexOf(s.selected) + 1) % mine.length];
      set(L.setSelected(s, next));
    },
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) closePop(); });

  // ---------- render ----------
  function render() {
    if (s.scenario === "fig3a" && !s.fig3.committed && s.scheme !== "weighted") quiet(L.setScheme(s, "weighted"));
    if (!schemesFor().includes(s.scheme)) quiet(L.setScheme(s, "conga"));
    renderStepper();
    renderInstr();
    // text-only moments: the Why-not step, and the "ECMP wins?" hint before "Show me"
    main.hidden = s.scenario === "whyNot" || (s.scenario === "ecmpWins" && !s.ecmpWinsView);
    if (!main.hidden) { renderSeg(); renderGraph(); renderCard(); }
    renderBelow();
    progress?.setDone("lab", L.isDone(s));
  }

  const schemesFor = () => (["fig3a", "fig3b", "sandbox"].includes(s.scenario) ? ["ecmp", "localOnly", "conga", "weighted"] : ["ecmp", "localOnly", "conga"]);
  const stepOf = (sc) => (sc === "fig3a" || sc === "fig3b" ? "fig3" : sc);

  function renderStepper() {
    const st = L.steps(s);
    fill(stepper, ...STEPS.map((x) => {
      const cur = stepOf(s.scenario) === x.id;
      const go = () => { closePop(); set(L.setScenario(s, x.id === "fig3" ? (s.fig3.committed ? "fig3b" : "fig3a") : x.id)); };
      return h("li", {}, h("button", { class: `lab-step${cur ? " is-current" : ""}${x.done && st[x.done] ? " is-done" : ""}`, type: "button", "aria-current": cur ? "step" : null, onclick: go },
        x.done && st[x.done] ? h("span", { class: "lab-step-tick", "aria-hidden": "true" }, "✓") : null, x.label));
    }));
  }

  // ---------- the instruction line ----------
  function toggle(items, current, onPick) {
    return h("div", { class: "lab-toggle", role: "group" }, ...items.map(([id, label, disabled]) =>
      h("button", { type: "button", class: "lab-toggle-btn", "aria-pressed": String(id === current), disabled: !!disabled, onclick: () => onPick(id) }, label)));
  }

  function renderInstr() {
    const edited = s.scenario !== "whyNot" && !(s.scenario === "ecmpWins" && !s.ecmpWinsView) && L.effective(s).edited;
    const reset = edited ? h("button", { class: "btn btn-ghost lab-reset", type: "button", onclick: () => { closePop(); set(L.resetScenario(s, s.scenario)); } }, "Reset to paper") : null;
    const text = {
      fig2: "L0 sends 100 Gbps of TCP traffic to L1. The S1→L1 link has 40G, the others 80G. Predict what each scheme delivers, then check.",
      fig3a: "(a) L1 sends 80 Gbps to L2. Static weights are WCMP from Unit 4: set L1's split for the best throughput, then lock it.",
      fig3b: "(b) L0 now also sends 40 Gbps to L2, and L0 can only use S0. Your split from (a) stays. What will it deliver?",
      sandbox: "Click a link to change its capacity; edit the demands below. Every scheme recomputes at once.",
      whyNot: "Where is CONGA's argument weakest?",
    }[s.scenario];
    if (s.scenario === "ecmpWins") {
      if (!s.ecmpWinsView) {
        fill(instr, h("p", {}, "CONGA is selfish: each leaf picks its own least-congested path. Can you build a setting where ECMP beats it? Hint: §6, Figure 17."),
          h("div", { class: "lab-instr-actions" },
            h("button", { class: "btn btn-ghost", type: "button", onclick: () => set(L.setScenario(s, "sandbox")) }, "Try in Sandbox"),
            h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.showEcmpWins(s, "fig17")) }, "Show me")));
        return;
      }
      const t = s.ecmpWinsView === "fig17"
        ? "§6.1, Figure 17: five leaves in a ring, each pair of neighbours sends 60 Gbps over 40G links. CONGA starts in the flow the paper draws."
        : "Two leaves send 40 Gbps each to L2 over two equal spines; CONGA reacts to congestion data that is 3 rounds old.";
      fill(instr, h("p", {}, s.ecmpWinsView === "delay" ? h("span", { class: "badge badge-violet" }, "beyond the paper's model") : null, s.ecmpWinsView === "delay" ? " " : null, t),
        h("div", { class: "lab-instr-actions" }, toggle([["fig17", "Figure 17: stuck"], ["delay", "Stale feedback", !s.revealed["ecmpWins:fig17"]?.all]], s.ecmpWinsView, (id) => set(L.showEcmpWins(s, id))), reset));
      return;
    }
    const fig3 = s.scenario === "fig3a" || s.scenario === "fig3b"
      ? toggle([["fig3a", "(a)"], ["fig3b", "(b)", !s.fig3.committed]], s.scenario, (id) => set(L.setScenario(s, id))) : null;
    fill(instr, h("p", {}, text), h("div", { class: "lab-instr-actions" }, fig3, reset));
  }

  // ---------- scheme switch + graph ----------
  function renderSeg() {
    const tune = s.scenario === "fig3a" && !s.fig3.committed;
    fill(seg, ...schemesFor().map((k) => h("button", {
      type: "button", class: "lab-seg-btn", "aria-pressed": String(k === s.scheme), disabled: tune && k !== "weighted",
      onclick: () => set(L.setScheme(s, k)),
    }, k === "weighted" ? "Weighted" : L.SCHEME_LABEL[k])));
  }

  function renderGraph() {
    const vis = L.visibleSchemes(s);
    const { net, demands, base } = L.effective(s);
    const R = L.results(s);
    fabric.update({
      net, baseNet: base.net, demands, selected: s.selected,
      result: vis.has(s.scheme) ? R[s.scheme].result : null,
      editable: L.canEdit(s), selectedLink: popLink, motion: !reduceMotion(),
      canSwitch: demands.length > 1,
    });
    const d = demands[s.selected];
    graphHint.textContent = [
      d ? `Violet: the paths of ${d.src}→${d.dst}${demands.length > 1 ? " (click a sender to show another demand)" : ""}.` : "",
      L.canEdit(s) ? "Click a link to change its capacity." : "",
    ].filter(Boolean).join(" ");
  }

  function renderPop(x, y) {
    if (!popLink || !L.canEdit(s)) return closePop();
    const { net } = L.effective(s);
    const [l, sp] = popLink.split("-");
    const cap = Math.max(net.cap[`${l}>${sp}`] ?? 0, net.cap[`${sp}>${l}`] ?? 0);
    const val = h("output", { class: "lab-pop-val" }, cap === 0 ? "failed" : `${cap}G`);
    const r = h("input", { type: "range", min: "0", max: "80", step: "5", class: "lab-range", "aria-label": `Capacity of ${l}–${sp} in Gbps (0 = failed)` });
    r.value = String(cap);
    r.addEventListener("input", () => {
      const v = Number(r.value);
      val.textContent = v === 0 ? "failed" : `${v}G`;
      quiet(L.setLinkCap(s, s.scenario, popLink, v));
      renderGraph(); renderCard(); renderInstr();
    });
    fill(pop, h("div", { class: "lab-pop-head" }, h("strong", {}, `${l}–${sp}`), h("span", { class: "lab-pop-sub" }, "both directions"),
      h("button", { class: "lab-pop-close", type: "button", "aria-label": "Close", onclick: closePop }, "×")),
      h("div", { class: "lab-pop-row" }, r, val), h("p", { class: "lab-pop-sub" }, "0 = failed"));
    const box = graph.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.min(Math.max(8, x - box.left - 110), box.width - 236)}px`;
    pop.style.top = `${Math.max(8, y - box.top + 14)}px`;
    r.focus();
  }

  function closePop() {
    if (pop.hidden && !popLink) return;
    pop.hidden = true;
    popLink = null;
    if (!main.hidden) renderGraph();
  }

  // ---------- the results card ----------
  function renderCard() {
    const R = L.results(s);
    const vis = L.visibleSchemes(s);
    const k = s.scheme;
    const pred = predictionBlock();
    const split = splitBlock();
    if (!vis.has(k)) { fill(card, split, pred ?? h("p", { class: "lab-card-hidden" }, "Lock your split to see the other schemes.")); return; }
    const r = R[k];
    const paper = R.paper[k];
    fill(card,
      h("p", { class: "label" }, `${k === "weighted" ? "Weighted (WCMP)" : L.SCHEME_LABEL[k]} delivers`),
      h("div", { class: "lab-big" }, h("span", { class: "lab-big-num" }, fmt(r.total)), h("span", { class: "lab-big-of" }, ` / ${fmt(r.demand)} Gbps`),
        paper != null ? h("span", { class: "badge badge-gold" }, `${paper} · paper`) : null),
      h("p", { class: "lab-why" }, L.whyLine(s, s.scenario, k)),
      h("p", { class: "lab-util" }, `Busiest link ${pct(r.maxUtil)}`, k === "conga" ? " · what CONGA minimizes" : "", r.swing ? ` · swings ${fmt(r.swing[0])}–${fmt(r.swing[1])}` : ""),
      split,
      bars(R, vis),
      s.scenario === "ecmpWins" && s.ecmpWinsView === "delay" ? trace(R) : null,
      s.scenario === "ecmpWins" && s.ecmpWinsView === "fig17" && !s.revealed["ecmpWins:delay"]?.all
        ? h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.showEcmpWins(s, "delay")) }, "Another way CONGA can lose") : null,
      pred,
    );
  }

  function bars(R, vis) {
    const max = Math.max(...L.SCHEMES.map((x) => R[x].demand), 1);
    const you = (x) => {
      if (s.scenario === "fig2") return s.predictions.fig2?.[x];
      if (s.scenario === "fig3b" && x === "weighted") return s.predictions.fig3b?.weighted;
      return undefined;
    };
    return h("div", { class: "lab-bars" }, ...schemesFor().map((x) => {
      const shown = vis.has(x);
      const p = you(x);
      return h("button", { type: "button", class: `lab-bar${x === s.scheme ? " is-current" : ""}`, onclick: () => set(L.setScheme(s, x)), "aria-label": `${L.SCHEME_LABEL[x]}: ${shown ? fmt(R[x].total) : "hidden"} Gbps` },
        h("span", { class: "lab-bar-name" }, x === "weighted" ? "Weighted" : L.SCHEME_LABEL[x]),
        h("span", { class: "lab-bar-track" }, h("span", { class: "lab-bar-fill", style: `width:${shown ? Math.min(100, (R[x].total / max) * 100) : 0}%` })),
        h("span", { class: "lab-bar-val" }, shown ? fmt(R[x].total) : "?", Number.isFinite(p) ? h("span", { class: "lab-bar-you" }, ` (you: ${fmt(p)})`) : null));
    }));
  }

  function trace(R) {
    const c = h("div", { class: "lab-trace" });
    const t = R.trace.slice(0, 120);
    areaChart(c, { series: t, compare: t.map(() => R.ecmp.total), max: 80, height: 110, width: 420, yTicks: [0, 40, 80], label: "CONGA's total round by round (violet) against ECMP (dashed gold)" });
    return h("div", {}, c, h("ul", { class: "legend" }, h("li", {}, h("span", { class: "key" }), "CONGA, round by round"), h("li", {}, h("span", { class: "key key-compare" }), "ECMP")));
  }

  /** Predictions: compact inputs and one check button; null when there is nothing to predict. */
  function predictionBlock() {
    if (s.scenario === "fig2" && !L.canEdit(s, "fig2")) {
      const p = s.predictions.fig2 ?? {};
      const btn = h("button", { class: "btn btn-primary", type: "button", disabled: !["ecmp", "localOnly", "conga"].every((k) => Number.isFinite(p[k])), onclick: () => set(L.reveal(s, "fig2", "all")) }, "Check my predictions");
      const row = (k) => {
        const i = h("input", { class: "input lab-num", type: "number", min: "0", max: "400", step: "1", placeholder: "Gbps", "aria-label": `Your prediction for ${L.SCHEME_LABEL[k]} in Gbps` });
        if (Number.isFinite(p[k])) i.value = String(p[k]);
        i.addEventListener("input", () => {
          quiet(L.predict(s, "fig2", k, i.value === "" ? null : Number(i.value)));
          const q = s.predictions.fig2 ?? {};
          btn.disabled = !["ecmp", "localOnly", "conga"].every((x) => Number.isFinite(q[x]));
        });
        return h("label", { class: "lab-pred-row" }, h("span", {}, L.SCHEME_LABEL[k]), i, h("span", { class: "lab-pred-unit" }, "Gbps"));
      };
      return h("div", { class: "lab-pred" }, h("p", { class: "label" }, "Your predictions"), row("ecmp"), row("localOnly"), row("conga"), btn);
    }
    if (s.scenario === "fig3b" && s.fig3.committed && !s.revealed.fig3b?.all) {
      const p = s.predictions.fig3b?.weighted;
      const btn = h("button", { class: "btn btn-primary", type: "button", disabled: !Number.isFinite(p), onclick: () => set(L.reveal(s, "fig3b", "all")) }, "Check my prediction");
      const i = h("input", { class: "input lab-num", type: "number", min: "0", max: "400", step: "1", placeholder: "Gbps", "aria-label": "Your prediction: what your split delivers in (b), in Gbps" });
      if (Number.isFinite(p)) i.value = String(p);
      i.addEventListener("input", () => { quiet(L.predict(s, "fig3b", "weighted", i.value === "" ? null : Number(i.value))); btn.disabled = !Number.isFinite(s.predictions.fig3b?.weighted); });
      return h("div", { class: "lab-pred" }, h("p", { class: "label" }, "Your prediction"), h("label", { class: "lab-pred-row" }, h("span", {}, "Your split in (b)"), i, h("span", { class: "lab-pred-unit" }, "Gbps")), btn);
    }
    if (s.scenario === "fig3a" && !s.fig3.committed) {
      return h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.setScenario(L.commitWeights(s), "fig3b")) }, "Lock this split and go to (b)");
    }
    if (s.scenario === "ecmpWins" && s.ecmpWinsView && !s.revealed[`ecmpWins:${s.ecmpWinsView}`]?.all) {
      const key = `ecmpWins:${s.ecmpWinsView}`;
      const w = s.predictions[key]?.winner;
      return h("div", { class: "lab-pred" }, h("p", { class: "label" }, "Who delivers more here?"),
        toggle([["ecmp", "ECMP"], ["conga", "CONGA"]], w, (id) => set(L.predict(s, key, "winner", id))),
        h("button", { class: "btn btn-primary", type: "button", disabled: !w, onclick: () => set(L.setScheme(L.reveal(s, key, "all"), "conga")) }, "Check my prediction"));
    }
    if (s.scenario === "ecmpWins" && s.ecmpWinsView) {
      const key = `ecmpWins:${s.ecmpWinsView}`;
      const R = L.results(s);
      const won = R.ecmp.total > R.conga.total ? "ecmp" : "conga";
      return h("p", { class: "lab-you" }, `You said ${s.predictions[key].winner === "ecmp" ? "ECMP" : "CONGA"}${s.predictions[key].winner === won ? " ✓" : ""}.`,
        s.ecmpWinsView === "fig17" ? ` CONGA only lands here if it starts in this state; from ECMP it reaches ${fmt(R.congaFromEcmp)} Gbps too.` : ` With fresh data CONGA delivers ${fmt(R.congaFresh)} Gbps here, like ECMP.`);
    }
    return null;
  }

  /** Weighted mode: one split slider for two paths (more sliders for more paths). */
  function splitBlock() {
    if (s.scheme !== "weighted") return null;
    const { demands } = L.effective(s);
    const d = demands[s.selected];
    const P = L.demandPaths(s, s.scenario, s.selected);
    if (!d || P.length < 2) return h("p", { class: "lab-hint" }, d ? `${d.src}→${d.dst} has one path: nothing to split.` : "");
    const pair = `${d.src}>${d.dst}`;
    const locked = s.scenario === "fig3b" && !s.revealed.fig3b?.all;
    const mine = s.weights[L.weightsKey(s)]?.[pair];
    let shares = Object.fromEntries(P.map((p) => [p, mine ? mine[p] ?? 0 : 1 / P.length]));
    const sum = Object.values(shares).reduce((a, x) => a + x, 0) || 1;
    shares = Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, v / sum]));
    const head = h("p", { class: "label" }, `${d.src}→${d.dst} split${locked ? " (locked from (a))" : ""}`);
    if (P.length === 2) {
      const [a, b] = P;
      const lab = h("output", { class: "lab-split-val" }, `${a} ${Math.round(shares[a] * 100)}% · ${b} ${Math.round(shares[b] * 100)}%`);
      const r = h("input", { type: "range", min: "0", max: "100", step: "1", class: "lab-range", disabled: locked, "aria-label": `Share of ${d.src}→${d.dst} through ${a} (the rest goes through ${b})` });
      r.value = String(Math.round(shares[a] * 100));
      r.addEventListener("input", () => {
        const v = Number(r.value) / 100;
        lab.textContent = `${a} ${Math.round(v * 100)}% · ${b} ${100 - Math.round(v * 100)}%`;
        quiet(L.setWeight(s, pair, { [a]: v, [b]: 1 - v }));
        renderGraph(); refreshNumbers();
      });
      return h("div", { class: "lab-split" }, head, h("div", { class: "lab-split-row" }, h("span", {}, a), r, h("span", {}, b)), lab);
    }
    const rows = P.map((p) => {
      const r = h("input", { type: "range", min: "0", max: "100", step: "1", class: "lab-range", disabled: locked, "aria-label": `Weight via ${p}` });
      r.value = String(Math.round(shares[p] * 100));
      r.addEventListener("input", () => { shares = L.setShare(shares, p, Number(r.value) / 100); quiet(L.setWeight(s, pair, shares)); renderGraph(); refreshNumbers(); });
      return h("label", { class: "lab-split-row" }, h("span", {}, p), r);
    });
    return h("div", { class: "lab-split" }, head, ...rows);
  }

  /** While a split slider moves: update the big number and bars without rebuilding the slider. */
  function refreshNumbers() {
    const R = L.results(s);
    const vis = L.visibleSchemes(s);
    const num = card.querySelector(".lab-big-num");
    if (num && vis.has(s.scheme)) num.textContent = fmt(R[s.scheme].total);
    const old = card.querySelector(".lab-bars");
    if (old) old.replaceWith(bars(R, vis));
  }

  // ---------- below the graph ----------
  function answerBox(key, question, placeholder) {
    const t = h("textarea", { class: "input", rows: "2", maxlength: "1000", placeholder, "aria-label": question });
    t.value = s.answers[key] ?? "";
    t.addEventListener("input", () => { quiet(L.setAnswer(s, key, t.value)); renderStepper(); progress?.setDone("lab", L.isDone(s)); });
    return h("label", { class: "lab-answer" }, h("span", { class: "label" }, question), t);
  }

  function renderBelow() {
    if (s.scenario === "fig2" && L.canEdit(s, "fig2")) return fill(below, answerBox("fig2Why", "Why is local only worse than doing nothing smart?", "Think about what TCP does on the bottlenecked path, and what the source leaf sees on its own uplinks…"));
    if (s.scenario === "fig3b" && s.revealed.fig3b?.all) return fill(below, answerBox("fig3Why", "Why can't one set of weights fit both?", "What changed between (a) and (b), and who would have to know about it?"));
    if (s.scenario === "whyNot") {
      const t = h("textarea", { class: "input", rows: "4", maxlength: "1000", placeholder: "In two or three sentences…", "aria-label": "Where is CONGA's argument weakest?" });
      t.value = s.answers.whyNot ?? "";
      t.addEventListener("input", () => { quiet(L.setAnswer(s, "whyNot", t.value)); renderStepper(); progress?.setDone("lab", L.isDone(s)); });
      return fill(below, h("div", { class: "lab-whynot" },
        h("p", {}, "Some places to look:"),
        h("div", { class: "lab-prompts" }, ...WHY_NOT_PROMPTS.map((p) => h("button", { class: "chip", type: "button", onclick: () => {
          t.value = `${t.value}${t.value && !t.value.endsWith("\n") ? "\n" : ""}${p}: `;
          quiet(L.setAnswer(s, "whyNot", t.value));
          t.focus();
        } }, p))),
        t));
    }
    if (s.scenario === "sandbox") return fill(below, demandsTable());
    fill(below);
  }

  function demandsTable() {
    const { net, demands } = L.effective(s);
    const leafSel = (value, label, onchange) => {
      const sel = h("select", { class: "input", "aria-label": label }, ...net.leaves.map((x) => h("option", { value: x }, x)));
      sel.value = value;
      sel.addEventListener("change", () => onchange(sel.value));
      return sel;
    };
    const update = (i, patch) => set(L.setDemands(s, s.scenario, demands.map((d, j) => (j === i ? { ...d, ...patch } : d))));
    const rows = demands.map((d, i) => {
      const g = h("input", { class: "input lab-num", type: "number", min: "0", max: "400", step: "5", "aria-label": `Demand ${i + 1} in Gbps` });
      g.value = String(d.gbps);
      g.addEventListener("change", () => update(i, { gbps: Number(g.value) || 0 }));
      return h("tr", { class: i === s.selected ? "is-selected" : "" },
        h("td", {}, h("input", { type: "radio", name: "lab-demand", "aria-label": `Show demand ${i + 1}`, checked: i === s.selected, onchange: () => set(L.setSelected(s, i)) })),
        h("td", {}, leafSel(d.src, `Demand ${i + 1} from`, (v) => update(i, { src: v }))), h("td", {}, "→"),
        h("td", {}, leafSel(d.dst, `Demand ${i + 1} to`, (v) => update(i, { dst: v }))),
        h("td", {}, g, " Gbps"),
        h("td", {}, demands.length > 1 ? h("button", { class: "btn btn-ghost lab-del", type: "button", "aria-label": `Remove demand ${i + 1}`, onclick: () => set(L.setDemands(s, s.scenario, demands.filter((_, j) => j !== i))) }, "Remove") : null));
    });
    return h("div", { class: "lab-demands" },
      h("p", { class: "label" }, "Demands (long-lived TCP)"),
      h("table", { class: "lab-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Show"), h("th", {}, "From"), h("th", {}, ""), h("th", {}, "To"), h("th", {}, "Rate"), h("th", {}, ""))), h("tbody", {}, rows)),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => set(L.setDemands(s, s.scenario, [...demands, { src: net.leaves[0], dst: net.leaves.at(-1), gbps: 40 }])) }, "+ Add a demand"));
  }

  save();
  render();
  return { get state() { return s; } };
}
