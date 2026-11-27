// Fork data the tutor function needs. Source of truth: site/public/hw/js/path/model.js
// (CONGA Fig 1); forks_test.ts fails if this copy drifts. `sections` = which paper
// sections to retrieve for the fork (step 11). The function never scores answers:
// the client compares detected_pick with congaPick.

export type Fork = {
  section: string;
  sections: string[];
  question: string;
  options: { id: string; label: string }[];
  congaPick: string;
};

export const FORKS: Record<string, Fork> = {
  "F1": {
    "section": "§2.2",
    "sections": [
      "2.2"
    ],
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
    "congaPick": "distributed"
  },
  "F2": {
    "section": "§2.3",
    "sections": [
      "2.3"
    ],
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
    "congaPick": "in-network"
  },
  "F3": {
    "section": "§2.4",
    "sections": [
      "2.4"
    ],
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
    "congaPick": "global"
  },
  "F4": {
    "section": "§2.5",
    "sections": [
      "1",
      "2.5"
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
    "congaPick": "leaf-to-leaf"
  },
  "F5": {
    "section": "§2.6",
    "sections": [
      "2.6"
    ],
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
    "congaPick": "per-flowlet"
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
