// Asymmetry lab model (step 05): a steady-state fluid model of a 2-tier leaf-spine.
// Numbers come from the paper's figures (PDF p.3 Fig 2-3, p.10 Fig 17), rendered and read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paths, evaluate, schemes, runAll, SCENARIOS, buildNet, fig17, minBottleneck, maxThroughputLP, congaDynamics } from "./model.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const split = (r, i, s) => r.result.perDemand[i].rates[s] ?? 0;

// ---------- the network and the TCP model ----------

test("paths: two hops through every spine with both links up; a failed (0) link removes the path", () => {
  const net = buildNet(["L0", "L1"], ["S0", "S1"], { "L0-S0": 80, "S0-L1": 80, "L0-S1": 80, "S1-L1": 0 });
  assert.deepEqual(paths(net, "L0", "L1"), ["S0"]);
  assert.deepEqual(paths(buildNet(["L0", "L1"], ["S0", "S1"], { "L0-S0": 80, "S0-L1": 80, "L0-S1": 80, "S1-L1": 40 }), "L0", "L1"), ["S0", "S1"]);
});

test("TCP model: each sub-flow is capped by its share of the demand", () => {
  const net = SCENARIOS.fig2.net;
  const r = evaluate(net, [{ src: "L0", dst: "L1", gbps: 30 }], [{ S0: 0.5, S1: 0.5 }]);
  assert.deepEqual([r.perDemand[0].rates.S0, r.perDemand[0].rates.S1, r.total], [15, 15, 30]);
});

test("TCP model: a shared bottleneck is split per flow (more flows, bigger share); weighted max-min", () => {
  // two demands into one 40G link: 30 flows vs 10 flows -> 30 / 10
  const net = buildNet(["L0", "L1", "L2"], ["S0"], { "L0-S0": 80, "L1-S0": 80, "S0-L2": 40 });
  const r = evaluate(net, [{ src: "L0", dst: "L2", gbps: 60, flows: 30 }, { src: "L1", dst: "L2", gbps: 60, flows: 10 }], [{ S0: 1 }, { S0: 1 }]);
  near(r.perDemand[0].total, 30, 1e-6, "30 flows");
  near(r.perDemand[1].total, 10, 1e-6, "10 flows");
  // with plain per-path max-min (the spec's wording) it would be 20 / 20
  const p = evaluate(net, [{ src: "L0", dst: "L2", gbps: 60, flows: 30 }, { src: "L1", dst: "L2", gbps: 60, flows: 10 }], [{ S0: 1 }, { S0: 1 }], { fairness: "path" });
  near(p.perDemand[0].total, 20, 1e-6, "per path");
});

test("TCP model: frees capacity left by a demand-limited flow to the others (progressive filling)", () => {
  const net = buildNet(["L0", "L1", "L2"], ["S0"], { "L0-S0": 80, "L1-S0": 80, "S0-L2": 40 });
  // same number of flows on both: the small demand is capped by what it asks, the rest goes to the other
  const r = evaluate(net, [{ src: "L0", dst: "L2", gbps: 5, flows: 10 }, { src: "L1", dst: "L2", gbps: 60, flows: 10 }], [{ S0: 1 }, { S0: 1 }]);
  near(r.perDemand[0].total, 5, 1e-6, "small demand gets all it asks");
  near(r.perDemand[1].total, 35, 1e-6, "the rest goes to the big one");
  near(r.maxUtil, 1, 1e-9, "the shared link is the bottleneck");
  assert.deepEqual(r.bottlenecks, ["S0>L2"]); // directed link names: uplink "L0>S0", downlink "S0>L2"
});

// ---------- Figure 2 (§2.4) ----------

test("CONGA §2.4 Fig 2: ECMP 90 (50 + 40): 'Static ECMP splits the flows equally ... 90Gbps'", () => {
  const r = runAll(SCENARIOS.fig2.net, SCENARIOS.fig2.demands).ecmp;
  near(split(r, 0, "S0"), 50, 1e-6, "upper");
  near(split(r, 0, "S1"), 40, 1e-6, "lower");
  near(r.result.total, 90, 1e-6, "total");
});

