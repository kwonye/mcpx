# GEMINI.md

## Project Overview

`mcpx` is an HTTP-first Model Context Protocol (MCP) gateway and cross-client installer. It allows users to install upstream MCP servers once and expose them to multiple AI clients (like Claude, Cursor, Cline, etc.) through a managed local gateway daemon.

### Main Technologies
- **Language:** TypeScript (Node.js)
- **Frameworks/Libraries:**
    - `@modelcontextprotocol/sdk`: For interacting with MCP servers and clients.
    - `commander`: For building the CLI.
    - `zod`: For configuration validation and type safety.
    - `vitest`: For unit and integration testing.
    - `tsx`: For running TypeScript files directly during development.
- **Architecture:**
    - **CLI (`src/cli.ts`):** The main entry point for managing servers, secrets, and the daemon.
    - **Gateway Server (`src/gateway/server.ts`):** An HTTP server that proxies JSON-RPC requests from clients to upstream MCP servers (both HTTP and stdio).
    - **Daemon (`src/core/daemon.ts`):** Manages the background process for the gateway.
    - **Adapters (`src/adapters/`):** Client-specific logic for syncing configuration with AI applications.
    - **Secrets Manager (`src/core/secrets.ts`):** Integration with the OS keychain (macOS `security` CLI) for secure storage.

## Building and Running

### Development
- **Install dependencies:** `npm install`
- **Run CLI in development mode:** `npm run dev -- [args]` (e.g., `npm run dev -- list`)
- **Run tests:** `npm test` or `npm run test:watch`

### Production
- **Build the project:** `npm run build`
- **Run the compiled CLI:** `node dist/cli.js [args]`
- **Global installation:** `npm install -g .` (from root)

## Development Conventions

- **Module System:** Uses ES Modules (`"type": "module"` in `package.json`).
- **Configuration:** Centrally managed in `~/.config/mcpx/config.json`. Schema is defined using Zod in `src/core/config.ts`.
- **Testing:** 
    - Tests are located in the `test/` directory.
    - Uses `vitest` as the test runner.
    - Integration tests often spin up mock HTTP/stdio servers to verify gateway behavior.
    - Uses a `setupTempEnv` helper to isolate configuration and state during tests.
- **Error Handling:** Uses custom error classes (e.g., `UpstreamHttpError`) and structured JSON-RPC error responses.
- **Security:** Sensitive values (tokens, headers) should be stored in the keychain via `mcpx secret set` or `mcpx auth set` rather than being hardcoded or placed in plaintext files.

## Project Structure Highlights

- `src/cli.ts`: Command definitions and action handlers.
- `src/gateway/server.ts`: Core request routing and protocol translation logic.
- `src/core/`: Internal logic for registry, daemon management, paths, and secrets.
- `src/adapters/`: Implementation of the `ClientAdapter` interface for various AI clients.
- `src/types.ts`: Centralized TypeScript interfaces and types.
- `test/fixtures/`: Contains mock servers and other test data.
