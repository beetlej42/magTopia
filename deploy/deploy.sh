#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ENV="${MAGICTOWN_DEPLOY_ENV:-/opt/magictown/shared/deploy.env}"
if [[ -f "$DEPLOY_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV"
  set +a
fi

ROOT="${MAGICTOWN_ROOT:-/opt/magictown}"
REPO_URL="${MAGICTOWN_REPO_URL:-https://github.com/beetlej42/magTopia.git}"
BRANCH="${MAGICTOWN_BRANCH:-main}"
KEEP="${MAGICTOWN_RELEASES_TO_KEEP:-3}"
REQUESTED_SHA="${1:-}"

mkdir -p "$ROOT/releases" "$ROOT/shared"

if [[ -n "$REQUESTED_SHA" ]]; then
  SHA="$REQUESTED_SHA"
else
  SHA="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | awk '{print $1}')"
fi
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Cannot resolve a full commit SHA for $BRANCH" >&2
  exit 1
fi

RELEASE="$ROOT/releases/$SHA"
if [[ ! -f "$RELEASE/.magictown-release" ]]; then
  rm -rf "$RELEASE"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$RELEASE"
  git -C "$RELEASE" fetch --depth=1 origin "$SHA"
  git -C "$RELEASE" checkout --detach "$SHA"
  printf '%s\n' "$SHA" > "$RELEASE/.magictown-release"
fi

ln -sfn /etc/magictown/magictown.env "$RELEASE/.env"
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm run build
pnpm run db:migrate

PREVIOUS=""
if [[ -L "$ROOT/current" ]]; then PREVIOUS="$(readlink -f "$ROOT/current")"; fi
ln -sfn "$RELEASE" "$ROOT/current"
sudo -n systemctl restart magictown.service

HEALTHY=0
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:4184/healthz >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != "1" ]]; then
  echo "MAGTOPIA health check failed; attempting rollback" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$ROOT/current"
    sudo -n systemctl restart magictown.service
  fi
  exit 1
fi

mapfile -t OLD_RELEASES < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +$((KEEP + 1)) | cut -d' ' -f2-)
for OLD in "${OLD_RELEASES[@]}"; do rm -rf "$OLD"; done

echo "MAGTOPIA deployed: $SHA"
