#!/usr/bin/env bash
#
# Reconstruct the exact R2 final-convergence candidate (fingerprint
# 1514fd2aecf99675d252089bce10b90af8a3b990742e4e5daf6d1f5e967e7760) under a
# disposable /tmp directory, from the sources documented in
# gwx-ops/reports/r2-final-candidate-convergence.md.
#
# READ-ONLY with respect to every source worktree: the SOL worktree is only
# read (git diff / git ls-files / cp -p FROM it); nothing is written back.
# All writes land in $CAND (a throwaway --shared clone under /tmp).
#
# Layers (documented order; scopes are mutually disjoint):
#   base 9b283b9  ->  schema-recon a9f51fc (prisma/schema.prisma)
#                 ->  PRAGMA repair 6da1fff (migration runner + tests/migrations)
#                 ->  SOL tracked working-tree diff (read-only from SOL worktree)
#                 ->  regression pack 29f141b (__tests__/r2-regression/, 11 files)
#                 ->  regression refresh 59960cc (auditFailure.test.ts)
#                 ->  SOL untracked non-ignored files (verbatim copy)
#
# Env overrides: SRC (repo containing the commits), SOL (repaired worktree),
# CAND (output dir). Prints the computed fingerprint on the last line.
set -euo pipefail

SRC="${SRC:?SRC (repo with the assembly commits) required}"
SOL="${SOL:?SOL (repaired worktree) required}"
CAND="${CAND:?CAND (output candidate dir) required}"

BASE=9b283b97180578978f4240d3c77cedc8104be1ec
SCHEMA_RECON=a9f51fca62e7be68a0af13e13067dd61f481a245
PRAGMA=6da1fff90852b3d3f449516e454dee9c8bbcc639
REGPACK=29f141bf169a6bda539857401e621d28d5911d2f
REGREFRESH=59960cce769a2e7ddf2d692e42ebef909eec1396
EXPECTED=1514fd2aecf99675d252089bce10b90af8a3b990742e4e5daf6d1f5e967e7760

rm -rf "$CAND"
mkdir -p "$(dirname "$CAND")"

git clone --quiet --shared "$SRC" "$CAND"
git -C "$CAND" checkout --quiet --detach "$BASE"

# schema recon (prisma/schema.prisma only)
git -C "$SRC" diff "$BASE" "$SCHEMA_RECON" -- prisma/schema.prisma \
  | git -C "$CAND" apply --whitespace=nowarn

# PRAGMA repair (migration runner + tests/migrations, 5 files)
git -C "$SRC" diff "$BASE" "$PRAGMA" -- \
  scripts/apply-turso-migrations.mjs \
  tests/migrations/foreign-key-pragma-repair.test.ts \
  tests/migrations/helpers.ts \
  tests/migrations/restoration-and-integrity.test.ts \
  tests/migrations/statement-splitting.test.ts \
  | git -C "$CAND" apply --whitespace=nowarn

# SOL tracked working-tree diff (read-only from the repaired worktree)
git -C "$SOL" diff --binary HEAD | git -C "$CAND" apply --binary --whitespace=nowarn

# regression pack (11 files under __tests__/r2-regression/) + refresh
git -C "$CAND" checkout "$REGPACK" -- __tests__/r2-regression/
git -C "$CAND" checkout "$REGREFRESH" -- __tests__/r2-regression/auditFailure.test.ts

# SOL untracked non-ignored files (verbatim)
( cd "$SOL" && git ls-files --others --exclude-standard -z ) | while IFS= read -r -d '' f; do
  mkdir -p "$CAND/$(dirname "$f")"
  cp -p "$SOL/$f" "$CAND/$f"
done

git -C "$CAND" add -A
FP=$(git -C "$CAND" ls-files -s | LC_ALL=C sort | sha256sum | awk '{print $1}')
echo "ASSEMBLED_FINGERPRINT=$FP"
echo "EXPECTED_FINGERPRINT=$EXPECTED"
[ "$FP" = "$EXPECTED" ]
