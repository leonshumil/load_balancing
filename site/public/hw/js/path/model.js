// Figure 1 of CONGA (Alizadeh et al., SIGCOMM 2014, PDF page 2) as data, plus pure
// functions. No DOM. Labels and notes are copied from the figure exactly as printed
// (capitals, curly quotes); tests in model.test.js check each one against the paper.

/** CONGA §2.1, "Desired Properties", names as printed. */
export const PROPERTIES = [
  { id: "P1", name: "Responsive" },
  { id: "P2", name: "Transport independent" },
  { id: "P3", name: "Robust to asymmetry" },
  { id: "P4", name: "Incrementally deployable" },
  { id: "P5", name: "Optimized for Leaf-Spine topology" },
];

// [id, parent, label, examples, note]. "note" is the italic line printed under the
// node; for rejected branches it is the cost. The root has no label in the figure.
const NODES = [
  ["root", null, null, null, null],
  ["centralized", "root", "Centralized", "e.g., Hedera, B4, SWAN", "slow to react for DCs"],
  ["distributed", "root", "Distributed", null, null],
  ["host-based", "distributed", "Host-Based", "e.g., MPTCP", "Hard to deploy, increases Incast"],
  ["in-network", "distributed", "In-Network", null, null],
  ["local", "in-network", "Local (Stateless or Congestion-Aware)", "e.g., ECMP, Flare, LocalFlow", "Poor with asymmetry, especially with TCP traffic"],
  ["global", "in-network", "Global, Congestion-Aware", null, null],
  ["link-state", "global", "General, Link State", null, "Complex, hard to deploy"],
  ["leaf-to-leaf", "global", "Leaf to Leaf", null, "Near-optimal for 2-tier, deployable with an overlay"],
  ["per-flow", "leaf-to-leaf", "Per Flow", null, "Suboptimal for “heavy” flow distributions (with large flows)"],
  ["per-flowlet", "leaf-to-leaf", "Per Flowlet (CONGA)", null, "No TCP modifications, resilient to flow distribution"],
  ["per-packet", "leaf-to-leaf", "Per Packet", null, "Optimal, needs reordering-resilient TCP"],
];

// The thick red line in Figure 1.
const CONGA_PATH = ["distributed", "in-network", "global", "leaf-to-leaf", "per-flowlet"];

/** id -> { id, parent, children, label, examples, note, onCongaPath } */
export const TREE = Object.fromEntries(
  NODES.map(([id, parent, label, examples, note]) => [id, {
    id, parent, label, examples, note,
    children: NODES.filter((n) => n[1] === id).map((n) => n[0]),
    onCongaPath: id === "root" || CONGA_PATH.includes(id),
  }]),
);

export const congaPath = () => [...CONGA_PATH];

// One fork per level of the tree. `properties` is the answer key (§2.1 properties the
// paper's argument relies on); `evidence` holds the quotes behind it.
// passageId: the numbered passages of the Read section (hw/index.html, passage 1-5).
const FORK_DATA = [
  {
    id: "F1", at: "root", section: "§2.2", passageId: "passage-3",
    question: "Datacenter traffic is bursty and unpredictable. Should one scheduler with a view of the whole fabric decide the paths, or should the decision be spread across the fabric?",
    properties: ["P1", "P5"],
    evidence: [
      { property: "P1", source: "CONGA §2.2", quote: "datacenter traffic is very bursty and unpredictable [18, 28, 8]. CONGA reacts to congestion at RTT timescales (∼100µs) making it more adept at handling high volatility than a centralized scheduler." },
      { property: "P5", source: "CONGA §2.2", quote: "in the common Leaf-Spine topology (Figure 4), all paths are exactly two-hops. As our experiments (§5) and analysis (§6) show, distributed decisions are close to optimal in such regular topologies." },
    ],
  },
  {
    id: "F2", at: "distributed", section: "§2.3", passageId: "passage-2",
    question: "Many devices share the decision. Should it live in the transport stack of the end-hosts, or in the switches of the fabric?",
    properties: ["P2", "P4"],
    evidence: [
      { property: "P2", source: "CONGA §2.3", quote: "datacenter fabric load balancing is too specific to be implemented in the transport stack." },
      { property: "P2", source: "CONGA §2.3", quote: "some datacenter applications such as high performance storage systems bypass the kernel altogether [39, 7] and hence cannot use MPTCP." },
      { property: "P4", source: "CONGA §1", quote: "Host-based methods such as MPTCP are challenging to deploy because network operators often do not control the end-host stack (e.g., in a public cloud)" },
    ],
  },
  {
    id: "F3", at: "in-network", section: "§2.4", passageId: "passage-1",
    question: "Leaf-spine fabrics become asymmetric. Can a switch balance using only its own links?",
    properties: ["P3"],
    evidence: [
      { property: "P3", source: "CONGA §2.4", quote: "Handling asymmetry essentially requires non-local knowledge about downstream congestion at the switches. With asymmetry, a switch cannot simply balance traffic based on the congestion of its local links." },
    ],
  },
  {
    id: "F4", at: "global", section: "§2.5", passageId: "passage-4",
    question: "Switches need to know about congestion beyond their own links. Should every switch learn the state of every link, or should only the leaves at the two ends of a path exchange it?",
    properties: ["P4", "P5"],
    evidence: [
      { property: "P4", source: "CONGA §1", quote: "it is deployable in datacenters today with standard overlay encapsulations (VXLAN [35] in our implementation)" },
      { property: "P5", source: "CONGA §1", quote: "The leaf-to-leaf scheme is provably near-optimal in typical 2-tier Clos topologies (henceforth called Leaf-Spine), simple to analyze, and easy to deploy." },
    ],
  },
  {
    id: "F5", at: "leaf-to-leaf", section: "§2.6", passageId: "passage-5",
    question: "The source leaf knows how congested each path is. What should it move from one path to another: a whole flow, a burst of packets, or each packet on its own?",
    properties: ["P2", "P3"],
    evidence: [
      { property: "P2", source: "CONGA §1", quote: "to achieve a higher granularity of control and resilience to the flow size distribution while not requiring any modifications to TCP." },
      { property: "P3", source: "CONGA §2.1", quote: "high bandwidth flows that are not well balanced." },
    ],
  },
];

