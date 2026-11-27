// Asymmetry lab (step 06): the UI's state and rules, pure (no DOM). The numbers come from
// model.js; this decides what may be shown (no result before its prediction), what may be
// edited, and when each guided step is done. The state is plain JSON (saved under STORE_KEY).

import { SCENARIOS, buildNet, evaluate, schemes, congaDynamics, paths } from "./model.js";

export const STORE_KEY = "hw:lab";
export const SCHEMES = ["ecmp", "localOnly", "conga", "weighted"];
export const SCHEME_LABEL = { ecmp: "ECMP", localOnly: "Local only", conga: "CONGA", weighted: "Weighted (WCMP)" };
export const SCENARIO_IDS = ["fig2", "fig3a", "fig3b", "sandbox", "ecmpWins"];
export const SCENARIO_LABEL = { fig2: "Fig 2", fig3a: "Fig 3a", fig3b: "Fig 3b", sandbox: "Sandbox", ecmpWins: "ECMP wins?" };
const MIN_ANSWER = { fig2Why: 10, fig3Why: 10, whyNot: 20 };

/** Sandbox starting point: three leaves, two spines, all links 80G; two leaves send to L2. */
const SANDBOX = {
  source: "Sandbox",
  net: buildNet(["L0", "L1", "L2"], ["S0", "S1"], { "L0-S0": 80, "L0-S1": 80, "L1-S0": 80, "L1-S1": 80, "S0-L2": 80, "S1-L2": 80 }),
  demands: [{ src: "L0", dst: "L2", gbps: 60 }, { src: "L1", dst: "L2", gbps: 60 }],
};

const clone = (x) => JSON.parse(JSON.stringify(x));

export function initialState() {
  return {
    v: 1,
    scenario: "fig2",
    scheme: "ecmp",
    selected: 0, // the demand whose paths are drawn (and weighted sliders shown)
    ecmpWinsView: null, // null = the hint card; "fig17" | "delay"
    fig3: { committed: false },
    predictions: {}, // { "fig2": { ecmp: 90, ... }, "fig3b": { weighted: 60 }, "ecmpWins:fig17": { winner: "ecmp" } }
    revealed: {}, // { "fig2": { ecmp: true }, "fig3b": { all: true }, ... }
    answers: { fig2Why: "", fig3Why: "", whyNot: "" },
    weights: {}, // WCMP weights: { [scenario]: { "src>dst": { spine: share } } }; Fig 3a and 3b share "fig3"
    edits: {}, // per scenario key: { links: { "L0-S0": 40 }, demands: [...] | null }
  };
}

const viewKey = (s, scenario) => (scenario === "ecmpWins" ? `ecmpWins:${s.ecmpWinsView ?? "fig17"}` : scenario);
/** Whose weights a scenario uses: Fig 3a and 3b share one set (that is the exercise). */
export const weightsKey = (s, scenario = s.scenario) => (scenario === "fig3a" || scenario === "fig3b" ? "fig3" : viewKey(s, scenario));

function base(s, scenario) {
  if (scenario === "sandbox") return SANDBOX;
  if (scenario === "ecmpWins") return s.ecmpWinsView === "delay" ? SCENARIOS.ecmpWinsDelay : SCENARIOS.fig17;
  return SCENARIOS[scenario];
}

/** The scenario as currently edited: { net, demands, base, key, edited }. */
export function effective(s, scenario = s.scenario) {
  const b = base(s, scenario);
  const key = viewKey(s, scenario);
  const e = s.edits[key];
  const net = clone(b.net);
  for (const [k, c] of Object.entries(e?.links ?? {})) {
    const [a, z] = k.split("-");
    net.cap[`${a}>${z}`] = c;
    net.cap[`${z}>${a}`] = c;
  }
  const demands = e?.demands ? clone(e.demands) : clone(b.demands);
  return { net, demands, base: b, key, edited: !!e };
}

// ---------- results (memoized: the same inputs give the same numbers) ----------

const memo = new Map();

