# Official binary compatibility: 15 November 2026 UTC

Tested installed `/opt/codex/bin/codex`, version `codex-cli 0.167.0-alpha.4`. Fresh temporary HOME, CODEX_HOME and empty workspace, allowlisted environment; no existing account secrets were read or copied.

Actual binary result (not fixture):
- `initialize` succeeded; keys: userAgent, codexHome, platformFamily, platformOs.
- `initialized` notification sent; `account/read` with refreshToken=false returned account=null, requiresOpenaiAuth=true.
- No login/start, model/list, thread/start or turn/start sent. No inference or account authentication performed. No claim about model entitlement, usage allowance or production readiness follows from this test.

Reproduce explicitly with trusted installed binary:

    node scripts/probe-official-unauthenticated.mjs /absolute/path/to/codex

This script is not part of default npm test and not automatically started by the server. It uses only initialize/initialized/account/read, then closes the child. Temporary test directories contain no account login.

## Corrections after validation
- NDJSON byte cap now applies per frame rather than rejecting several valid small frames in one OS pipe chunk.
- EOF closes transport immediately, not just on process exit.
- Runtime distinguishes transportConnected, chatgptAccountObserved and inferenceConnected: account inspection alone no longer reports a verified inference connection. Successful protocol result still requires the operator to know that the child is the audited official binary, not a fixture.
- 53 tests pass. The explicit official unauthenticated probe separately passes. Visual QA and authenticated inference remain untested.

## Official login route, not executed
For a headless VPS, official Codex supports `codex login --device-auth`. Device-code login must be allowed in the owner's ChatGPT/workspace settings. The owner follows the official verification page and code; never send passwords, auth.json or tokens to the repository or chat. A settings change requires its own appropriate authorization.

Alternatively, app-server supports account/login/start with type chatgptDeviceCode, returning verificationUrl/userCode, and account/login/completed. Browser callback login is also supported but requires a usable callback. Our HTTP server exposes neither flow yet. Only introduce a protected login UX after the owner authorizes the target host/account; do not reuse ambient credentials.

Sources: https://learn.chatgpt.com/docs/auth and https://learn.chatgpt.com/docs/app-server (official documentation, read 15 November 2026).

Plan/account availability, selected-model access, usage limits and server sandbox behavior must be verified after authorized login. No fallback to API keys, purchased credits or alternate provider is permitted by this project. Account/rateLimits/read can supply usage information after login; a model catalog alone is not proof of entitlement. The environment's binary is an alpha release; pin and revalidate the target installation rather than assuming identical behavior on VPS.
