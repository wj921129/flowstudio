# FlowStudio

FlowStudio is a collaborative diagramming platform.

## Architecture

This project is organized as a monorepo using pnpm workspaces:

- `packages/shared`: Shared TypeScript types, schemas, and domain constants (`@flowstudio/shared`).
- `packages/server`: Backend server stub for collaboration, sync, and storage (`@flowstudio/server`).
- `packages/web`: Frontend application built with Vite + React 19 + TypeScript (`@flowstudio/web`).

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the web development server
pnpm dev
```
