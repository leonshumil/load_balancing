// Fork data the tutor function needs. Source of truth: site/public/hw/js/path/model.js
// (CONGA Fig 1, §2.1-§2.6); forks_test.ts fails if this copy drifts. `sections` = which paper
// sections to retrieve for the fork (step 11), `extraChunks` = single chunks from other
// sections (F4 takes only §1's link-state paragraph, not all of §1, to save tokens).
// `properties` + `evidence` are the fork's key properties, given to the tutor as a hint so it
// can nudge once when the student misses one; `interpretation` marks links that are our reading.
// The function never scores answers: the client compares detected_pick with congaPick.

export type Evidence = { property: string; source: string; quote: string; interpretation?: boolean };

export type Fork = {
  section: string;
  sections: string[];
  extraChunks: string[];
  question: string;
  options: { id: string; label: string }[];
  congaPick: string;
  properties: string[];
  interpretation: string | null;
  evidence: Evidence[];
};

export const FORKS: Record<string, Fork> = {
  "F1": {
    "section": "§2.2",
    "sections": [
      "2.2"
    ],
    "extraChunks": [],
    "question": "Datacenter traffic is bursty and unpredictable. Should one scheduler with a view of the whole fabric decide the paths, or should the decision be spread across the fabric?",
    "options": [
      {
        "id": "centralized",
        "label": "Centralized"
      },
      {
        "id": "distributed",
        "label": "Distributed"
      }
    ],
    "congaPick": "distributed",
    "properties": [
      "P1",
      "P5"
    ],
    "interpretation": null,
    "evidence": [
      {
        "property": "P1",
        "source": "CONGA §2.2",
        "quote": "datacenter traffic is very bursty and unpredictable [18, 28, 8]. CONGA reacts to congestion at RTT timescales (∼100µs) making it more adept at handling high volatility than a centralized scheduler."
      },
      {
        "property": "P5",
        "source": "CONGA §2.2",
        "quote": "in the common Leaf-Spine topology (Figure 4), all paths are exactly two-hops. As our experiments (§5) and analysis (§6) show, distributed decisions are close to optimal in such regular topologies."
      }
    ]
  },
  "F2": {
    "section": "§2.3",
    "sections": [
      "2.3"
    ],
    "extraChunks": [],
    "question": "Many devices share the decision. Should it live in the transport stack of the end-hosts, or in the switches of the fabric?",
    "options": [
      {
        "id": "host-based",
        "label": "Host-Based"
      },
      {
        "id": "in-network",
        "label": "In-Network"
      }
    ],
    "congaPick": "in-network",
    "properties": [
      "P2",
      "P4"
    ],
    "interpretation": "P4 here is our reading: §2.1 defines P4 as applying CONGA to only a subset of the traffic and of the switches, while Figure 1 says host-based is “Hard to deploy”.",
    "evidence": [
      {
        "property": "P2",
        "source": "CONGA §2.1",
        "quote": "Importantly, it should not require any modifications to TCP."
      },
      {
        "property": "P2",
        "source": "CONGA §2.3",
        "quote": "some datacenter applications such as high performance storage systems bypass the kernel altogether [39, 7] and hence cannot use MPTCP."
      },
      {
        "property": "P4",
        "source": "CONGA Fig 1",
        "quote": "Hard to deploy",
        "interpretation": true
      },
      {
        "property": "P4",
        "source": "CONGA §1",
        "quote": "Host-based methods such as MPTCP are challenging to deploy because network operators often do not control the end-host stack (e.g., in a public cloud)",
        "interpretation": true
      }
    ]
  },
  "F3": {
    "section": "§2.4",
    "sections": [
      "2.4"
    ],
    "extraChunks": [],
    "question": "Leaf-spine fabrics become asymmetric. Can a switch balance using only its own links?",
    "options": [
      {
        "id": "local",
        "label": "Local (Stateless or Congestion-Aware)"
      },
      {
        "id": "global",
        "label": "Global, Congestion-Aware"
      }
    ],
    "congaPick": "global",
    "properties": [
      "P3"
    ],
    "interpretation": null,
    "evidence": [
      {
        "property": "P3",
        "source": "CONGA §2.4",
        "quote": "Handling asymmetry essentially requires non-local knowledge about downstream congestion at the switches. With asymmetry, a switch cannot simply balance traffic based on the congestion of its local links."
      }
    ]
  },
  "F4": {
    "section": "§2.5",
    "sections": [
      "2.5"
    ],
    "extraChunks": [
      "1-p5"
    ],
    "question": "Switches need to know about congestion beyond their own links. Should every switch learn the state of every link, or should only the leaves at the two ends of a path exchange it?",
    "options": [
      {
        "id": "link-state",
        "label": "General, Link State"
      },
      {
        "id": "leaf-to-leaf",
        "label": "Leaf to Leaf"
      }
    ],
    "congaPick": "leaf-to-leaf",
    "properties": [
      "P5",
      "P4"
    ],
    "interpretation": "P4 here is our reading: §2.1 defines P4 as applying CONGA to only a subset of the traffic and of the switches, while Figure 1 says leaf to leaf is “deployable with an overlay”.",
    "evidence": [
      {
        "property": "P5",
        "source": "CONGA Fig 1",
        "quote": "Near-optimal for 2-tier"
      },
      {
        "property": "P5",
        "source": "CONGA §1",
        "quote": "The leaf-to-leaf scheme is provably near-optimal in typical 2-tier Clos topologies (henceforth called Leaf-Spine), simple to analyze, and easy to deploy."
      },
      {
        "property": "P4",
        "source": "CONGA Fig 1",
        "quote": "deployable with an overlay",
        "interpretation": true
      },
      {
        "property": "P4",
        "source": "CONGA §1",
        "quote": "it is deployable in datacenters today with standard overlay encapsulations (VXLAN [35] in our implementation)",
        "interpretation": true
      }
    ]
  },
  "F5": {
    "section": "§2.6",
    "sections": [
      "2.6"
    ],
    "extraChunks": [],
    "question": "The source leaf knows how congested each path is. What should it move from one path to another: a whole flow, a burst of packets, or each packet on its own?",
    "options": [
      {
        "id": "per-flow",
        "label": "Per Flow"
      },
      {
        "id": "per-flowlet",
        "label": "Per Flowlet (CONGA)"
      },
      {
        "id": "per-packet",
        "label": "Per Packet"
      }
    ],
    "congaPick": "per-flowlet",
    "properties": [
      "P2",
      "P1"
    ],
    "interpretation": null,
    "evidence": [
      {
        "property": "P2",
        "source": "CONGA Fig 1",
        "quote": "Optimal, needs reordering-resilient TCP"
      },
      {
        "property": "P2",
        "source": "CONGA §1",
        "quote": "while not requiring any modifications to TCP."
      },
      {
        "property": "P1",
        "source": "CONGA §1",
        "quote": "CONGA is constructed to work with flowlets [27] to achieve a higher granularity of control"
      }
    ]
  }
};

/** Every Figure 1 branch id (detected_pick must be one of these or null). */
export const BRANCH_IDS: string[] = ["centralized","distributed","host-based","in-network","local","global","link-state","leaf-to-leaf","per-flow","per-flowlet","per-packet"];

/** Property ids and names (CONGA §2.1). */
export const PROPERTIES: Record<string, string> = {
  P1: "Responsive",
  P2: "Transport independent",
  P3: "Robust to asymmetry",
  P4: "Incrementally deployable",
  P5: "Optimized for Leaf-Spine topology",
};