/** Every scheme's result for a scenario, plus paper numbers and notes. */
export function results(s, scenario = s.scenario) {
  const { net, demands, base: b, key, edited } = effective(s, scenario);
  const weights = s.weights[weightsKey(s, scenario)] ?? {};
  const memoKey = JSON.stringify([key, net.cap, demands, weights]);
  if (memo.has(memoKey)) return memo.get(memoKey);
  const run = (splits) => {
    const result = evaluate(net, demands, splits);
    return { splits, result, total: result.total, demand: result.demand, maxUtil: result.maxUtil };
  };
  const out = {
    ecmp: run(schemes.ecmp(net, demands)),
    localOnly: run(schemes.localOnly(net, demands)),
    weighted: run(schemes.weighted(net, demands, weights)),
    paper: scenario === "fig2" ? { ...SCENARIOS.fig2.paper } : {},
    note: b.note ?? null,
    beyondPaper: !!b.beyondPaper,
    source: b.source,
  };
  if (b === SCENARIOS.ecmpWinsDelay) {
    const dyn = congaDynamics(net, demands, { feedbackDelay: b.feedbackDelay, start: edited ? undefined : b.start });
    const last = run(dyn.splits);
    out.conga = { ...last, total: dyn.avgTotal, swing: [dyn.minTotal, dyn.maxTotal] };
    out.trace = dyn.trace;
    out.congaFresh = congaDynamics(net, demands, { feedbackDelay: 0, start: edited ? undefined : b.start }).avgTotal;
  } else if (b === SCENARIOS.fig17 && !s.edits[key]?.demands) {
    out.conga = run(schemes.conga(net, demands, { start: b.nash })); // stuck in the paper's Nash flow
    out.congaFromEcmp = run(schemes.conga(net, demands)).total;
  } else {
    out.conga = run(schemes.conga(net, demands));
  }
  if (memo.size > 200) memo.clear();
  memo.set(memoKey, out);
  return out;
}

// ---------- what may be shown and edited ----------

const ALL = () => new Set(SCHEMES);

export function visibleSchemes(s, scenario = s.scenario) {
  const rev = s.revealed;
  switch (scenario) {
    case "fig2": // each scheme after its own prediction; Weighted too once all three are revealed
      return canEdit(s, "fig2") ? ALL() : new Set(SCHEMES.filter((k) => rev.fig2?.[k]));
    case "fig3a": return s.fig3.committed ? ALL() : new Set(["weighted"]);
    case "fig3b": return rev.fig3b?.all ? ALL() : new Set();
    case "sandbox": return ALL();
    case "ecmpWins": return s.ecmpWinsView && rev[`ecmpWins:${s.ecmpWinsView}`]?.all ? ALL() : new Set();
    default: return new Set();
  }
}

export function canEdit(s, scenario = s.scenario) {
  switch (scenario) {
    case "sandbox": return true;
    case "fig2": return ["ecmp", "localOnly", "conga"].every((k) => s.revealed.fig2?.[k]);
    case "fig3a": return s.fig3.committed;
    case "fig3b": return !!s.revealed.fig3b?.all;
    case "ecmpWins": return !!(s.ecmpWinsView && s.revealed[`ecmpWins:${s.ecmpWinsView}`]?.all);
    default: return false;
  }
}

// ---------- changes (each returns a new state) ----------

export const setScenario = (s, scenario) => {
  if (!SCENARIO_IDS.includes(scenario)) throw new Error(`unknown scenario ${scenario}`);
  return { ...clone(s), scenario, selected: 0 };
};
export const setScheme = (s, scheme) => ({ ...clone(s), scheme });
export const setSelected = (s, i) => ({ ...clone(s), selected: i });
export const showEcmpWins = (s, view) => ({ ...clone(s), scenario: "ecmpWins", ecmpWinsView: view, selected: 0 });

export function predict(s, key, field, value) {
  const n = clone(s);
  (n.predictions[key] ??= {})[field] = value;
  return n;
}

export function reveal(s, key, field) {
  const p = s.predictions[key] ?? {};
  if (key === "fig2" && !Number.isFinite(p[field])) throw new Error("predict this scheme's total first");
  if (key === "fig3b") {
    if (!s.fig3.committed) throw new Error("commit your 3a weights first");
    if (!Number.isFinite(p.weighted)) throw new Error("predict the total in (b) first");
  }
  if (key.startsWith("ecmpWins:") && !["ecmp", "conga"].includes(p.winner)) throw new Error("predict who wins first");
  const n = clone(s);
  (n.revealed[key] ??= {})[field] = true;
  return n;
}

