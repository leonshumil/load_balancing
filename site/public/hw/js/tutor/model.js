// Figure 1 tutor: the client state machine (step 12). Pure functions, no DOM.
// Code decides, the LLM talks: picks are saved from the tutor's detected_pick, but reveals,
// scores and the recap come from hw/js/path/model.js (CONGA Fig 1, §2.1-§2.6).
// Every function returns a new state; the state is plain JSON (saved under STORE_KEY).

import { FORKS, TREE, PROPERTIES, scoreFork, costsVisible } from "../path/model.js";

const PROP_NAME = Object.fromEntries(PROPERTIES.map((p) => [p.id, p.name]));
/** "P2 Transport independent and P4 Incrementally deployable" */
export const keyPropertiesText = (forkId) =>
  forkById(forkId).properties.map((p) => `${p} ${PROP_NAME[p]}`).join(" and ");

export const MAX_TURNS = 6; // turns on one fork before the client reveals it
export const HISTORY_TURNS = 6; // earlier turns sent with each message
export const MAX_MESSAGES = 300; // kept in the store
export const STORE_KEY = "hw:tutor";

export const OPENING =
  "Unit 4 left a gap: a FlowBender sender learns about congestion only on its own path, " +
  "and a switch sees only its own links. Nobody knows the load on every path. CONGA's answer " +
  "starts at the top of Figure 1; let's walk down it one fork at a time. At each fork, pick a " +
  "branch and argue for it with the paper's properties P1-P5.";

const FORK_IDS = FORKS.map((f) => f.id);
const PROP_IDS = PROPERTIES.map((p) => p.id);
const forkById = (id) => FORKS.find((f) => f.id === id);
const label = (id) => TREE[id].label;
const clone = (s) => JSON.parse(JSON.stringify(s));
const say = (s, m) => {
  s.messages.push(m);
  if (s.messages.length > MAX_MESSAGES) s.messages.splice(0, s.messages.length - MAX_MESSAGES);
  return s;
};

export function initialState(sessionId) {
  return {
    v: 1,
    sessionId,
    mode: null, // null until started, then "live" or "fallback"
    offline: null, // why we are in fallback: disabled | quota | limit | error
    fork: 0, // index into FORKS; FORKS.length = done
    forks: Object.fromEntries(FORK_IDS.map((id) => [id, { pick: null, properties: [], turns: 0, revealed: false, revealedBy: null }])),
    messages: [], // { role: "tutor"|"student", text, fork, kind?, cites? }
    recap: { measure: "", decide: "", act: "" },
  };
}

export const currentForkId = (s) => FORKS[s.fork]?.id ?? null;
export const isDone = (s) => s.fork >= FORKS.length;

export function questionText(forkId) {
  const f = forkById(forkId);
  const n = FORK_IDS.indexOf(forkId) + 1;
  return `Fork ${n} of ${FORKS.length} (${f.section}): ${f.question}`;
}

/** Start (or resume) in a mode. The opening and the first question appear once. */
export function start(state, mode, offline = null) {
  const s = clone(state);
  s.mode = mode;
  s.offline = mode === "fallback" ? offline : null;
  if (s.messages.length === 0) {
    say(s, { role: "tutor", text: OPENING, fork: null, kind: "opening" });
    say(s, { role: "tutor", text: questionText(FORK_IDS[0]), fork: FORK_IDS[0], kind: "question" });
  }
  return s;
}

export const goOffline = (state, reason) => ({ ...clone(state), mode: "fallback", offline: reason });
export const goLive = (state) => ({ ...clone(state), mode: "live", offline: null });

export function addStudent(state, text) {
  return say(clone(state), { role: "student", text, fork: currentForkId(state) });
}

/**
 * The tutor's reply to the last student message. Saves the pick (this fork's branches only)
 * and the properties; counts the turn. Code decides the reveal (by):
 *  "tutor"    the tutor revealed (ready_to_reveal);
 *  "complete" the student has a pick and has named all of the fork's key properties;
 *  "nudged"   the student has a pick, and had one more turn after picking (the one nudge);
 *  "turns"    MAX_TURNS turns on this fork.
 */
