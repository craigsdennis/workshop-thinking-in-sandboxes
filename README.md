# Thinking in Sandboxes Workshop

Interactive workshop app for exploring sandbox patterns with runnable sessions and examples.

## Prerequisites

- Node.js 18+ and npm
- Docker (required for local Cloudflare Sandbox containers)

If Docker is not installed:

- macOS / Windows: install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Linux: install [Docker Engine](https://docs.docker.com/engine/install/)

Verify Docker is running:

```bash
docker --version
```

## Run Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start in development mode (Vite)

```bash
npm run dev
```

This runs the app on a Vite dev server (typically `http://localhost:5173`).

### 3. Start in preview mode (build + Wrangler dev)

```bash
npm run preview
```

This builds the app and runs Wrangler dev (typically `http://localhost:8787`).

## Helpful Scripts

```bash
npm run typecheck
npm run build
npm run deploy
```

## More Information

[https://linkedout.dev/out/thinking-in-sandboxes](https://linkedout.dev/out/thinking-in-sandboxes)
