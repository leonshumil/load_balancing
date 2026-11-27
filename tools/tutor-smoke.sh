#!/usr/bin/env bash
# Smoke test for the tutor function (start it first with tools/tutor-dev.sh).
#
#  1. Real calls to the primary model: F1-F5 (F1 and F2 twice, as two students, to see whether
#     the shared prefix gets cached), a free question.
#  2. Class code, passages and our limits: missing/wrong code, passage by id, too fast,
#     too long, wrong origin, CORS preflight (no model calls).
#  3. Forced 429s, with a local stub in place of Groq:
#     a. primary 429 -> the real overflow model answers (twice: the second call skips the primary)
#     b. primary and overflow both 429 -> {error: "quota"}, one call each, no retry.
#
# Every model call prints: model, status, prompt / cached / completion tokens, time, and
# Groq's rate-limit headers (TPM left, requests left today). Real calls are spaced
# SMOKE_PACE seconds apart (default 25) so the test itself stays under 8K tokens/minute.
# Uses ~10 requests of the free quota. Needs deno, python3, curl.
#
# The class code comes from TUTOR_CLASS_CODE in your shell (local default: dev-code, as in
# tools/tutor-dev.defaults). This script never opens any .env file.
#
#   tools/tutor-smoke.sh                                   # local, http://localhost:8787
#   TUTOR_CLASS_CODE=<code> TUTOR_URL=https://<ref>.supabase.co/functions/v1/tutor tools/tutor-smoke.sh   # deployed
#     (parts 1-2 against the deployed function, plus: localhost origin refused and no debug
#      header, i.e. TUTOR_DEV is off; part 3 runs only locally)
set -uo pipefail
cd "$(dirname "$0")/.."
URL="${TUTOR_URL:-http://localhost:8787}"
ORIGIN="${TUTOR_ORIGIN:-https://leonshumil.github.io}"
PACE="${SMOKE_PACE:-25}"
CODE="${TUTOR_CLASS_CODE:-dev-code}"
PRIMARY="${TUTOR_MODEL:-openai/gpt-oss-120b}"
OVERFLOW="${TUTOR_MODEL_FALLBACK:-openai/gpt-oss-20b}"
RUN="smoke-$(date +%s)"
LOCAL=0; [[ "$URL" =~ ^http://(localhost|127\.0\.0\.1)(:|/|$) ]] && LOCAL=1
TMP="$(mktemp -d)"
fails=0
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }
pace() { printf '  (waiting %ss for the per-minute token limit)\n' "$PACE"; sleep "$PACE"; }

# post <url> <session> <fork|null> <message>  -> STATUS, BODY, CALLS (X-Tutor-Calls header, local only)
post() {
  local payload
  payload=$(python3 -I -c 'import json,sys; f=sys.argv[2]; print(json.dumps({"session_id": sys.argv[1], "class_code": sys.argv[4], "fork_id": None if f == "null" else f, "history": [], "message": sys.argv[3], "state": {"picks": {}, "properties_used": {}}}))' "$2" "$3" "$4" "${CLASS_CODE_OVERRIDE-$CODE}")
  STATUS=$(curl -sS -m 90 -o "$TMP/body" -D "$TMP/head" -w '%{http_code}' -X POST "$1" -H "Content-Type: application/json" -H "Origin: $ORIGIN" --data-binary "$payload" 2>/dev/null) || STATUS=000
  BODY=$(cat "$TMP/body" 2>/dev/null)
  CALLS=$(grep -i '^x-tutor-calls:' "$TMP/head" 2>/dev/null | sed 's/^[^:]*: *//; s/\r$//')
}

# One line per model call: what the provider charged us, and what's left.
SAW_DEBUG=0
show_calls() {
  [ -n "$CALLS" ] && SAW_DEBUG=1
  [ -z "$CALLS" ] && { echo "      (no per-call data: not a local debug run)"; return; }
  python3 -I - "$CALLS" <<'PY'
import json, sys
for c in json.loads(sys.argv[1]):
    line = f"      call: {c['model']:<22} {c['status']:<7}"
    if "prompt" in c:
        pct = f" ({100 * c['cached'] // c['prompt']}%)" if c["prompt"] else ""
        line += f" prompt={c['prompt']} cached={c['cached']}{pct} completion={c['completion']}"
    line += f" {c['ms']}ms"
    lim = c.get("limits")
    if lim:
        line += f" | TPM left {lim.get('tpmLeft')}/{lim.get('tpm')}, requests left today {lim.get('rpdLeft')}/{lim.get('rpd')}"
    print(line)
PY
}

# check_json <fork|null> <expected pick>: the approved shape, not a fallback
check_json() {
  python3 -I - "$1" "$2" "$BODY" <<'PY'
import json, re, sys
fork, expected, body = sys.argv[1:4]
options = {"F1": ["centralized", "distributed"], "F2": ["host-based", "in-network"], "F3": ["local", "global"],
           "F4": ["link-state", "leaf-to-leaf"], "F5": ["per-flow", "per-flowlet", "per-packet"], "null": []}
try:
    o = json.loads(body)
except Exception as e:
    print(f"not JSON: {e}"); sys.exit(1)
errs = []
if set(o) != {"reply", "cites", "detected_pick", "properties_mentioned", "ready_to_reveal", "fallback"}: errs.append(f"keys {sorted(o)}")
if not isinstance(o.get("reply"), str) or not o["reply"].strip(): errs.append("empty reply")
if not isinstance(o.get("cites"), list) or not all(isinstance(c, str) for c in o["cites"]): errs.append("cites")
if o.get("detected_pick") not in options[fork] + [None]: errs.append(f"detected_pick {o.get('detected_pick')!r}")
if not isinstance(o.get("properties_mentioned"), list) or not set(o["properties_mentioned"]) <= {"P1","P2","P3","P4","P5"}: errs.append("properties_mentioned")
if not isinstance(o.get("ready_to_reveal"), bool): errs.append("ready_to_reveal")
if o.get("fallback") is not False: errs.append("fallback reply (output failed validation twice, or the call failed)")
if errs:
    print("; ".join(errs)); sys.exit(1)
note = "" if expected in ("-", o["detected_pick"]) else f"  [note: expected pick {expected}]"
print(f"pick={o['detected_pick']} props={o['properties_mentioned']} cites={o['cites']} reveal={o['ready_to_reveal']} words={len(o['reply'].split())}{note}")
print("      reply: " + o["reply"].replace("\n", " ")[:260])
PY
}

real_turn() { # real_turn <url> <label> <session> <fork> <expected pick> <message>
  local t0 ms detail
  t0=$(date +%s%N)
  post "$1" "$3" "$4" "$6"
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  if [ "$STATUS" != "200" ]; then fail "$2: HTTP $STATUS $BODY"; show_calls; return; fi
  if detail=$(check_json "$4" "$5"); then pass "$2 (${ms} ms) $detail"; else fail "$2: $detail"; fi
  show_calls
}

# A stand-in for Groq that answers every call with 429 and records the model it was asked for.
start_stub() { # start_stub <port> <model log>
  python3 -I -c '
import http.server, json, sys
log = sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        open(log, "a").write(body.get("model", "?") + "\n")
        self.send_response(429); self.send_header("retry-after", "60"); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(b"{\"error\":{\"message\":\"Rate limit reached\",\"code\":\"rate_limit_exceeded\"}}")
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()' "$1" "$2" &
  pids+=($!)
}

start_tutor() { # start_tutor <port> <env...>: another local tutor instance
  local port="$1"; shift
  env TUTOR_CLASS_CODE="$CODE" "$@" TUTOR_DEV=1 TUTOR_PORT="$port" TUTOR_CHUNKS_FILE=tools/.out/chunks.json \
    deno run --allow-net --allow-env --allow-read --env-file=supabase/functions/.env supabase/functions/tutor/index.ts >"$TMP/tutor-$port.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$port" && return; sleep 0.5; done
  echo "  could not start the tutor on port $port"; cat "$TMP/tutor-$port.log"
}

echo "Tutor smoke test against $URL (primary $PRIMARY, overflow $OVERFLOW)"
echo "1. Real calls, one per fork (F1 and F2 twice, as different students, to check prompt caching)"
real_turn "$URL" "F1" "$RUN-F1a" F1 distributed "Distributed. Datacenter traffic is bursty, so a central scheduler would react too slowly (P1)."
pace
real_turn "$URL" "F1 again (other student; cache check)" "$RUN-F1b" F1 distributed "Centralized, because one controller sees the whole fabric and can plan the best paths."
pace
real_turn "$URL" "F2" "$RUN-F2a" F2 in-network "In-network. Operators often can't change the end-host stack, so it has to be transport independent (P2)."
pace
real_turn "$URL" "F2 again (other student; cache check)" "$RUN-F2b" F2 in-network "In the switches: the end-host stack is often out of the operator's control (P2, P4)."
pace
real_turn "$URL" "F3" "$RUN-F3" F3 global "Global. With asymmetry a switch's own links don't show the congestion further downstream (P3)."
pace
real_turn "$URL" "F4" "$RUN-F4" F4 leaf-to-leaf "Leaf to leaf, because it is deployable with an overlay and near-optimal for leaf-spine (P4, P5)."
pace
real_turn "$URL" "F5" "$RUN-F5" F5 per-flowlet "Per flowlet: no TCP changes are needed and packets aren't reordered (P2)."
pace
real_turn "$URL" "free question" "$RUN-free" null - "What is a flowlet, in one sentence?"

echo "2. Class code, passages and our limits (no model calls)"
CLASS_CODE_OVERRIDE="" post "$URL" "$RUN-nocode" F1 "Distributed (P1)."
if [ "$STATUS" = "401" ] && grep -q '"class_code"' <<<"$BODY"; then pass "missing class code -> 401 class_code"; else fail "missing code: HTTP $STATUS $BODY"; fi
CLASS_CODE_OVERRIDE="not-the-code" post "$URL" "$RUN-badcode" F1 "Distributed (P1)."
if [ "$STATUS" = "401" ] && grep -q '"class_code"' <<<"$BODY"; then pass "wrong class code -> 401 class_code"; else fail "wrong code: HTTP $STATUS $BODY"; fi
STATUS=$(curl -sS -m 30 -o "$TMP/body" -w '%{http_code}' -X POST "$URL" -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  --data-binary "$(python3 -I -c 'import json,sys; print(json.dumps({"action": "passage", "class_code": sys.argv[1], "id": "2.4-p2"}))' "$CODE")" 2>/dev/null) || STATUS=000
if [ "$STATUS" = "200" ] && python3 -I -c 'import json,sys; o=json.load(open(sys.argv[1])); assert o["id"] == "2.4-p2" and "asymmetry" in o["text"]' "$TMP/body" 2>/dev/null; then
  pass "passage 2.4-p2 -> 200 with its text"; else fail "passage: HTTP $STATUS $(head -c 200 "$TMP/body")"; fi
post "$URL" "$RUN-free" null "And a flow?"   # same session as the free question, right after it
if [ "$STATUS" = "429" ] && grep -q '"too_fast"' <<<"$BODY"; then pass "second message within 3 s -> 429 too_fast"; else fail "too_fast: HTTP $STATUS $BODY"; fi
post "$URL" "$RUN-long" F1 "$(printf 'x%.0s' $(seq 1 601))"
if [ "$STATUS" = "400" ] && grep -q '"too_long"' <<<"$BODY"; then pass "601 characters -> 400 too_long"; else fail "too_long: HTTP $STATUS $BODY"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}')
if [ "$code" = "403" ]; then pass "other origin -> 403"; else fail "origin check: HTTP $code"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$URL" -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST")
if [ "$code" = "204" ]; then pass "CORS preflight from $ORIGIN -> 204"; else fail "preflight: HTTP $code"; fi
if [ "$LOCAL" = 0 ]; then
  # Deployed: TUTOR_DEV must be off, so localhost is refused and there is no debug header.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Origin: http://localhost:8000" -H "Content-Type: application/json" -d '{}')
  if [ "$code" = "403" ]; then pass "localhost origin -> 403 (TUTOR_DEV is off)"; else fail "localhost origin: HTTP $code (is TUTOR_DEV set?)"; fi
  if [ "$SAW_DEBUG" = 0 ]; then pass "no X-Tutor-Calls debug header on the deployed function"; else fail "debug header present (is TUTOR_DEV set?)"; fi
