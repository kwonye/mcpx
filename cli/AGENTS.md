# CLI Package Overview

`mcpx` is an HTTP-first Model Context Protocol (MCP) gateway and cross-client installer. This package contains the core library and the command-line interface.

## Technologies
- **Runtime:** Node.js (>=20)
- **CLI Framework:** `commander`
- **Validation:** `zod`
- **SDK:** `@modelcontextprotocol/sdk`
- **Testing:** `vitest`
- **Secrets:** Integration with macOS keychain via `security` CLI.

## Core Logic (`src/core/`)
- **`daemon.ts`**: Manages the background gateway process.
- **`config.ts`**: Centralized configuration management (~/.config/mcpx/config.json).
- **`sync.ts`**: Orchestrates client configuration updates.
- **`registry.ts`**: Interacts with the MCP registry for discovery.

## Gateway (`src/gateway/`)
An HTTP server that proxies JSON-RPC requests from AI clients (Claude, Cursor, etc.) to upstream MCP servers (stdio or HTTP).

## Client Adapters (`src/adapters/`)
Implementations for various AI clients to automate the registration of `mcpx` managed endpoints.

## Development
- `npm run dev -- [args]`: Run the CLI from source.
- `npm run build`: Compile TypeScript to `dist/`.
- `npm test`: Execute the test suite.
