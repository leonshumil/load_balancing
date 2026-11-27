// Section 4, the asymmetry lab (step 06): DOM only. Rules and numbers live in state.js and
// model.js; the drawing in draw.js. Everything is saved under STORE_KEY, so a reload restores
// predictions, answers, weights and sandbox edits.

import * as store from "../../../shared/store.js";
import { chipRow, areaChart } from "../../../shared/ui.js";
import * as L from "./state.js";
import { drawFabric } from "./draw.js";

const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const pct = (x) => `${Math.round(x * 100)}%`;

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

const WHY_NOT_PROMPTS = ["Stale feedback", "2-tier only", "PoA = 2", "A shared last hop"];

export function initLab({ root, progress }) {
  if (!root) return;
  let s = L.restore(store.get(L.STORE_KEY));
  let linkSel = null; // the link being edited (not saved)
  const save = () => store.set(L.STORE_KEY, s);
  const set = (n) => { s = n; save(); render(); };
  const quiet = (n) => { s = n; save(); }; // inputs: save without re-rendering (keeps focus)

  const stepsHost = h("ol", { class: "lab-steps", "aria-label": "Lab steps" });
  const scenarioHost = h("div", {});
  const resetBtn = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { linkSel = null; set(L.resetScenario(s, s.scenario)); } }, "Reset to paper");
  const guideHost = h("div", { class: "lab-guide panel-inset" });
  const drawHost = h("div", { class: "lab-draw" });
  const linkHost = h("div", { class: "lab-link-editor" });
  const schemeHost = h("div", {});
  const cardHost = h("div", { class: "lab-card" });
  const weightsHost = h("div", { class: "lab-weights" });
  const barsHost = h("div", { class: "lab-bars" });
  const demandsHost = h("div", { class: "lab-demands" });
  const whyHost = h("div", { class: "lab-whynot panel-inset" });
  root.replaceChildren(
    stepsHost,
    h("div", { class: "lab-top" }, scenarioHost, resetBtn),
    guideHost,
    h("div", { class: "lab-grid" },
      h("div", { class: "lab-left" }, drawHost, linkHost),
      h("div", { class: "lab-right" }, h("p", { class: "label" }, "Scheme"), schemeHost, cardHost, weightsHost, barsHost)),
    demandsHost,
    whyHost,
  );

  // ---------- render ----------
  function render() {
    // Fig 3a is about tuning weights: Weighted mode until they are locked (saved like any change)
    if (s.scenario === "fig3a" && !s.fig3.committed && s.scheme !== "weighted") quiet(L.setScheme(s, "weighted"));
    renderSteps();
    chipRow(scenarioHost, L.SCENARIO_IDS.map((id) => ({ id, label: L.SCENARIO_LABEL[id] })), {
      selected: s.scenario, label: "Scenario",
      onSelect: (id) => { linkSel = null; set(id === "ecmpWins" && s.ecmpWinsView === null ? L.setScenario(s, id) : L.setScenario(s, id)); },
    });
    resetBtn.hidden = !L.effective(s).edited;
    renderGuide();
    chipRow(schemeHost, L.SCHEMES.map((id) => ({ id, label: L.SCHEME_LABEL[id] })), {
      selected: s.scheme, label: "Scheme", onSelect: (id) => set(L.setScheme(s, id)),
    });
    renderWeights();
    renderLinkEditor();
    renderDemands();
    renderWhyNot();
    renderLive();
  }

  /** The parts that follow the numbers (cheap enough to redo while a slider moves). */
  function renderLive() {
    const R = L.results(s);
    const vis = L.visibleSchemes(s);
    const { net, demands, base } = L.effective(s);
    const shown = vis.has(s.scheme) ? R[s.scheme] : null;
    const d = demands[s.selected] ?? null;
    drawFabric(drawHost, {
      net, baseNet: base.net, result: shown?.result ?? null,
      demand: d, demandPaths: L.demandPaths(s, s.scenario, s.selected),
      splitRates: shown?.result.perDemand[s.selected]?.rates ?? {},
      editable: L.canEdit(s), selectedLink: linkSel,
      onLink: (k) => { linkSel = k; renderLinkEditor(); renderLive(); },
    });
    renderCard(R, vis);
    renderBars(R, vis);
    progress?.setDone("lab", L.isDone(s));
  }

  function renderSteps() {
    const st = L.steps(s);
    const items = [
      ["fig2", "1 · Fig 2", st.fig2, () => set(L.setScenario(s, "fig2"))],
      ["fig3", "2 · Fig 3", st.fig3, () => set(L.setScenario(s, s.fig3.committed ? "fig3b" : "fig3a"))],
      ["ecmpWins", "3 · ECMP wins?", st.ecmpWins, () => set(L.setScenario(s, "ecmpWins"))],
      ["whyNot", "4 · Why not", st.whyNot, () => whyHost.scrollIntoView({ block: "center" })],
    ];
    stepsHost.replaceChildren(...items.map(([, text, done, go]) =>
      h("li", {}, h("button", { class: `chip lab-step${done ? " is-done" : ""}`, type: "button", onclick: go }, text))));
  }

  // ---------- the guide card: one per scenario ----------
  function renderGuide() {
    const g = { fig2: guideFig2, fig3a: guideFig3a, fig3b: guideFig3b, sandbox: guideSandbox, ecmpWins: guideEcmpWins }[s.scenario];
    guideHost.replaceChildren(...g());
  }

  const paperTag = (v) => h("span", { class: "badge badge-gold" }, `${v} · paper`);

  function numberInput(value, label, oninput) {
    const i = h("input", { class: "input lab-num", type: "number", min: "0", max: "400", step: "1", inputmode: "numeric", "aria-label": label, placeholder: "Gbps" });
    if (Number.isFinite(value)) i.value = String(value);
    i.addEventListener("input", () => oninput(i.value === "" ? null : Number(i.value)));
    return i;
  }

  function answerBox(key, question, placeholder) {
    const t = h("textarea", { class: "input", rows: "2", maxlength: "1000", placeholder, "aria-label": question });
    t.value = s.answers[key] ?? "";
    t.addEventListener("input", () => { quiet(L.setAnswer(s, key, t.value)); renderSteps(); progress?.setDone("lab", L.isDone(s)); });
    return h("label", { class: "lab-answer" }, h("span", { class: "label" }, question), t);
  }

  function guideFig2() {
    const R = L.results(s, "fig2");
    const rows = ["ecmp", "localOnly", "conga"].map((k) => {
      const revealed = !!s.revealed.fig2?.[k];
      const p = s.predictions.fig2?.[k];
      const btn = h("button", { class: "btn btn-primary", type: "button", disabled: !Number.isFinite(p),
        onclick: () => set(L.reveal(s, "fig2", k)) }, "Reveal");
      const input = numberInput(p, `Your prediction for ${L.SCHEME_LABEL[k]} (Gbps)`, (v) => {
        quiet(L.predict(s, "fig2", k, v));
        btn.disabled = !Number.isFinite(v);
      });
      if (revealed) input.disabled = true;
      return h("div", { class: "lab-predict-row" },
        h("span", { class: "lab-predict-name" }, L.SCHEME_LABEL[k]),
        input,
        revealed ? h("span", { class: "lab-predict-result" }, h("strong", {}, `${fmt(R[k].total)} Gbps`), " ", paperTag(R.paper[k])) : btn);
    });
    const all = L.canEdit(s, "fig2");
    return [
      h("h3", {}, "Step 1 · Figure 2: does local load balancing help?"),
      h("p", {}, "L0 sends 100 Gbps of TCP traffic to L1. The S1–L1 link has half the capacity (40G) of the others (80G). Predict the total each scheme delivers, then reveal it."),
      h("div", { class: "lab-predict" }, rows),
      all ? answerBox("fig2Why", "Why is local only worse than doing nothing smart?", "Think about what TCP does on the bottlenecked path, and what the source leaf sees on its own uplinks…") : null,
    ];
  }

  function guideFig3a() {
    const committed = s.fig3.committed;
    return [
      h("h3", {}, "Step 2 · Figure 3: one set of weights for two traffic matrices?"),
      h("p", {}, "(a) L1 sends 80 Gbps to L2; L0 sends nothing. Static weights are WCMP from Unit 4. Set the L1→L2 weights (right) to get the best throughput."),
      committed
        ? h("p", { class: "tutor-note" }, "Weights locked. Now see what they do when the traffic changes.")
        : null,
      h("div", { class: "btn-row" },
        committed
          ? h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.setScenario(s, "fig3b")) }, "Go to (b)")
          : h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.setScenario(L.commitWeights(s), "fig3b")) }, "Lock these weights and go to (b)")),
    ];
  }

  function guideFig3b() {
    if (!s.fig3.committed) {
      return [h("h3", {}, "Step 2 · Figure 3 (b)"), h("p", {}, "Set and lock your weights in Fig 3a first."),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.setScenario(s, "fig3a")) }, "Go to Fig 3a")];
    }
    const revealed = !!s.revealed.fig3b?.all;
    const p = s.predictions.fig3b?.weighted;
    const w = s.weights.fig3?.["L1>L2"];
    const wText = w ? Object.entries(w).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(" · ") : "50/50 (ECMP)";
    const btn = h("button", { class: "btn btn-primary", type: "button", disabled: !Number.isFinite(p), onclick: () => set(L.reveal(s, "fig3b", "all")) }, "Reveal");
    const input = numberInput(p, "Your prediction for the total in (b) with your weights (Gbps)", (v) => { quiet(L.predict(s, "fig3b", "weighted", v)); btn.disabled = !Number.isFinite(v); });
    if (revealed) input.disabled = true;
    const R = L.results(s, "fig3b");
    return [
      h("h3", {}, "Step 2 · Figure 3 (b): same weights, new traffic"),
      h("p", {}, `Now L0 also sends 40 Gbps to L2 (L0 reaches L2 only through S0), and L1 sends 40. Your L1→L2 weights stay ${wText}.`),
      h("div", { class: "lab-predict" }, h("div", { class: "lab-predict-row" },
        h("span", { class: "lab-predict-name" }, "Total with your weights"), input,
        revealed ? h("span", { class: "lab-predict-result" }, h("strong", {}, `${fmt(R.weighted.total)} Gbps`), ` · CONGA ${fmt(R.conga.total)} Gbps`) : btn)),
      revealed ? answerBox("fig3Why", "Why can't one set of weights fit both?", "What changed between (a) and (b), and who would have to know about it?") : null,
    ];
  }

  function guideSandbox() {
    return [
      h("h3", {}, "Sandbox"),
      h("p", {}, "Click a link to change its capacity (0 = failed), and edit the demands below. Every scheme recomputes at once; compare them on the right."),
    ];
  }

  function guideEcmpWins() {
    const view = s.ecmpWinsView;
    if (!view) {
      return [
        h("h3", {}, "Step 3 · ECMP wins?"),
        h("p", {}, "CONGA is selfish: each leaf picks its own least-congested path. Can you build a setting where ECMP beats it? Hint: §6, Figure 17."),
        h("div", { class: "btn-row" },
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => set(L.setScenario(s, "sandbox")) }, "Try in Sandbox"),
          h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.showEcmpWins(s, "fig17")) }, "Show me")),
      ];
    }
    const key = `ecmpWins:${view}`;
    const revealed = !!s.revealed[key]?.all;
    const R = L.results(s, "ecmpWins");
    const pick = h("div", {});
    chipRow(pick, [{ id: "ecmp", label: "ECMP" }, { id: "conga", label: "CONGA" }], {
      selected: s.predictions[key]?.winner ?? null, label: "Who delivers more here?",
      onSelect: (id) => set(L.predict(s, key, "winner", id)),
    });
    const views = h("div", {});
    chipRow(views, [{ id: "fig17", label: "Fig 17: stuck" }, { id: "delay", label: "Stale feedback" }], {
      selected: view, label: "Which case", onSelect: (id) => set(L.showEcmpWins(s, id)),
    });
    const out = [
      h("div", { class: "lab-guide-head" }, h("h3", {}, "Step 3 · ECMP wins?"), s.revealed["ecmpWins:fig17"]?.all ? views : null),
      view === "fig17"
        ? h("p", {}, "§6.1, Figure 17: five leaves and five spines in a ring; neighbouring leaves send to each other. Here each pair sends 60 Gbps over 40G links, and CONGA starts in the flow the paper draws (each pair on the spine they share).")
        : h("p", {}, h("span", { class: "badge badge-violet" }, "beyond the paper's model"), " Two leaves send 40 Gbps each to L2 over two equal spines. CONGA reacts to congestion data that is 3 rounds old."),
    ];
    if (!revealed) {
      out.push(h("p", { class: "label" }, "Predict: who delivers more here?"), pick,
        h("button", { class: "btn btn-primary", type: "button", disabled: !s.predictions[key]?.winner, onclick: () => set(L.setScheme(L.reveal(s, key, "all"), "conga")) }, "Reveal"));
      return out;
    }
    const you = s.predictions[key].winner;
    const winner = R.ecmp.total > R.conga.total ? "ecmp" : "conga";
    out.push(h("p", {}, h("strong", {}, `ECMP ${fmt(R.ecmp.total)} Gbps · CONGA ${fmt(R.conga.total)} Gbps`),
      view === "delay" ? ` (average; it swings ${fmt(R.conga.swing[0])}–${fmt(R.conga.swing[1])})` : "",
      ` · you said ${you === "ecmp" ? "ECMP" : "CONGA"}${you === winner ? " ✓" : ""}`));
    out.push(h("p", { class: "tutor-note" }, R.note));
    if (view === "fig17") {
      if (!s.revealed["ecmpWins:delay"]?.all) {
        out.push(h("button", { class: "btn btn-primary", type: "button", onclick: () => set(L.showEcmpWins(s, "delay")) }, "Another way CONGA can lose (beyond the paper's model)"));
      }
    } else {
      const chart = h("div", { class: "lab-trace" });
      const trace = R.trace.slice(0, 120);
      areaChart(chart, { series: trace, compare: trace.map(() => R.ecmp.total), max: 80, height: 130, width: 560, yTicks: [0, 40, 80], label: "CONGA's total per round (violet) against ECMP (dashed gold)" });
      out.push(chart, h("ul", { class: "legend" },
        h("li", {}, h("span", { class: "key" }), "CONGA, round by round"), h("li", {}, h("span", { class: "key key-compare" }), "ECMP")),
        h("p", { class: "tutor-note" }, `With fresh data CONGA delivers ${fmt(R.congaFresh)} Gbps here, the same as ECMP.`));
    }
    return out;
  }

  // ---------- right column: result card, weights, bars ----------
  function renderCard(R, vis) {
    const k = s.scheme;
    if (!vis.has(k)) {
      cardHost.replaceChildren(h("p", { class: "lab-card-hidden" }, s.scenario === "fig3a" ? "Lock your weights to see the other schemes." : "Make your prediction first: the result appears when you reveal it."));
      return;
    }
    const r = R[k];
    cardHost.replaceChildren(...[ // (filter: replaceChildren would print a null)
      h("p", { class: "label" }, `${L.SCHEME_LABEL[k]}: total throughput`),
      h("div", { class: "lab-big" }, h("span", { class: "lab-big-num" }, fmt(r.total)), h("span", { class: "lab-big-of" }, ` / ${fmt(r.demand)} Gbps`)),
      R.paper[k] != null ? paperTag(R.paper[k]) : null,
      k === "conga" && r.swing ? h("p", { class: "tutor-note" }, `average over time; swings ${fmt(r.swing[0])}–${fmt(r.swing[1])}`) : null,
      h("p", { class: "lab-util" }, `Max link utilization ${pct(r.maxUtil)}`, k === "conga" ? h("span", { class: "tutor-note" }, " (what CONGA minimizes)") : null),
    ].filter(Boolean));
  }

  function renderBars(R, vis) {
    const max = Math.max(...L.SCHEMES.map((k) => R[k].demand), 1);
    barsHost.replaceChildren(h("p", { class: "label" }, "All schemes"), ...L.SCHEMES.map((k) => {
      const shown = vis.has(k);
      const v = R[k].total;
      return h("div", { class: `lab-bar${k === s.scheme ? " is-current" : ""}` },
        h("span", { class: "lab-bar-name" }, L.SCHEME_LABEL[k]),
        h("span", { class: "lab-bar-track" }, h("span", { class: "lab-bar-fill", style: `width:${shown ? Math.min(100, (v / max) * 100) : 0}%` })),
        h("span", { class: "lab-bar-val" }, shown ? fmt(v) : "?"));
    }));
  }

  function renderWeights() {
    if (s.scheme !== "weighted") return weightsHost.replaceChildren();
    const { demands } = L.effective(s);
    const d = demands[s.selected];
    const P = L.demandPaths(s, s.scenario, s.selected);
    if (!d || P.length < 2) return weightsHost.replaceChildren(h("p", { class: "tutor-note" }, "This demand has only one path: nothing to weigh."));
    const pair = `${d.src}>${d.dst}`;
    const locked = s.scenario === "fig3b" && !s.revealed.fig3b?.all;
    const mine = s.weights[L.weightsKey(s)]?.[pair];
    let shares = mine ? Object.fromEntries(P.map((p) => [p, mine[p] ?? 0])) : Object.fromEntries(P.map((p) => [p, 1 / P.length]));
    const sum = Object.values(shares).reduce((a, x) => a + x, 0) || 1;
    shares = Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, v / sum]));
    const labels = {};
    const sliders = {};
    const rows = P.map((p) => {
      const r = h("input", { type: "range", min: "0", max: "100", step: "1", class: "lab-range", "aria-label": `Weight of ${d.src}→${d.dst} via ${p}`, disabled: locked });
      r.value = String(Math.round(shares[p] * 100));
      labels[p] = h("span", { class: "lab-range-val" }, `${Math.round(shares[p] * 100)}%`);
      sliders[p] = r;
      r.addEventListener("input", () => {
        shares = L.setShare(shares, p, Number(r.value) / 100);
        for (const q of P) { if (q !== p) sliders[q].value = String(Math.round(shares[q] * 100)); labels[q].textContent = `${Math.round(shares[q] * 100)}%`; }
        quiet(L.setWeight(s, pair, shares));
        renderLive();
      });
      return h("label", { class: "lab-range-row" }, h("span", {}, `via ${p}`), r, labels[p]);
    });
    weightsHost.replaceChildren(h("p", { class: "label" }, `Weights for ${d.src}→${d.dst}${locked ? " (locked from 3a)" : ""}`), ...rows);
  }

  function renderLinkEditor() {
    if (!linkSel || !L.canEdit(s)) return linkHost.replaceChildren(L.canEdit(s) ? h("p", { class: "tutor-note" }, "Click a link to change its capacity.") : h("p", { class: "tutor-note" }, "Finish this step to edit the links and demands."));
    const { net } = L.effective(s);
    const [l, sp] = linkSel.split("-");
    const cap = Math.max(net.cap[`${l}>${sp}`] ?? 0, net.cap[`${sp}>${l}`] ?? 0);
    const val = h("span", { class: "lab-range-val" }, cap === 0 ? "failed" : `${cap}G`);
    const r = h("input", { type: "range", min: "0", max: "80", step: "5", class: "lab-range", "aria-label": `Capacity of ${l}–${sp} (Gbps, 0 = failed)` });
    r.value = String(cap);
    r.addEventListener("input", () => {
      const v = Number(r.value);
      val.textContent = v === 0 ? "failed" : `${v}G`;
      quiet(L.setLinkCap(s, s.scenario, linkSel, v));
      resetBtn.hidden = false;
      renderLive();
    });
    linkHost.replaceChildren(h("div", { class: "lab-range-row" }, h("span", {}, `${l}–${sp}`), r, val,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => { linkSel = null; renderLinkEditor(); renderLive(); } }, "Done")));
  }

  // ---------- demands table ----------
  function renderDemands() {
    const { net, demands } = L.effective(s);
    const ed = L.canEdit(s);
    const leafSel = (value, label, onchange) => {
      const sel = h("select", { class: "input", "aria-label": label, disabled: !ed }, ...net.leaves.map((x) => h("option", { value: x }, x)));
      sel.value = value;
      sel.addEventListener("change", () => onchange(sel.value));
      return sel;
    };
    const update = (i, patch) => set(L.setDemands(s, s.scenario, demands.map((d, j) => (j === i ? { ...d, ...patch } : d))));
    const rows = demands.map((d, i) => {
      const g = h("input", { class: "input lab-num", type: "number", min: "0", max: "400", step: "5", "aria-label": `Demand ${i + 1} Gbps`, disabled: !ed });
      g.value = String(d.gbps);
      g.addEventListener("change", () => update(i, { gbps: Number(g.value) || 0 }));
      return h("tr", { class: i === s.selected ? "is-selected" : "" },
        h("td", {}, h("input", { type: "radio", name: "lab-demand", "aria-label": `Show demand ${i + 1} on the drawing`, checked: i === s.selected, onchange: () => set(L.setSelected(s, i)) })),
        h("td", {}, leafSel(d.src, `Demand ${i + 1} from`, (v) => update(i, { src: v }))),
        h("td", {}, "→"),
        h("td", {}, leafSel(d.dst, `Demand ${i + 1} to`, (v) => update(i, { dst: v }))),
        h("td", {}, g, " Gbps"),
        h("td", {}, ed && demands.length > 1 ? h("button", { class: "btn btn-ghost lab-del", type: "button", "aria-label": `Remove demand ${i + 1}`, onclick: () => set(L.setDemands(s, s.scenario, demands.filter((_, j) => j !== i))) }, "Remove") : null));
    });
    demandsHost.replaceChildren(
      h("p", { class: "label" }, "Demands (long-lived TCP)"),
      h("div", { class: "table-scroll" }, h("table", { class: "lab-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Show"), h("th", { scope: "col" }, "From"), h("th", {}, ""), h("th", { scope: "col" }, "To"), h("th", { scope: "col" }, "Rate"), h("th", {}, ""))),
        h("tbody", {}, rows))),
      ed ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => set(L.setDemands(s, s.scenario, [...demands, { src: net.leaves[0], dst: net.leaves.at(-1), gbps: 40 }])) }, "+ Add a demand") : null,
    );
  }

  // ---------- step 4: why not ----------
  function renderWhyNot() {
    const t = h("textarea", { class: "input", rows: "3", maxlength: "1000", placeholder: "In two or three sentences…", "aria-label": "Where is CONGA's argument weakest?" });
    t.value = s.answers.whyNot ?? "";
    t.addEventListener("input", () => { quiet(L.setAnswer(s, "whyNot", t.value)); renderSteps(); progress?.setDone("lab", L.isDone(s)); });
    whyHost.replaceChildren(
      h("h3", {}, "Step 4 · Why not?"),
      h("p", {}, "Where is CONGA's argument weakest? Some places to look:"),
      h("div", { class: "chips" }, ...WHY_NOT_PROMPTS.map((p) => h("button", { class: "chip", type: "button", onclick: () => {
        t.value = `${t.value}${t.value && !t.value.endsWith("\n") ? "\n" : ""}${p}: `;
        quiet(L.setAnswer(s, "whyNot", t.value));
        t.focus();
      } }, p))),
      t,
    );
  }

  save();
  render();
  return { get state() { return s; } };
}
