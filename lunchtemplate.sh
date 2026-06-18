#!/bin/bash
# 1. Update the apt package index
apt-get update -y

# 2. Install prerequisites to allow apt to use a repository over HTTPS
apt-get install -y ca-certificates curl gnupg lsb-release

# 3. Add Docker’s official GPG key
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 4. Set up the stable repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.p/docker.list > /dev/null

# 5. Update the apt package index again and install Docker Engine
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io

# 6. Ensure Docker starts on boot
systemctl start docker
systemctl enable docker

# 7. Pull and run the Agar.io clone from GHCR
# Maps host port 80 to container port 3000
docker run -d \
  --name agario-clone \
  --restart always \
  -p 80:3000 \
  ghcr.io/owenashurst/agar.io-clone:master
