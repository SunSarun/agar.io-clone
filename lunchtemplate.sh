#!/bin/bash
echo "=== [1/3] Pulling game image from DockerHub ==="
docker pull sunsarun/agar-clone-redis:v1

echo "=== [2/3] Cleaning up any old container instances ==="
docker rm -f agar-game-server || true

echo "=== [3/3] Launching Working Game Server Container ==="
docker run -d \
  --name agar-game-server \
  --restart always \
  -p 3000:3000 \
  -e REDIS_URL='redis://clustercfg.agar-game-redis.zi6aqy.apse1.cache.amazonaws.com:6379' \
  -e DATABASE_URL='postgresql://postgres:?7NK~MUx4$UD!}M@agar-game-db.cvug6awgsp8o.ap-southeast-1.rds.amazonaws.com:5432/postgres' \
  -e DB_HOST='agar-game-db.cvug6awgsp8o.ap-southeast-1.rds.amazonaws.com' \
  -e DB_USER='postgres' \
  -e DB_PASSWORD='?7NK~MUx4$UD!}M' \
  -e DB_NAME='postgres' \
  sunsarun/agar-clone-redis:v1

echo "=== Bootstrapping Process Complete! ==="
