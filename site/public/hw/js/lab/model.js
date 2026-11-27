// Asymmetry lab model (step 05): a steady-state fluid model of a 2-tier leaf-spine. No DOM.
//
// Network: leaves, spines, directed link capacities in Gbps ("L0>S0" uplink, "S0>L1" downlink;
// missing or 0 = no link / failed). A path = uplink src->spine + downlink spine->dst (two hops, §2.2).
// Demands: { src, dst, gbps, flows? } = long-lived TCP; flows defaults to gbps.
//
// TCP model: for a given split of each demand over its paths, the rates are per-flow fair
// (weighted max-min by progressive filling: a sub-flow's weight is its share of the demand's
// flows), each sub-flow capped by its share of the demand. This deviates from the spec's plain
// per-path max-min on purpose: TCP is fair per flow, and only per-flow fairness reproduces
// §2.4's claim that local-only is worse than ECMP in Figure 3(b) (plain max-min gives a tie;
// both are tested). Figure 2 comes out the same either way.

const EPS = 1e-9;
const up = (leaf, spine) => `${leaf}>${spine}`;
const down = (spine, leaf) => `${spine}>${leaf}`;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** links: { "L0-S0": 80, ... } undirected (both directions get the capacity). */
export function buildNet(leaves, spines, links) {
  const cap = {};
  for (const [k, c] of Object.entries(links)) {
    const [a, b] = k.split("-");
    cap[`${a}>${b}`] = c;
    cap[`${b}>${a}`] = c;
  }
  return { leaves, spines, cap };
}

const capOf = (net, link) => net.cap[link] ?? 0;

/** The spines through which src reaches dst (both links up). */
export function paths(net, src, dst) {
  return net.spines.filter((s) => capOf(net, up(src, s)) > 0 && capOf(net, down(s, dst)) > 0);
}

/**
 * Steady-state rates for given splits (one { spine: share } per demand).
 * opts.fairness: "flow" (default, TCP per flow) | "path" (plain max-min per sub-flow).
 */
export function evaluate(net, demands, splits, { fairness = "flow" } = {}) {
  const subs = [];
  demands.forEach((d, i) => {
    for (const [s, share] of Object.entries(splits[i] ?? {})) {
      if (!(share > EPS) || !(d.gbps > 0)) continue;
      const links = [up(d.src, s), down(s, d.dst)];
      const alive = links.every((l) => capOf(net, l) > 0);
      subs.push({
        i, s, links, alive, rate: 0,
        cap: share * d.gbps,
        w: fairness === "flow" ? Math.max(share * (d.flows ?? d.gbps), EPS) : 1,
      });
    }
  });
  // progressive filling
  const rem = { ...net.cap };
  let active = subs.filter((x) => x.alive && x.cap > EPS);
  for (let guard = 0; active.length && guard < 1000; guard++) {
    const W = {};
    for (const x of active) for (const l of x.links) W[l] = (W[l] ?? 0) + x.w;
    let t = Infinity;
    for (const [l, w] of Object.entries(W)) t = Math.min(t, rem[l] / w);
    for (const x of active) t = Math.min(t, (x.cap - x.rate) / x.w);
    if (!Number.isFinite(t)) break;
    for (const x of active) {
      x.rate += x.w * t;
      for (const l of x.links) rem[l] -= x.w * t;
    }
    active = active.filter((x) => x.rate < x.cap - 1e-9 && x.links.every((l) => rem[l] > 1e-9));
  }
  const perDemand = demands.map((d) => ({ src: d.src, dst: d.dst, gbps: d.gbps, rates: {}, total: 0 }));
  const linkLoad = Object.fromEntries(Object.keys(net.cap).map((l) => [l, 0]));
  for (const x of subs) {
    perDemand[x.i].rates[x.s] = (perDemand[x.i].rates[x.s] ?? 0) + x.rate;
    perDemand[x.i].total += x.rate;
    if (x.alive) for (const l of x.links) linkLoad[l] += x.rate;
  }
  return summarize(net, demands, perDemand, linkLoad);
}

function summarize(net, demands, perDemand, linkLoad) {
  const linkUtil = {};
  for (const [l, c] of Object.entries(net.cap)) if (c > 0) linkUtil[l] = linkLoad[l] / c;
  const maxUtil = Math.max(0, ...Object.values(linkUtil));
  return {
    perDemand,
    total: perDemand.reduce((a, d) => a + d.total, 0),
    demand: demands.reduce((a, d) => a + (d.gbps > 0 ? d.gbps : 0), 0),
    linkLoad,
    linkUtil,
    maxUtil,
    bottlenecks: Object.entries(linkUtil).filter(([, u]) => u >= 0.99).map(([l]) => l).sort(),
  };
}

