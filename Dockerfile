ARG NODE_VERSION=21.6.2
FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /usr/src/app

# Copy package files and install ALL dependencies (including dev).
COPY package*.json ./
RUN npm ci

# Copy the rest of the source code (including tsconfig).
COPY . .

# Build TypeScript
RUN npm run build

# --- Runtime image ---
FROM node:${NODE_VERSION}-alpine

WORKDIR /usr/src/app

# Only prod dependencies for runtime
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built JS files
COPY --from=build /usr/src/app/dist ./dist
# Copy any other needed files (e.g., migrations, .env.example, etc) as needed.

USER node

CMD ["node", "dist/index.js"]