export const commitWeights = (s) => ({ ...clone(s), fig3: { committed: true } });

/** WCMP weights for one demand of the current scenario. */
export function setWeight(s, pair, shares) {
  const n = clone(s);
  (n.weights[weightsKey(s)] ??= {})[pair] = { ...shares };
  return n;
}

/** Move one slider; the others rescale so the shares still sum to 1. */
export function setShare(shares, spine, value) {
  const v = Math.min(1, Math.max(0, value));
  const others = Object.keys(shares).filter((k) => k !== spine);
  const rest = others.reduce((a, k) => a + (shares[k] ?? 0), 0);
  const out = { [spine]: v };
  for (const k of others) out[k] = rest > 1e-12 ? ((shares[k] ?? 0) / rest) * (1 - v) : (1 - v) / others.length;
  return out;
}

function editable(s, scenario) {
  if (!canEdit(s, scenario)) throw new Error(`not yet: finish this step before editing ${scenario}`);
  return viewKey(s, scenario);
}

export function setLinkCap(s, scenario, link, cap) {
  const key = editable(s, scenario);
  const n = clone(s);
  const e = (n.edits[key] ??= { links: {}, demands: null });
  e.links[link] = Math.max(0, Math.min(80, Math.round(cap)));
  return n;
}

export function setDemands(s, scenario, demands) {
  const key = editable(s, scenario);
  const { net } = effective(s, scenario);
  const ok = demands.filter((d) => net.leaves.includes(d.src) && net.leaves.includes(d.dst) && d.src !== d.dst && d.gbps >= 0);
  const n = clone(s);
  const e = (n.edits[key] ??= { links: {}, demands: null });
  e.demands = ok.map((d) => ({ src: d.src, dst: d.dst, gbps: Math.min(400, Number(d.gbps) || 0) }));
  n.selected = Math.min(n.selected, Math.max(0, ok.length - 1));
  return n;
}

export function resetScenario(s, scenario) {
  const n = clone(s);
  delete n.edits[viewKey(s, scenario)];
  n.selected = 0;
  return n;
}

export function setAnswer(s, key, text) {
  const n = clone(s);
  n.answers[key] = String(text).slice(0, 1000);
  return n;
}

// ---------- progress ----------

const answered = (s, key) => (s.answers[key] ?? "").trim().length >= MIN_ANSWER[key];

export function steps(s) {
  return {
    fig2: ["ecmp", "localOnly", "conga"].every((k) => s.revealed.fig2?.[k]) && answered(s, "fig2Why"),
    fig3: !!s.revealed.fig3b?.all && answered(s, "fig3Why"),
    ecmpWins: !!(s.revealed["ecmpWins:fig17"]?.all && s.revealed["ecmpWins:delay"]?.all),
    whyNot: answered(s, "whyNot"),
  };
}

export const isDone = (s) => Object.values(steps(s)).every(Boolean);

/** The paths a demand uses in a scenario (for the drawing and the weight sliders). */
export function demandPaths(s, scenario, i) {
  const { net, demands } = effective(s, scenario);
  const d = demands[i];
  return d ? paths(net, d.src, d.dst) : [];
}

export function submission(s) {
  return {
    predictions: clone(s.predictions),
    revealed: clone(s.revealed),
    answers: { ...s.answers },
    weights: clone(s.weights),
    edits: clone(s.edits),
    steps: steps(s),
    done: isDone(s),
  };
}

export function restore(raw) {
  const fresh = initialState();
  if (!raw || typeof raw !== "object" || raw.v !== 1) return fresh;
  if (!SCENARIO_IDS.includes(raw.scenario) || !SCHEMES.includes(raw.scheme)) return fresh;
  for (const k of ["predictions", "revealed", "answers", "weights", "edits", "fig3"]) {
    if (!raw[k] || typeof raw[k] !== "object" || Array.isArray(raw[k])) return fresh;
  }
  if (![null, "fig17", "delay"].includes(raw.ecmpWinsView) || !Number.isInteger(raw.selected)) return fresh;
  return clone(raw);
}
