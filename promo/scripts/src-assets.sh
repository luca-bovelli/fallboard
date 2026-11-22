#!/usr/bin/env bash
# The film's local-only sources (promo/_src: Rousseau's video and its frames, the meme sounds) for
# cloud renders. They are not ours to publish and the repository is public, so they travel as one
# encrypted archive on the `promo-src` release; the key is the Actions secret PROMO_SRC_KEY.
#
#   GH_TOKEN=… PROMO_SRC_KEY=… promo/scripts/src-assets.sh push   pack, encrypt, replace the asset
#   PROMO_SRC_KEY=… promo/scripts/src-assets.sh fetch             download, decrypt into promo/_src
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=luca-bovelli/fallboard
TAG=promo-src
ASSET=promo-src.tar.enc
API=https://api.github.com/repos/$REPO
: "${PROMO_SRC_KEY:?PROMO_SRC_KEY is not set}"

case "${1:-}" in
  push)
    : "${GH_TOKEN:?GH_TOKEN is not set}"
    auth=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json")
    tmp=$(mktemp -d)
    tar -C promo/_src -cf "$tmp/src.tar" --exclude='*.log' --exclude='seg.raw' --exclude='rousseau-a.m4a' --exclude='rousseau-v.mp4' .
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PROMO_SRC_KEY -in "$tmp/src.tar" -out "$tmp/$ASSET"
    rel=$(curl -fsS "${auth[@]}" "$API/releases/tags/$TAG" || true)
    if [ -z "$rel" ]; then
      rel=$(curl -fsS "${auth[@]}" -X POST "$API/releases" \
        -d "{\"tag_name\":\"$TAG\",\"name\":\"Promo sources (encrypted)\",\"body\":\"Encrypted inputs for the promo film's cloud renders. Not usable without the workflow's key.\",\"prerelease\":true}")
    fi
    id=$(printf '%s' "$rel" | python -c "import json,sys; print(json.load(sys.stdin)['id'])")
    old=$(printf '%s' "$rel" | python -c "import json,sys; print(' '.join(str(a['id']) for a in json.load(sys.stdin).get('assets',[]) if a['name']=='$ASSET'))")
    for a in $old; do curl -fsS "${auth[@]}" -X DELETE "$API/releases/assets/$a"; done
    curl -fsS "${auth[@]}" -H "Content-Type: application/octet-stream" --data-binary @"$tmp/$ASSET" \
      "https://uploads.github.com/repos/$REPO/releases/$id/assets?name=$ASSET" > /dev/null
    echo "uploaded $(du -h "$tmp/$ASSET" | cut -f1) to $TAG/$ASSET"
    rm -rf "$tmp"
    ;;
  fetch)
    mkdir -p promo/_src
    curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$ASSET" \
      | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:PROMO_SRC_KEY \
      | tar -C promo/_src -xf -
    echo "promo/_src: $(ls promo/_src | tr '\n' ' ')"
    ;;
  *) echo "usage: $0 push|fetch" >&2; exit 2 ;;
esac
