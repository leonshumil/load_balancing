#!/usr/bin/env bash
# Stamp a built site so a stale cached copy is easy to spot and can't linger after a deploy.
#   tools/stamp-build.sh <site dir> <label> <version>
#   e.g. tools/stamp-build.sh _site/preview "dev · 1a2b3c4" 1a2b3c4
# 1. The page footer (<!--BUILD-->…<!--/BUILD-->) gets "<label> · <UTC time>".
# 2. Every local script, stylesheet and relative module import gets ?v=<version>, so after a
#    deploy the browser fetches the new files instead of mixing them with cached old ones
#    (GitHub Pages lets browsers keep files for 10 minutes).
set -euo pipefail
dir="$1"; label="$2"; v="$3"
when="$(date -u +"%Y-%m-%d %H:%M UTC")"
find "$dir" -name '*.html' -print0 | xargs -0 -r sed -i -E \
  -e "s#<!--BUILD-->[^<]*<!--/BUILD-->#<!--BUILD-->${label} · ${when}<!--/BUILD-->#g" \
  -e "s#((src|href)=\"[^\":?]+\.(js|css))(\?[^\"]*)?\"#\1?v=${v}\"#g" \
  -e "s#((from|import)[[:space:]]*\"\.{1,2}/[^\"?]+\.js)(\?[^\"]*)?\"#\1?v=${v}\"#g"
find "$dir" -name '*.js' -print0 | xargs -0 -r sed -i -E \
  -e "s#((from|import)[[:space:]]*\"\.{1,2}/[^\"?]+\.js)(\?[^\"]*)?\"#\1?v=${v}\"#g"
