# OpenAI adaptation: isolated development module

This directory is additive. It does NOT replace the upstream server, runner, Dockerfile, workflows or production deployment. Do not start the repository root expecting an OpenAI-only office: the original Claude integrations remain unchanged.

## What works
- Password-protected local manual task board, task creation, manual completion/cancellation, atomic JSON storage and recovery after restart.
- Idempotency keys prevent repeated form submission from creating duplicate tasks. Status explicitly distinguishes manual completion from AI execution.
- Protocol adapter and event/SDK compatibility seams using injected transports. No process launcher, network credentials or real inference are connected.

## What does NOT work yet
This is NOT the complete autonomous office. Real ChatGPT subscription authentication, app-server transport, tools/hooks/permissions migration, reconnection and production integration remain incomplete. There is no automatic mock or paid API fallback. Unported SDK options fail closed. Calling mocked RPC tests successfully does not prove ChatGPT authentication, compatibility with a subscription, no-billing configuration or a live deployment.

The manual server does not import the adapter, upstream modules or mock workers. It creates records only; clicking completed means the user marked a task complete. No advertising, emails, messages, CRM edits or external actions are enabled.

## Tests
Node >=20, no dependency installation required:

    cd openai-adaptation
    npm test

46 tests: 31 protocol/bridge offline fixtures and 15 manual-workspace tests, including real local HTTP and file persistence. Tests do not execute model inference. The historical migration-copy test is intentionally omitted because the copied upstream review tree is not published in this module. UI pixel/browser QA has not passed: Chromium was unavailable under the execution environment's socket restriction. API tests are not visual QA.

## Local manual board
Set OFFICE_PASSWORD using a local secret mechanism (minimum 16 characters) and OFFICE_DATA_DIR to an absolute private directory dedicated to this process. Never commit secrets or that data directory.

    node server-safe.mjs

Default bind is 127.0.0.1:3000; Basic Auth username is `jorge`. Password has no default. Keep local unless a reviewed TLS reverse proxy, exact OFFICE_ORIGIN and access controls are in place. Do not expose Basic Auth over plaintext public HTTP. Use a dedicated process-owned data volume; this prototype is not a multi-tenant security boundary.

## Security and next steps
- Treat adapters as protocol code, not a sandbox. Never connect an unsanitized host configuration, plugins or provider keys.
- Before real inference, verify isolated Codex version/config and authorized ChatGPT login; no paid API credentials/providers or inherited tools. Do not copy browser/session secrets into this repository.
- Port all three upstream consumers with explicit scoped tool approvals; preserve hooks and permissions instead of silently discarding them.
- Connect real turn lifecycle with interrupted/restarted flows; keep manual and verified execution statuses separate.
- Before deployment: visual QA, storage isolation/backups, resource caps summed over the stack, and an authenticated end-to-end real test. Do not deploy this manual scaffold as the finished office.

Protocol was originally inspected against Codex CLI 0.167.0-alpha.4; validate target version before connecting. Upstream base: 273a9ad142968c7cb963244178cde3177c1b20a4. Official protocol reference: https://developers.openai.com/codex/app-server

## Stage 5: stdio/runtime integration seam
Added actual NDJSON child-process transport and an explicit `ChatGPTDraftRuntime`: initialize/account check, draft streaming, cancellation and cleanup. The manual server accepts an injected runtime, with authenticated `/api/assistant/draft` and `/api/assistant/cancel` endpoints. Default `server-safe.mjs` does NOT inject it and drafts return 503. There is no connect/login HTTP endpoint, no secret uploads and no automatic startup of Codex.

`launchIsolatedCodex` is an operator-only factory, disabled by default. It rejects relative paths, home symlinks, existing config/plugins/files other than auth.json, API-key auth and nonempty workspaces. Environment is allowlisted, not inherited. Owner login must be completed using the official Codex flow in the isolated home; this code does not log in on anyone's behalf. If Codex creates other home files, subsequent launches fail closed pending explicit isolation review; do not erase history/auth to work around that.

52 tests pass: includes a REAL local child process speaking FAKE test protocol, not real ChatGPT or a real login. `test/fixtures/app-server-fixture.mjs` is intentionally fake, never imported by production code. Request to execute tools/approve actions remains denied by the adapter. Runtime is draft-only. An account/read type=chatgpt is a necessary check, not independently proof of billing/config or a security boundary. Do not enable on VPS until official binary/version, configuration isolation, host sandbox/network restrictions and the subscription login are verified. Instructions saying “no tools” are not a substitute for OS isolation. No real inference, billing, browser auth, VPS or deployment has been tested.

## Official binary probe and fixes
See [COMPATIBILITY.md](COMPATIBILITY.md): 53 local tests plus successful unauthenticated initialize/account-read against installed official Codex 0.167.0-alpha.4. No real login or inference. Frame batching/EOF and readiness labeling corrected.

## Read-only tool port (opt-in, not deployed)
58 tests pass. `manualSnapshot` opt-in enables only scoped `ver_tablero`, reading a detached bounded snapshot, never original upstream state. Default runtime/server still advertises no dynamic tools. All approval requests other than this exact read-only tool remain denied. See [TOOL-MIGRATION.md](TOOL-MIGRATION.md) for 114 statically located upstream tool declarations and unmapped permission/hook dependencies. No authenticated tool inference has been tested.
