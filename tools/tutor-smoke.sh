#!/usr/bin/env bash
# Smoke test for the tutor function: valid JSON for F1-F5, the limits, and a forced
# provider 429 -> {error: "quota"}. Uses 6 requests of the Groq free quota (F1-F5 + a free
# question); the 429 test uses a local stub instead of Groq (needs deno on PATH).
#
#   tools/tutor-smoke.sh                                         # local (tools/tutor-dev.sh)
#   TUTOR_URL=https://<ref>.supabase.co/functions/v1/tutor tools/tutor-smoke.sh   # deployed
set -uo pipefail
URL="${TUTOR_URL:-http://localhost:8787}"
ORIGIN="${TUTOR_ORIGIN:-https://leonshumil.github.io}"
RUN="smoke-$(date +%s)"
fails=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# post <session> <fork|null> <message>  -> sets STATUS and BODY
post() {
  local fork_json="null"
  [ "$2" != "null" ] && fork_json="\"$2\""
  local payload
  payload=$(python3 -I -c 'import json,sys; print(json.dumps({"session_id": sys.argv[1], "fork_id": json.loads(sys.argv[2]), "history": [], "message": sys.argv[3], "state": {"picks": {}, "properties_used": {}}}))' "$1" "$fork_json" "$3")
  local out
  out=$(curl -sS -m 60 -w '\n%{http_code}' -X POST "$URL" -H "Content-Type: application/json" -H "Origin: $ORIGIN" --data-binary "$payload") || { STATUS=000; BODY=""; return; }
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# check <fork> <expected pick>: valid JSON of the approved shape, not a fallback
check_json() {
  python3 -I - "$1" "$2" "$BODY" <<'PY'
import json, sys
fork, expected, body = sys.argv[1], sys.argv[2], sys.argv[3]
options = {"F1": ["centralized", "distributed"], "F2": ["host-based", "in-network"], "F3": ["local", "global"],
           "F4": ["link-state", "leaf-to-leaf"], "F5": ["per-flow", "per-flowlet", "per-packet"]}
try:
    o = json.loads(body)
except Exception as e:
    print(f"not JSON: {e}"); sys.exit(1)
errs = []
want = {"reply", "cites", "detected_pick", "properties_mentioned", "ready_to_reveal", "fallback"}
if set(o) != want: errs.append(f"keys {sorted(o)}")
if not isinstance(o.get("reply"), str) or not o["reply"].strip(): errs.append("empty reply")
if not isinstance(o.get("cites"), list) or not all(isinstance(c, str) for c in o["cites"]): errs.append("cites")
if o.get("detected_pick") not in options[fork] + [None]: errs.append(f"detected_pick {o.get('detected_pick')!r}")
if not isinstance(o.get("properties_mentioned"), list) or not set(o["properties_mentioned"]) <= {"P1","P2","P3","P4","P5"}: errs.append("properties_mentioned")
if not isinstance(o.get("ready_to_reveal"), bool): errs.append("ready_to_reveal")
if o.get("fallback") is not False: errs.append("fallback reply (the model's output failed validation twice, or the API call failed)")
if errs:
    print("; ".join(errs)); sys.exit(1)
words = len(o["reply"].split())
note = "" if o["detected_pick"] == expected else f"  [note: expected pick {expected}]"
print(f"pick={o['detected_pick']} props={o['properties_mentioned']} cites={o['cites']} reveal={o['ready_to_reveal']} words={words}{note}")
print("      reply: " + o["reply"].replace("\n", " ")[:300])
PY
}

echo "Tutor smoke test against $URL"
echo "F1-F5: a pick with a reason, one fresh session each"
declare -A MSG=(
  [F1]="Distributed. Datacenter traffic is bursty, so a central scheduler would react too slowly (P1)."
  [F2]="In-network. Operators often can't change the end-host stack, so it has to be transport independent (P2)."
  [F3]="Global. With asymmetry a switch's own links don't show the congestion further downstream (P3)."
  [F4]="Leaf to leaf, because it is deployable with an overlay and near-optimal for leaf-spine (P4, P5)."
  [F5]="Per flowlet: no TCP changes are needed and packets aren't reordered (P2)."
)
declare -A PICK=([F1]=distributed [F2]=in-network [F3]=global [F4]=leaf-to-leaf [F5]=per-flowlet)
for f in F1 F2 F3 F4 F5; do
  t0=$(date +%s%N)
  post "$RUN-$f" "$f" "${MSG[$f]}"
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  if [ "$STATUS" != "200" ]; then fail "$f: HTTP $STATUS $BODY"; continue; fi
  if detail=$(check_json "$f" "${PICK[$f]}"); then pass "$f (${ms} ms) $detail"; else fail "$f: $detail"; fi
done

echo "Limits"
post "$RUN-F1" "F1" "And what about B4?"   # same session as F1, right after it
if [ "$STATUS" = "429" ] && grep -q '"too_fast"' <<<"$BODY"; then pass "second message within 3 s -> 429 too_fast"; else fail "too_fast: HTTP $STATUS $BODY"; fi
post "$RUN-long" "F1" "$(printf 'x%.0s' $(seq 1 601))"
if [ "$STATUS" = "400" ] && grep -q '"too_long"' <<<"$BODY"; then pass "601 characters -> 400 too_long"; else fail "too_long: HTTP $STATUS $BODY"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}')
if [ "$code" = "403" ]; then pass "other origin -> 403"; else fail "origin check: HTTP $code"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$URL" -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST")
if [ "$code" = "204" ]; then pass "CORS preflight from $ORIGIN -> 204"; else fail "preflight: HTTP $code"; fi

