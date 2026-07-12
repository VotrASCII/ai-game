#!/usr/bin/env bash
# Versions gitignored story-*/BIBLE.md design docs in a local-only sibling repo
# (~/ai-game-bibles), so they get real history without ever entering the
# public ai-game repo or its GitHub remote. Run after any BIBLE.md edit.
#
# Usage: scripts/refresh-bible-bundle.sh
set -euo pipefail

MAIN_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIBLES_REPO="${BIBLES_REPO:-$HOME/ai-game-bibles}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$BIBLES_REPO/.git" ]; then
  echo "No bibles repo at $BIBLES_REPO — run: mkdir -p '$BIBLES_REPO' && git -C '$BIBLES_REPO' init" >&2
  exit 1
fi

changed=0
while IFS= read -r -d '' bible; do
  rel="${bible#"$MAIN_REPO"/}"
  dest="$BIBLES_REPO/$rel"
  mkdir -p "$(dirname "$dest")"
  if ! cmp -s "$bible" "$dest" 2>/dev/null; then
    cp "$bible" "$dest"
    changed=1
  fi
done < <(find "$MAIN_REPO" -type f -name 'BIBLE.md' -print0)

cd "$BIBLES_REPO"
git add -A

if git diff --cached --quiet; then
  if [ "$changed" -eq 0 ]; then
    echo "No bible changes since last refresh."
  fi
else
  git commit -q -m "Bible refresh $STAMP"
  echo "Committed bible changes ($STAMP)."
fi

BUNDLE="$HOME/ai-game-bibles-backup-$STAMP.bundle"
git bundle create "$BUNDLE" --all >/dev/null
echo "Bundle refreshed: $BUNDLE"