// ---------- schemes: each returns splits (one { spine: share } per demand) ----------

function ecmp(net, demands) {
  return demands.map((d) => {
    const P = paths(net, d.src, d.dst);
    return Object.fromEntries(P.map((s) => [s, 1 / P.length]));
  });
}

/** WCMP (Unit 4): static weights per demand, keyed "src>dst"; normalized over existing paths. */
function weighted(net, demands, weights = {}) {
  const eq = ecmp(net, demands);
  return demands.map((d, i) => {
    const w = weights[`${d.src}>${d.dst}`];
    const P = paths(net, d.src, d.dst);
    const sum = P.reduce((a, s) => a + Math.max(0, w?.[s] ?? 0), 0);
    if (!w || !(sum > 0)) return eq[i];
    return Object.fromEntries(P.map((s) => [s, Math.max(0, w[s] ?? 0) / sum]).filter(([, v]) => v > 0));
  });
}

/**
 * Selfish rebalancing: each demand moves traffic from its worst used path to its best path
 * (by `metric`) until no demand can improve. Steps shrink when a demand flips back and forth.
 */
function selfish(net, demands, metric, { start, fairness, maxIter = 6000, tol = 1e-6 } = {}) {
  const s = clone(start ?? ecmp(net, demands));
  const step = demands.map(() => 0.05);
  const last = demands.map(() => null);
  for (let it = 0; it < maxIter; it++) {
    const r = evaluate(net, demands, s, { fairness });
    let moved = false;
    demands.forEach((d, i) => {
      const P = paths(net, d.src, d.dst);
      if (P.length < 2 || step[i] < 1e-7) return;
      const m = Object.fromEntries(P.map((p) => [p, metric(r, d, p)]));
      const used = P.filter((p) => (s[i][p] ?? 0) > EPS);
      if (!used.length) return;
      const w = used.reduce((a, p) => (m[p] > m[a] ? p : a), used[0]);
      const b = P.reduce((a, p) => (m[p] < m[a] ? p : a), P[0]);
      if (!(m[w] - m[b] > tol)) return;
      const amt = Math.min(step[i], s[i][w]);
      s[i][w] -= amt;
      s[i][b] = (s[i][b] ?? 0) + amt;
      if (s[i][w] <= EPS) delete s[i][w];
      if (last[i] && last[i][0] === b && last[i][1] === w) step[i] /= 2;
      last[i] = [w, b];
      moved = true;
    });
    if (!moved) break;
    if (it % 400 === 399) for (let i = 0; i < step.length; i++) step[i] *= 0.7;
  }
  return s;
}

const util = (r, l) => r.linkUtil[l] ?? Infinity;

/** §2.4: the source leaf equalizes the traffic carried on its own uplinks (local view only). */
function localOnly(net, demands, opts = {}) {
  return selfish(net, demands, (r, d, s) => util(r, up(d.src, s)), opts);
}

/**
 * §3/§6: each source leaf moves traffic toward the path with the lowest max-utilization along
 * the path (max per path, min across paths): the selfish (Nash) equilibrium, not an optimum.
 * opts.start: the splits to start from (default ECMP).
 */
function conga(net, demands, opts = {}) {
  return selfish(net, demands, (r, d, s) => Math.max(util(r, up(d.src, s)), util(r, down(s, d.dst))), opts);
}

/** Reference: the split that maximizes total throughput under the same TCP model (search). */
function optimal(net, demands, { fairness } = {}) {
  const score = (sp) => evaluate(net, demands, sp, { fairness });
  const better = (a, b) => a.total > b.total + 1e-7 || (Math.abs(a.total - b.total) <= 1e-7 && a.maxUtil < b.maxUtil - 1e-7);
  let best = ecmp(net, demands);
  let bestR = score(best);
  for (const cand of [conga(net, demands, { fairness }), localOnly(net, demands, { fairness })]) {
    const r = score(cand);
    if (better(r, bestR)) { best = cand; bestR = r; }
  }
  for (let delta = 0.25; delta >= 1e-4; delta /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      demands.forEach((d, i) => {
        const P = paths(net, d.src, d.dst);
        for (const a of P) for (const b of P) {
          if (a === b || !((best[i][a] ?? 0) > EPS)) continue;
          const sp = clone(best);
          const amt = Math.min(delta, sp[i][a]);
          sp[i][a] -= amt;
          sp[i][b] = (sp[i][b] ?? 0) + amt;
          const r = score(sp);
          if (better(r, bestR)) { best = sp; bestR = r; improved = true; }
        }
      });
    }
  }
  return best;
}

export const schemes = { ecmp, weighted, localOnly, conga, optimal };

