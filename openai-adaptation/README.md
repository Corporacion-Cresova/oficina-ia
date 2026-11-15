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
