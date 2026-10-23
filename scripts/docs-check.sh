#!/usr/bin/env bash
# docs-check: fail when README.md has fallen behind the repository.
#
#   1. Every Makefile target with a `## description` is mentioned in the
#      README as `make <target>`. In a repo with no Makefile, every root
#      package.json script is mentioned as `pnpm <script>` instead.
#   2. Every relative link in the README resolves to a file or directory.
#
# This is the mechanical half of keeping the README current. It cannot tell
# whether a procedure is still right; only reading the README against the
# change does that (see CLAUDE.md, "Documentation").
#
# Usage: make docs-check        (or: pnpm docs:check)
# Env:   DOCS_CHECK_SKIP="target other"  targets exempt from rule 1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$ROOT/README.md"
SKIP=" ${DOCS_CHECK_SKIP:-} "

if [ ! -f "$README" ]; then
  printf 'docs-check: %s does not exist\n' "$README" >&2
  exit 1
fi

missing=()

if [ -f "$ROOT/Makefile" ]; then
  targets="$( { grep -E '^[a-zA-Z0-9_.-]+:.*## ' "$ROOT/Makefile" || [ $? -eq 1 ]; } | cut -d: -f1)"
  for t in $targets; do
    case "$SKIP" in *" $t "*) continue ;; esac
    grep -qE "make ${t}([^a-zA-Z0-9_.-]|\$)" "$README" || missing+=("make $t")
  done
elif [ -f "$ROOT/package.json" ]; then
  scripts="$(node -e 'const p=require(process.argv[1]); console.log(Object.keys(p.scripts||{}).join("\n"))' "$ROOT/package.json")"
  for s in $scripts; do
    case "$SKIP" in *" $s "*) continue ;; esac
    grep -qE "pnpm (run )?${s}([^a-zA-Z0-9:_.-]|\$)" "$README" || missing+=("pnpm $s")
  done
fi

broken=()
# grep exits 1 when nothing matches; only a status above 1 is an error.
links="$( { grep -oE '\]\([^)]+\)' "$README" || [ $? -eq 1 ]; } | sed -E 's/^\]\(//; s/\)$//; s/[[:space:]].*$//')"
for link in $links; do
  case "$link" in http://* | https://* | mailto:* | '#'*) continue ;; esac
  path="${link%%#*}"
  [ -n "$path" ] || continue
  [ -e "$ROOT/$path" ] || broken+=("$link")
done

status=0
if [ "${#missing[@]}" -gt 0 ]; then
  printf 'README.md does not mention:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  status=1
fi
if [ "${#broken[@]}" -gt 0 ]; then
  printf 'README.md links to paths that do not exist:\n' >&2
  printf '  %s\n' "${broken[@]}" >&2
  status=1
fi
if [ "$status" -ne 0 ]; then
  printf 'Update README.md in this change (CLAUDE.md, "Documentation").\n' >&2
  exit 1
fi
printf 'docs-check: README covers every target and every link resolves\n'