test("CONGA §2.4 Fig 2: local only 80 (40 + 40): 'actually worse with a throughput of 80Gbps'", () => {
  const r = runAll(SCENARIOS.fig2.net, SCENARIOS.fig2.demands).localOnly;
  near(split(r, 0, "S0"), 40, 0.3, "upper");
  near(split(r, 0, "S1"), 40, 0.3, "lower");
  near(r.result.total, 80, 0.5, "total");
});

test("CONGA §2.4 Fig 2: CONGA 100, split 66.6 / 33.3; its max link utilization is lower than ECMP's", () => {
  const all = runAll(SCENARIOS.fig2.net, SCENARIOS.fig2.demands);
  near(split(all.conga, 0, "S0"), 66.6, 0.5, "upper");
  near(split(all.conga, 0, "S1"), 33.3, 0.5, "lower");
  near(all.conga.result.total, 100, 0.5, "total");
  near(all.conga.result.maxUtil, 0.833, 0.01, "max util (66.6/80 = 33.3/40)");
  near(all.ecmp.result.maxUtil, 1, 1e-6, "ECMP saturates S1->L1");
  near(all.optimal.result.total, 100, 1e-6, "optimal");
});

// ---------- Figure 3 (§2.4) ----------

test("CONGA §2.4 Fig 3: the best L1->L2 split depends on the traffic matrix: (a) 40/40, (b) 0/40 via S1", () => {
  const a = runAll(SCENARIOS.fig3a.net, SCENARIOS.fig3a.demands).optimal.result;
  const b = runAll(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands).optimal.result;
  const l1a = a.perDemand.find((d) => d.src === "L1");
  const l1b = b.perDemand.find((d) => d.src === "L1");
  near(l1a.rates.S0, 40, 1e-6, "(a) via S0");
  near(l1a.rates.S1, 40, 1e-6, "(a) via S1");
  near(l1b.rates.S0 ?? 0, 0, 1e-6, "(b) via S0");
  near(l1b.rates.S1, 40, 1e-6, "(b) via S1");
  near(a.total, 80, 1e-6, "(a) total");
  near(b.total, 80, 1e-6, "(b) total");
});

test("CONGA §2.4 Fig 3: CONGA finds both splits by itself (80 in (a) and in (b))", () => {
  near(runAll(SCENARIOS.fig3a.net, SCENARIOS.fig3a.demands).conga.result.total, 80, 0.5, "(a)");
  near(runAll(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands).conga.result.total, 80, 0.5, "(b)");
});

test("CONGA §2.4 Fig 3(b): local only is worse than ECMP ('a local congestion-aware mechanism could actually perform worse than ECMP ... in part (b)')", () => {
  const all = runAll(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands);
  near(all.ecmp.result.total, 60, 0.01, "ECMP");
  assert.ok(all.localOnly.result.total < all.ecmp.result.total - 3, `local ${all.localOnly.result.total} < ECMP ${all.ecmp.result.total}`);
  near(all.localOnly.result.total, 55.3, 0.5, "local only (L1 moves 61.8% of its flows onto the shared S0->L2)");
});

test("model note: with plain per-path max-min (the spec's wording) local only would only tie ECMP in Fig 3(b)", () => {
  const all = runAll(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands, { fairness: "path" });
  near(all.localOnly.result.total, all.ecmp.result.total, 0.5, "tie");
});

test("weighted (WCMP, Unit 4): static weights per demand; Fig 3: the weights that are best in (a) lose in (b)", () => {
  const w = { "L1>L2": { S0: 1, S1: 1 } }; // normalized over the paths that exist
  const a = schemes.weighted(SCENARIOS.fig3a.net, SCENARIOS.fig3a.demands, w);
  near(evaluate(SCENARIOS.fig3a.net, SCENARIOS.fig3a.demands, a).total, 80, 1e-6, "(a) with 50/50");
  const b = schemes.weighted(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands, w);
  assert.ok(evaluate(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands, b).total < 80 - 10, "(b) with the same weights");
  // a demand without weights falls back to ECMP; weights on a missing path are ignored
  assert.deepEqual(schemes.weighted(SCENARIOS.fig3b.net, SCENARIOS.fig3b.demands, {})[0], { S0: 1 });
});