export function applyReply(state, r) {
  const s = clone(state);
  const id = currentForkId(s);
  say(s, { role: "tutor", text: r.reply, fork: id, cites: Array.isArray(r.cites) ? r.cites : [] });
  if (!id) return { state: s, reveal: false };
  const f = s.forks[id];
  const options = forkById(id).options.map((o) => o.id);
  const hadPick = f.pick !== null;
  if (options.includes(r.detected_pick)) f.pick = r.detected_pick;
  const props = (r.properties_mentioned ?? []).filter((p) => PROP_IDS.includes(p));
  f.properties = [...new Set([...f.properties, ...props])].sort();
  f.turns += 1;
  f.turnsSincePick = f.pick ? (hadPick ? (f.turnsSincePick ?? 0) + 1 : 0) : 0;
  const missing = forkById(id).properties.filter((p) => !f.properties.includes(p));
  let by = null;
  if (r.ready_to_reveal === true) by = "tutor";
  else if (f.pick && missing.length === 0) by = "complete";
  else if (f.pick && f.turnsSincePick >= 1) by = "nudged";
  else if (f.turns >= MAX_TURNS) by = "turns";
  return { state: s, reveal: by !== null, by };
}

/**
 * The scripted reveal: the paper's pick, Figure 1's note on each rejected branch, all of the
 * fork's key properties, and the interpretation note where a link is our reading (P4).
 */
export function revealText(forkId) {
  const f = forkById(forkId);
  const costs = Object.entries(f.costs).map(([id, note]) => `${label(id)}: “${note}”`).join("; ");
  return `The paper takes ${label(f.congaPick)}. Figure 1's note on the other branch${Object.keys(f.costs).length > 1 ? "es" : ""}: ${costs}. ` +
    `The argument rests on ${keyPropertiesText(forkId)}.${f.interpretation ? ` ${f.interpretation}` : ""}`;
}

/** Mark the current fork revealed. by: tutor (its reply already revealed) | turns | button | fallback. */
export function revealCurrent(state, by) {
  const s = clone(state);
  const id = currentForkId(s);
  if (!id || s.forks[id].revealed) return s;
  s.forks[id].revealed = true;
  s.forks[id].revealedBy = by;
  if (by !== "tutor") say(s, { role: "tutor", text: revealText(id), fork: id, kind: "reveal" });
  else if (forkById(id).interpretation) say(s, { role: "tutor", text: forkById(id).interpretation, fork: id, kind: "note" });
  return s;
}

/** Move past a revealed fork: the next question, or the end of the walk. */
export function advance(state) {
  const id = currentForkId(state);
  if (!id) return clone(state);
  if (!state.forks[id].revealed) throw new Error(`fork ${id} is not revealed yet`);
  const s = clone(state);
  s.fork += 1;
  const next = currentForkId(s);
  if (next) say(s, { role: "tutor", text: questionText(next), fork: next, kind: "question" });
  else say(s, { role: "tutor", text: "That's the whole tree: see your recap below. You can still ask questions here.", fork: null, kind: "done" });
  return s;
}

/** Guided (fallback) mode: one branch and 1-3 properties, then the reveal. */
export function fallbackAnswer(state, pick, properties) {
  const id = currentForkId(state);
  const f = forkById(id);
  if (!f || !f.options.some((o) => o.id === pick)) throw new Error("choose one of this fork's branches");
  const props = [...new Set(properties)].filter((p) => PROP_IDS.includes(p));
  if (props.length < 1 || props.length > 3) throw new Error("choose 1-3 properties");
  let s = clone(state);
  s.forks[id].pick = pick;
  s.forks[id].properties = [...new Set([...s.forks[id].properties, ...props])].sort();
  say(s, { role: "student", text: `${label(pick)}, because of ${props.join(", ")}.`, fork: id });
  s = revealCurrent(s, "fallback");
  return { state: s, score: scoreFork(id, { pick, properties: props }) };
}

export function historyFor(state, n = HISTORY_TURNS) {
  return state.messages
    .filter((m) => m.role === "student" || m.role === "tutor")
    .slice(-n)
    .map((m) => ({ role: m.role === "student" ? "user" : "assistant", text: m.text }));
}