/** Every scheme on one setting. opts: { weights, fairness, congaStart }. */
export function runAll(net, demands, { weights, fairness, congaStart } = {}) {
  const run = (splits) => ({ splits, result: evaluate(net, demands, splits, { fairness }) });
  return {
    ecmp: run(ecmp(net, demands)),
    weighted: run(weighted(net, demands, weights)),
    localOnly: run(localOnly(net, demands, { fairness })),
    conga: run(conga(net, demands, { fairness, start: congaStart })),
    optimal: run(optimal(net, demands, { fairness })),
  };
}

// ---------- beyond the paper's model: stale feedback ----------

/**
 * CONGA round by round, reacting to congestion data that is `feedbackDelay` rounds old.
 * Each round every demand moves part of its traffic from its worst used path to its best one,
 * in proportion to the gap it sees (gain 0.5). With fresh data this settles at CONGA's
 * equilibrium; with stale data, leaves that see the same old numbers move together (herding)
 * and swing. Returns the average, min and max total over the second half of the rounds.
 * Not in the paper: §6 analyzes the equilibrium only.
 */
export function congaDynamics(net, demands, { feedbackDelay = 0, gain = 0.5, rounds = 400, start, fairness } = {}) {
  let s = clone(start ?? ecmp(net, demands));
  const hist = [];
  for (let t = 0; t < rounds; t++) {
    const r = evaluate(net, demands, s, { fairness });
    hist.push(r);
    const seen = hist[Math.max(0, hist.length - 1 - feedbackDelay)];
    const u = (l) => seen.linkUtil[l] ?? Infinity;
    s = s.map((sp, i) => {
      const d = demands[i];
      const P = paths(net, d.src, d.dst);
      const used = P.filter((p) => (sp[p] ?? 0) > EPS);
      if (P.length < 2 || !used.length) return sp;
      const m = Object.fromEntries(P.map((p) => [p, Math.max(u(up(d.src, p)), u(down(p, d.dst)))]));
      const w = used.reduce((a, p) => (m[p] > m[a] ? p : a), used[0]);
      const b = P.reduce((a, p) => (m[p] < m[a] ? p : a), P[0]);
      const gap = m[w] - m[b];
      if (!(gap > 1e-3)) return sp;
      const amt = Math.min(sp[w], gain * gap * sp[w]);
      return { ...sp, [w]: sp[w] - amt, [b]: (sp[b] ?? 0) + amt };
    });
  }
  const tail = hist.slice(Math.floor(rounds / 2)).map((r) => r.total);
  return {
    avgTotal: tail.reduce((a, x) => a + x, 0) / tail.length,
    minTotal: Math.min(...tail),
    maxTotal: Math.max(...tail),
    trace: hist.map((r) => r.total),
    splits: s,
  };
}

// ---------- LP helpers (references for the optimum) ----------

/** max c.x s.t. A x <= b, x >= 0, with b >= 0 (dense simplex, Bland's rule). */
function simplexMax(c, A, b) {
  const m = A.length;
  const n = c.length;
  const T = A.map((row, i) => [...row, ...Array.from({ length: m }, (_, k) => (k === i ? 1 : 0)), b[i]]);
  T.push([...c.map((v) => -v), ...Array(m).fill(0), 0]);
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const W = n + m;
  for (let guard = 0; guard < 5000; guard++) {
    let j = -1;
    for (let k = 0; k < W; k++) if (T[m][k] < -1e-12) { j = k; break; }
    if (j < 0) break;
    let row = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][j] > 1e-12) {
        const ratio = T[i][W] / T[i][j];
        if (ratio < best - 1e-12 || (Math.abs(ratio - best) <= 1e-12 && basis[i] < basis[row])) { best = ratio; row = i; }
      }
    }
    if (row < 0) return { value: Infinity, x: [] };
    const pv = T[row][j];
    for (let k = 0; k <= W; k++) T[row][k] /= pv;
    for (let i = 0; i <= m; i++) {
      if (i === row) continue;
      const f = T[i][j];
      if (Math.abs(f) > 1e-15) for (let k = 0; k <= W; k++) T[i][k] -= f * T[row][k];
    }
    basis[row] = j;
  }
  const x = Array(n).fill(0);
  basis.forEach((v, i) => { if (v < n) x[v] = T[i][W]; });
  return { value: T[m][W], x };
}

/** The most any routing could deliver (ideal rates, capacities scaled by `scale`). */
export function maxThroughputLP(net, demands, scale = 1) {
  const vars = [];
  demands.forEach((d, i) => { if (d.gbps > 0) for (const s of paths(net, d.src, d.dst)) vars.push({ i, s, links: [up(d.src, s), down(s, d.dst)] }); });
  const links = Object.keys(net.cap).filter((l) => capOf(net, l) > 0);
  const A = [];
  const b = [];
  for (const l of links) { A.push(vars.map((v) => (v.links.includes(l) ? 1 : 0))); b.push(capOf(net, l) * scale); }
  demands.forEach((d, i) => { if (d.gbps > 0) { A.push(vars.map((v) => (v.i === i ? 1 : 0))); b.push(d.gbps); } });
  const r = simplexMax(vars.map(() => 1), A, b);
  return { value: r.value, flows: vars.map((v, k) => ({ i: v.i, s: v.s, rate: r.x[k] ?? 0 })) };
}