echo "Free question (no fork)"
post "$RUN-free" "null" "What is a flowlet, in one sentence?"
if [ "$STATUS" = "200" ] && python3 -I -c 'import json,sys; o=json.loads(sys.argv[1]); assert o["fallback"] is False and o["detected_pick"] is None and o["reply"].strip()' "$BODY" 2>/dev/null; then
  pass "free question -> $(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["reply"][:160])' "$BODY")"
else fail "free question: HTTP $STATUS $BODY"; fi

echo "Forced provider 429 (free quota used up)"
if command -v deno >/dev/null; then
  cd "$(dirname "$0")/.."
  STUB_PORT=8788; Q_PORT=8789
  # A stand-in for the provider that answers every call with 429.
  python3 -I -c '
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(429); self.send_header("retry-after", "30"); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(b"{\"error\":{\"message\":\"Rate limit reached\",\"code\":\"rate_limit_exceeded\"}}")
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()' "$STUB_PORT" &
  STUB_PID=$!
  [ -f tools/.out/chunks.json ] || node tools/build-chunks.mjs >/dev/null
  # A second tutor instance pointed at the stub; dummy key, no real secret involved.
  GROQ_API_KEY=dummy-not-a-key TUTOR_MODEL=stub TUTOR_LLM_BASE_URL="http://127.0.0.1:$STUB_PORT" TUTOR_DEV=1 \
    TUTOR_PORT="$Q_PORT" TUTOR_CHUNKS_FILE=tools/.out/chunks.json \
    deno run --allow-net --allow-env --allow-read supabase/functions/tutor/index.ts >/dev/null 2>&1 &
  Q_PID=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$Q_PORT" && break; sleep 0.5; done
  SAVED_URL="$URL"; URL="http://127.0.0.1:$Q_PORT"
  post "$RUN-quota" "F1" "Distributed, because of P1."
  URL="$SAVED_URL"
  kill "$Q_PID" "$STUB_PID" 2>/dev/null; wait "$Q_PID" "$STUB_PID" 2>/dev/null
  if [ "$STATUS" = "429" ] && python3 -I -c 'import json,sys; o=json.loads(sys.argv[1]); assert o["error"] == "quota" and o["reply"]' "$BODY" 2>/dev/null; then
    pass "provider 429 -> HTTP 429 {error: \"quota\"} (no retry): $(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["reply"])' "$BODY")"
  else fail "quota: HTTP $STATUS $BODY"; fi
else
  echo "  SKIP (deno not on PATH)"; fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then echo "ALL PASSED"; else echo "$fails FAILED"; exit 1; fi
