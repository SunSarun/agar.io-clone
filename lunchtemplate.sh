#!/bin/bash
# ------------------------------------------------------------------
# Unified Production Deployment Script
# ------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive
sudo su
echo "=== [1/4] Installing Docker completely standalone ==="
apt-get update -yq
apt-get install -yq docker.io

# Ensure Docker is actively running before moving to the next line
systemctl daemon-reload
systemctl start docker
systemctl enable docker
usermod -aG docker ubuntu

echo "=== [2/4] Verifying Docker status ==="
docker --version

echo "=== [3/4] Pulling application image ==="
docker pull sunsarun/agar-clone-redis:v1

echo "=== [4/4] Starting Game Container ==="
docker rm -f agar-game-server || true

docker run -d \
  --name agar-game-server \
  --restart always \
  -p 80:3000 \
  -e REDIS_URL='redis://clustercfg.agar-game-redis.zi6aqy.apse1.cache.amazonaws.com:6379' \
  -e DATABASE_URL='postgresql://postgres:?7NK~MUx4$UD!}M@agar-game-db.cvug6awgsp8o.ap-southeast-1.rds.amazonaws.com:5432/postgres' \
  -e DB_HOST='agar-game-db.cvug6awgsp8o.ap-southeast-1.rds.amazonaws.com' \
  -e DB_USER='postgres' \
  -e DB_PASSWORD='?7NK~MUx4$UD!}M' \
  -e DB_NAME='postgres' \
  sunsarun/agar-clone-redis:v1

echo "=== All Steps Completed Successfully ==="
