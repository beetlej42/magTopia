#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Run this bootstrap script as root" >&2
  exit 1
fi

BOOTSTRAP_ENV="${MAGICTOWN_BOOTSTRAP_ENV:-/etc/magictown/bootstrap.env}"
if [[ -f "$BOOTSTRAP_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BOOTSTRAP_ENV"
  set +a
fi
: "${MAGICTOWN_PUBLIC_BASE_URL:?Create /etc/magictown/bootstrap.env with MAGICTOWN_PUBLIC_BASE_URL before running bootstrap}"
if [[ "$MAGICTOWN_PUBLIC_BASE_URL" == *YOUR_SERVER_IP* ]]; then
  echo "MAGICTOWN_PUBLIC_BASE_URL still contains the placeholder YOUR_SERVER_IP" >&2
  exit 1
fi
MAGICTOWN_CADDY_SITE="${MAGICTOWN_CADDY_SITE:-$MAGICTOWN_PUBLIC_BASE_URL}"

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git build-essential openssl

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@11.7.0 --activate

id -u magictown >/dev/null 2>&1 || useradd --system --home /opt/magictown --shell /usr/sbin/nologin magictown
id -u magictown-deploy >/dev/null 2>&1 || useradd --home-dir /opt/magictown --shell /bin/bash magictown-deploy
usermod -a -G magictown magictown-deploy
install -d -o magictown-deploy -g magictown /opt/magictown/releases /opt/magictown/shared
install -d -o root -g magictown -m 0750 /etc/magictown

cat > /etc/sudoers.d/magictown-deploy <<'EOF'
magictown-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart magictown.service
EOF
chmod 0440 /etc/sudoers.d/magictown-deploy
visudo -cf /etc/sudoers.d/magictown-deploy

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='magictown'" | grep -q 1; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE magictown LOGIN PASSWORD '$DB_PASSWORD'"
  printf '%s\n' "$DB_PASSWORD" > /etc/magictown/.db-password
  chmod 600 /etc/magictown/.db-password
else
  DB_PASSWORD="$(cat /etc/magictown/.db-password)"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname='magictown'" | grep -q 1 || sudo -u postgres createdb -O magictown magictown

install -m 0644 deploy/magictown.service /etc/systemd/system/magictown.service
install -m 0755 deploy/deploy.sh /opt/magictown/deploy.sh
install -m 0644 deploy/deploy.env.example /opt/magictown/shared/deploy.env

if [[ ! -f /etc/magictown/magictown.env ]]; then
  cat > /etc/magictown/magictown.env <<EOF
MAGICTOWN_HOST=127.0.0.1
MAGICTOWN_PORT=4184
MAGICTOWN_PUBLIC_BASE_URL=${MAGICTOWN_PUBLIC_BASE_URL}
MAGICTOWN_DATABASE_URL=postgres://magictown:${DB_PASSWORD}@127.0.0.1:5432/magictown
MAGICTOWN_VOXEL_ONLY=1
MAGICTOWN_ASSET_PROVIDER=voxel
MAGICTOWN_CAPABILITY_TTL_MINUTES=30
MAGICTOWN_CREDENTIAL_TTL_DAYS=1
MAGICTOWN_AUTO_MIGRATE=1
EOF
fi
chown root:magictown /etc/magictown/magictown.env
chmod 640 /etc/magictown/magictown.env

if command -v caddy >/dev/null 2>&1 && [[ -f /etc/caddy/Caddyfile ]] && ! grep -Fq "$MAGICTOWN_CADDY_SITE" /etc/caddy/Caddyfile; then
  printf '\n%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:4184\n}\n' "$MAGICTOWN_CADDY_SITE" >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
fi

systemctl daemon-reload
systemctl enable magictown.service
echo "Bootstrap complete. Run /opt/magictown/deploy.sh <main-commit-sha> next."