test("optimal (reference): an LP bound and the best split under the same TCP model agree on Fig 2 and Fig 3", () => {
  for (const k of ["fig2", "fig3a", "fig3b"]) {
    const { net, demands } = SCENARIOS[k];
    near(maxThroughputLP(net, demands).value, runAll(net, demands).optimal.result.total, 0.01, k);
  }
});

// ---------- Figure 17 (§6.1, Price of Anarchy 2) ----------

test("CONGA §6.1 Fig 17: ring of 5 leaves and 5 spines; leaf i links to spines i-1..i+2; neighbours send to each other", () => {
  const { net, demands, nash } = fig17(1, 1);
  assert.equal(net.leaves.length, 5);
  assert.equal(net.spines.length, 5);
  assert.equal(demands.length, 10);
  assert.deepEqual(paths(net, "L0", "L1"), ["S0", "S1", "S2"]);
  assert.deepEqual(nash[0], { S1: 1 }); // L0 -> L1 via the spine they share in the drawing (solid edges)
});

test("CONGA §6.1 Fig 17: the solid flow is a Nash flow with bottleneck 1; the dashed flow has 1/2 (PoA = 2)", () => {
  const { net, demands, nash } = fig17(1, 1);
  const stuck = schemes.conga(net, demands, { start: nash });
  const r = evaluate(net, demands, stuck);
  near(r.maxUtil, 1, 1e-6, "Nash bottleneck");
  assert.deepEqual(stuck, nash, "no leaf can improve its bottleneck: CONGA stays put");
  near(minBottleneck(net, demands), 0.5, 1e-4, "the best achievable bottleneck (the dashed flow)");
  near(r.total, 10, 1e-6, "at demand = capacity every flow still gets through");
});

test("CONGA §6.1 Fig 17 with demand above capacity (60 on 40G links): stuck in the Nash flow CONGA delivers 400, ECMP 600; started from ECMP, CONGA also delivers 600", () => {
  const { net, demands, nash } = fig17(40, 60);
  const all = runAll(net, demands);
  near(all.ecmp.result.total, 600, 0.01, "ECMP");
  near(evaluate(net, demands, schemes.conga(net, demands, { start: nash })).total, 400, 0.01, "CONGA in the Nash flow (stays: no leaf can lower its bottleneck)");
  near(all.conga.result.total, 600, 0.5, "CONGA from ECMP");
  near(all.optimal.result.total, 600, 0.5, "optimal");
});

// ---------- beyond the paper's model: stale feedback ----------

test("congaDynamics with fresh feedback (delay 0) settles at CONGA's equilibrium (Fig 2: 100)", () => {
  const { net, demands } = SCENARIOS.fig2;
  const d = congaDynamics(net, demands, { feedbackDelay: 0 });
  near(d.avgTotal, 100, 0.5, "average");
  near(d.minTotal, 100, 1, "no swings");
});

test("beyond the paper's model: with feedback 3 rounds old, two leaves herd onto the same spine and CONGA averages below ECMP", () => {
  const { net, demands, start, feedbackDelay } = SCENARIOS.ecmpWinsDelay;
  const ecmp = evaluate(net, demands, schemes.ecmp(net, demands)).total;
  near(ecmp, 80, 1e-6, "ECMP");
  const fresh = congaDynamics(net, demands, { feedbackDelay: 0, start });
  near(fresh.avgTotal, 80, 0.5, "fresh feedback: CONGA = ECMP");
  const stale = congaDynamics(net, demands, { feedbackDelay, start });
  assert.ok(stale.avgTotal < ecmp - 10, `stale feedback: ${stale.avgTotal} < ${ecmp}`);
  assert.ok(stale.maxTotal - stale.minTotal > 10, "it swings (herding)");
  assert.equal(SCENARIOS.ecmpWinsDelay.beyondPaper, true);
});

test("beyond the paper's model: even Fig 2 degrades with feedback 3 rounds old (below ECMP's 90)", () => {
  const { net, demands } = SCENARIOS.fig2;
  assert.ok(congaDynamics(net, demands, { feedbackDelay: 3 }).avgTotal < 90);
});