/**
 * Forks in order. Each: { id, at, section, passageId, question, options: [{id, label}],
 * congaPick, costs: { rejectedOptionId: printed note }, properties, evidence }.
 */
export const FORKS = FORK_DATA.map((f) => {
  const options = TREE[f.at].children.map((id) => ({ id, label: TREE[id].label }));
  const congaPick = options.find((o) => TREE[o.id].onCongaPath).id;
  const costs = Object.fromEntries(options.filter((o) => o.id !== congaPick).map((o) => [o.id, TREE[o.id].note]));
  return { ...f, options, congaPick, costs };
});

const FORK_BY_ID = new Map(FORKS.map((f) => [f.id, f]));
const PROPERTY_IDS = new Set(PROPERTIES.map((p) => p.id));

const validProps = (list) => [...new Set((list ?? []).filter((p) => PROPERTY_IDS.has(p)))];

/**
 * Score one fork.
 * answer: { pick?: optionId, properties?: ["P1", ...],
 *           costs?: { rejectedOptionId: optionId whose printed cost the student put there } }
 * -> { pickCorrect, costMatches: null | { correct, total, byOption }, propertyOverlap: { hit, missed, extra, score } }
 * score = share of the key's properties the student named (extras are listed, not subtracted).
 */
export function scoreFork(forkId, answer = {}) {
  const fork = FORK_BY_ID.get(forkId);
  if (!fork) throw new Error(`unknown fork: ${forkId}`);
  const a = answer ?? {};

  let costMatches = null;
  if (a.costs && typeof a.costs === "object") {
    const byOption = Object.fromEntries(Object.keys(fork.costs).map((id) => [id, a.costs[id] === id]));
    const correct = Object.values(byOption).filter(Boolean).length;
    costMatches = { correct, total: Object.keys(fork.costs).length, byOption };
  }

  const given = validProps(a.properties);
  const hit = fork.properties.filter((p) => given.includes(p));
  const missed = fork.properties.filter((p) => !given.includes(p));
  const extra = given.filter((p) => !fork.properties.includes(p));

  return {
    pickCorrect: a.pick === fork.congaPick,
    costMatches,
    propertyOverlap: { hit, missed, extra, score: hit.length / fork.properties.length },
  };
}

/**
 * How far the student is. A fork is done once it has a pick that is one of its options
 * (right or wrong) and at least one valid §2.1 property: the student argued it.
 * -> { done, total, next: id of the first fork not done, or null }
 */
export function progress(answers) {
  const isDone = (f) => {
    const a = answers?.[f.id];
    return !!a && f.options.some((o) => o.id === a.pick) && validProps(a.properties).length > 0;
  };
  const done = FORKS.filter(isDone).length;
  return { done, total: FORKS.length, next: FORKS.find((f) => !isDone(f))?.id ?? null };
}

/**
 * May the costs of the rejected branches be shown? Not decided yet (user's call):
 *  "after-reveal": only once REVEAL_AT has passed (default, the strict rule)
 *  "after-answer": once the student answered this fork, or after REVEAL_AT
 * now, revealAt: ms since epoch.
 */
export function costsVisible({ answered = false, now, revealAt, mode = "after-reveal" }) {
  const revealed = now >= revealAt;
  return mode === "after-answer" ? revealed || answered : revealed;
}
