#!/usr/bin/env bash
# One-time droplet provisioning for the Ares Garrison host (Ubuntu 24.04).
# Run as root on a fresh droplet:  bash provision.sh
#
# What it does (idempotent where practical):
#   - non-root `deploy` user (docker group), key-only SSH, root login off
#   - ufw: deny all inbound except OpenSSH
#   - unattended-upgrades, fail2ban
#   - 2 GB swap
#   - Docker Engine + compose plugin
#   - Tailscale (installed, NOT joined — run `tailscale up` yourself)
#   - /srv/ares/home (the persistent ~/.ares volume)
set -euo pipefail

echo "== packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades

echo "== deploy user =="
if ! id deploy &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
fi
mkdir -p /home/deploy/.ssh
cp -n /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys || true
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

echo "== ssh hardening =="
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

echo "== firewall =="
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "== swap (2G) =="
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== docker =="
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
usermod -aG docker deploy

echo "== tailscale (install only) =="
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "== ares home =="
mkdir -p /srv/ares/home
chown -R deploy:deploy /srv/ares

echo "== unattended upgrades =="
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "Provisioning done. Manual next steps:"
echo "  1. tailscale up                      # join your tailnet"
echo "  2. as deploy: docker login registry.digitalocean.com (DOCR token)"
echo "  3. copy deploy/docker-compose.yml to /srv/ares/docker-compose.yml"
echo "  4. docker compose up -d"