fi

echo "3. Forced 429s (a local stub stands in for Groq)"
if [ "$LOCAL" = 0 ]; then echo "  skipped: local only (run tools/tutor-smoke.sh without TUTOR_URL on a machine with deno)"
elif ! command -v deno >/dev/null; then echo "  SKIP (deno not on PATH)"; fails=$((fails + 1)); else
  [ -f tools/.out/chunks.json ] || node tools/build-chunks.mjs >/dev/null
  start_stub 8788 "$TMP/stub-models.log"

  echo "  a. $PRIMARY says 429 -> $OVERFLOW (real) answers"
  start_tutor 8789 TUTOR_MODEL="$PRIMARY" TUTOR_REASONING_EFFORT=low TUTOR_MODEL_FALLBACK="$OVERFLOW" \
    TUTOR_LLM_BASE_URL=http://127.0.0.1:8788 TUTOR_FALLBACK_BASE_URL=https://api.groq.com/openai/v1
  real_turn http://127.0.0.1:8789 "F3 via overflow" "$RUN-ovf1" F3 global "Global, because a switch only sees its own links and misses downstream congestion (P3)."
  pace
  real_turn http://127.0.0.1:8789 "F3 again via overflow (primary cooling down: not called)" "$RUN-ovf2" F3 global "Global: only non-local knowledge shows downstream congestion (P3)."
  if [ "$(grep -c . "$TMP/stub-models.log")" = "1" ]; then pass "the primary was asked once, then skipped during its cooldown"; else fail "primary calls at the stub: $(tr '\n' ' ' <"$TMP/stub-models.log")"; fi

  echo "  b. both models say 429 -> {error: \"quota\"}"
  : >"$TMP/stub-models.log"
  start_tutor 8790 GROQ_API_KEY=dummy-not-a-key TUTOR_MODEL="$PRIMARY" TUTOR_MODEL_FALLBACK="$OVERFLOW" \
    TUTOR_LLM_BASE_URL=http://127.0.0.1:8788 TUTOR_FALLBACK_BASE_URL=http://127.0.0.1:8788
  post http://127.0.0.1:8790 "$RUN-quota" F1 "Distributed, because of P1."
  asked=$(tr '\n' ' ' <"$TMP/stub-models.log")
  if [ "$STATUS" = "429" ] && python3 -I -c 'import json,sys; o=json.loads(sys.argv[1]); assert o["error"] == "quota" and o["reply"]' "$BODY" 2>/dev/null \
     && [ "$asked" = "$PRIMARY $OVERFLOW " ]; then
    pass "HTTP 429 {error: \"quota\"}; models asked, in order: $asked(one call each, no retry)"
  else fail "quota: HTTP $STATUS $BODY; models asked: $asked"; fi
  show_calls
fi

if [ "$fails" -eq 0 ]; then echo "ALL PASSED"; else echo "$fails FAILED"; exit 1; fi