/** §6.1: the smallest network bottleneck (max link utilization) that carries all the demand. */
export function minBottleneck(net, demands) {
  const total = demands.reduce((a, d) => a + (d.gbps > 0 ? d.gbps : 0), 0);
  if (!(total > 0)) return 0;
  const ok = (t) => maxThroughputLP(net, demands, t).value >= total * (1 - 1e-9);
  let hi = 1;
  while (!ok(hi)) { hi *= 2; if (hi > 1e6) return Infinity; }
  let lo = 0;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return hi;
}

// ---------- scenarios (numbers read from the rendered figures) ----------

/**
 * CONGA §6.1 Figure 17: 5 leaves and 5 spines in a ring; leaf i links to spines i-1, i, i+1, i+2
 * (capacity `cap`); each pair of adjacent leaves sends `gbps` to each other. `nash` = the
 * drawing's solid flow: Li -> L(i+1) via S(i+1), Li -> L(i-1) via S(i).
 */
export function fig17(cap = 40, gbps = 40) {
  const n = 5;
  const L = (i) => `L${(i + n) % n}`;
  const S = (i) => `S${(i + n) % n}`;
  const links = {};
  for (let i = 0; i < n; i++) for (const j of [i - 1, i, i + 1, i + 2]) links[`${L(i)}-${S(j)}`] = cap;
  const net = buildNet([...Array(n)].map((_, i) => L(i)), [...Array(n)].map((_, i) => S(i)), links);
  const demands = [];
  const nash = [];
  for (let i = 0; i < n; i++) {
    demands.push({ src: L(i), dst: L(i + 1), gbps });
    nash.push({ [S(i + 1)]: 1 });
    demands.push({ src: L(i), dst: L(i - 1), gbps });
    nash.push({ [S(i)]: 1 });
  }
  return { net, demands, nash };
}

const fig3Net = buildNet(["L0", "L1", "L2"], ["S0", "S1"], { "L0-S0": 40, "L1-S0": 40, "L1-S1": 40, "S0-L2": 40, "S1-L2": 40 });

export const SCENARIOS = {
  fig2: {
    source: "CONGA §2.4, Figure 2",
    net: buildNet(["L0", "L1"], ["S0", "S1"], { "L0-S0": 80, "S0-L1": 80, "L0-S1": 80, "S1-L1": 40 }),
    demands: [{ src: "L0", dst: "L1", gbps: 100 }],
    paper: { ecmp: 90, localOnly: 80, conga: 100 },
  },
  fig3a: {
    source: "CONGA §2.4, Figure 3(a)",
    net: fig3Net,
    demands: [{ src: "L1", dst: "L2", gbps: 80 }],
  },
  fig3b: {
    source: "CONGA §2.4, Figure 3(b)",
    net: fig3Net,
    demands: [{ src: "L0", dst: "L2", gbps: 40 }, { src: "L1", dst: "L2", gbps: 40 }],
  },
  // Candidates for "ECMP wins?" (step 06 uses the one the user approves):
  fig17: {
    source: "CONGA §6.1, Figure 17 (Price of Anarchy 2), demand above capacity",
    ...fig17(40, 60),
    note: "Every link on CONGA's paths is full, and every other path a leaf could switch to also crosses a full link, so no leaf can lower its own bottleneck by moving: CONGA stays at 400 while ECMP delivers 600. CONGA only lands here if it starts in this state; started from ECMP, it reaches 600 too.",
  },
  ecmpWinsDelay: {
    source: "beyond the paper's model: stale feedback",
    beyondPaper: true,
    net: buildNet(["L0", "L1", "L2"], ["S0", "S1"], { "L0-S0": 40, "L0-S1": 40, "L1-S0": 40, "L1-S1": 40, "S0-L2": 40, "S1-L2": 40 }),
    demands: [{ src: "L0", dst: "L2", gbps: 40 }, { src: "L1", dst: "L2", gbps: 40 }],
    start: [{ S0: 0.6, S1: 0.4 }, { S0: 0.55, S1: 0.45 }], // traffic never starts perfectly balanced
    feedbackDelay: 3,
    note: "Two leaves send to L2 over two equal spines. With congestion data 3 rounds old, both move to the spine that looked idle, overload it together, then both move back: they herd. CONGA averages ~65; ECMP's fixed 50/50 delivers 80.",
  },
};
