# Use Node 18 Alpine to support modern packages like pg and redis
FROM node:18-alpine

# Install build tools needed to compile native addons like sqlite3 if required
RUN apk add --no-cache python3 make g++ wget

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy dependency files first to optimize Docker layer caching
COPY package.json package-lock.json* /usr/src/app/

# Install dependencies and clean npm cache to keep the container slim
RUN npm install && npm cache clean --force

# Copy the rest of the application source code
COPY . /usr/src/app/

# Build client-side assets (Gulp tasks compile the frontend bundle)
RUN npx gulp build

# Expose the port the game server listens on
EXPOSE 3000

# Healthcheck to verify the web server is responsive
HEALTHCHECK --interval=5m --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the game using the repository's standard Gulp runner
CMD [ "npm", "start" ]
