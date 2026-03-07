# CLI Package Overview

`mcpx` is an HTTP-first Model Context Protocol (MCP) gateway and cross-client installer. This package contains the core business logic, the HTTP gateway server, and the CLI interface.

## Core Features

- **Unified Configuration:** Manages a central registry of MCP servers in `~/.config/mcpx/config.json`.
- **Daemon Management:** Runs a background HTTP gateway that proxies client requests to upstream servers (stdio or HTTP).
- **Client Sync:** Automates the registration of managed MCP endpoints into multiple AI clients (Claude, Cursor, Cline, VS Code, etc.).
- **Secure Secrets:** Integrates with the macOS Keychain to store and rotate credentials (API keys, tokens).
- **Interactive Status:** Provides a rich TTY menu (`mcpx status`) for real-time monitoring and server management.
- **Compatibility Layer:** Supports client-native "add" commands (e.g., `mcpx claude mcp add ...`) to ease migration.

## Architecture (`src/`)

- **`core/`**: The "brain" of the project.
  - `config.ts`: Zod-validated configuration management.
  - `daemon.ts`: Lifecycle management for the background gateway.
  - `sync.ts`: Logic for updating third-party client config files.
  - `secrets.ts`: Keychain abstraction and secret resolution.
  - `status.ts`: Health reporting and interactive menu logic.
- **`gateway/`**: The HTTP server implementation.
  - Handles JSON-RPC multiplexing.
  - Manages upstream transport lifecycles (stdio pipes or HTTP sessions).
- **`adapters/`**: Client-specific logic for finding and patching config files (e.g., `claude_desktop_config.json`).
- **`compat/`**: Argument pre-parsing to support native commands from other MCP ecosystems.

## Development

### Key Commands
- `npm run dev -- [args]`: Run the CLI from source using `tsx`.
- `npm run build`: Compile TypeScript to `dist/`.
- `npm run sync-version`: Synchronizes versioning metadata across the repo.
- `npm test`: Run the test suite (Vitest).

### Core Export
This package exports a barrel at `src/core/index.ts` which is consumed as a library by the `@mcpx/core` alias in the desktop app.

## Testing
Tests are located in `test/` and include:
- Unit tests for core logic.
- Integration tests for the gateway server and sync adapters.
- Mock-based testing for the macOS Keychain integration.