/** The body for one POST to the tutor function (the message itself not yet in the log). */
export function requestBody(state, message) {
  const picks = {};
  const properties_used = {};
  for (const id of FORK_IDS) {
    const f = state.forks[id];
    if (f.pick) picks[id] = f.pick;
    if (f.properties.length) properties_used[id] = f.properties;
  }
  return {
    session_id: state.sessionId,
    fork_id: currentForkId(state),
    history: historyFor(state),
    message,
    state: { picks, properties_used },
  };
}

/**
 * How to draw each Figure 1 node: status future | current | path | rejected, whether it is
 * the student's pick, and the cost note (only once its fork is revealed).
 */
export function treeView(state) {
  const v = Object.fromEntries(Object.keys(TREE).filter((id) => id !== "root").map((id) => [id, { status: "future", mine: false, cost: null }]));
  FORKS.forEach((f, i) => {
    const fs = state.forks[f.id];
    for (const o of f.options) {
      const node = v[o.id];
      node.mine = fs.pick === o.id;
      if (fs.revealed) {
        node.status = o.id === f.congaPick ? "path" : "rejected";
        if (node.status === "rejected" && costsVisible({ answered: true, now: 0, revealAt: Infinity, mode: "after-answer" })) node.cost = f.costs[o.id];
      } else if (i === state.fork) {
        node.status = "current";
      }
    }
  });
  return v;
}

/** The question a click on a tree node sends (null for forks not reached yet). */
export function nodeQuestion(state, nodeId) {
  const i = FORKS.findIndex((f) => f.options.some((o) => o.id === nodeId));
  if (i < 0 || i > state.fork) return null;
  const f = FORKS[i];
  if (!state.forks[f.id].revealed) return `What about ${label(nodeId)}?`;
  return nodeId === f.congaPick ? `Why ${label(nodeId)}?` : `Why not ${label(nodeId)}?`;
}

export function propertiesUsed(state) {
  return [...new Set(FORK_IDS.flatMap((id) => state.forks[id].properties))].sort();
}

export function recap(state) {
  const rows = FORKS.map((f) => {
    const fs = state.forks[f.id];
    const sc = scoreFork(f.id, { pick: fs.pick, properties: fs.properties }).propertyOverlap;
    return {
      hit: sc.hit,
      missed: sc.missed,
      extra: sc.extra,
      forkId: f.id,
      section: f.section,
      pick: fs.pick,
      pickLabel: fs.pick ? label(fs.pick) : null,
      congaPick: f.congaPick,
      congaLabel: label(f.congaPick),
      agree: fs.pick === f.congaPick,
      properties: fs.properties,
      keyProperties: f.properties,
    };
  });
  const missed = {};
  for (const r of rows) for (const p of r.missed) (missed[p] ??= []).push(r.forkId);
  return { rows, disagreements: rows.filter((r) => !r.agree).map((r) => r.forkId), propertiesUsed: propertiesUsed(state), missed };
}

/** What Submit (step 07) sends for this section: no chat text (the function logs that). */
export function submission(state) {
  return {
    mode: state.mode,
    offline: state.offline,
    done: isDone(state),
    forks: Object.fromEntries(FORKS.map((f) => {
      const fs = state.forks[f.id];
      return [f.id, { pick: fs.pick, agree: fs.pick === f.congaPick, properties: fs.properties, turns: fs.turns, revealedBy: fs.revealedBy }];
    })),
    recap: { ...state.recap },
  };
}

/** A saved state back from the store, checked; anything odd starts fresh. */
export function restore(raw, makeId) {
  const fresh = () => initialState(makeId());
  if (!raw || typeof raw !== "object" || raw.v !== 1 || typeof raw.sessionId !== "string") return fresh();
  if (!Number.isInteger(raw.fork) || raw.fork < 0 || raw.fork > FORKS.length) return fresh();
  if (![null, "live", "fallback"].includes(raw.mode)) return fresh();
  if (!raw.forks || !FORK_IDS.every((id) => {
    const f = raw.forks[id];
    return f && (f.pick === null || typeof f.pick === "string") && Array.isArray(f.properties) &&
      Number.isInteger(f.turns) && typeof f.revealed === "boolean";
  })) return fresh();
  if (!Array.isArray(raw.messages) || !raw.messages.every((m) => m && (m.role === "tutor" || m.role === "student") && typeof m.text === "string")) return fresh();
  if (!raw.recap || typeof raw.recap !== "object") return fresh();
  return clone(raw);
}
