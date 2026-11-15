# Deployment readiness — NOT approved as a complete office

As of the last GitHub check, main is still upstream 273a9ad142968c7cb963244178cde3177c1b20a4; adaptation branch was b122f2933de2d698bd2f88457c4dc416f1ab550f before these changes. Recheck refs before any deployment: a reported merge is not proof of which commit a service builds.

Original Dockerfile installs Claude SDK and starts root server.mjs, with original business configuration. Even merging this additive directory does NOT switch that startup. Do not point an OpenAI-only deployment at that Dockerfile unchanged.

## Actual component available
`server-chatgpt.mjs` is a separate, opt-in draft-only entrypoint. It connects to an existing authorized ChatGPT login before listening, injects the runtime into the protected manual workspace, and fails closed without it. It does not log in or expose login/upload-token endpoints. The original and manual-only entrypoints remain unchanged. Draft success is not full office completion or external execution.

Explicit environment required (values must be supplied securely, no sample secrets):
- OFFICE_ENABLE_CHATGPT_DRAFTS=1 and OFFICE_HOST_ISOLATION_VERIFIED=1. These switches are acknowledgments, NOT sandbox enforcement or proof.
- OFFICE_CODEX_BINARY: absolute, pinned trusted Codex binary; installed alpha was tested only for unauthenticated handshake.
- OFFICE_CODEX_HOME: dedicated owner-authenticated directory, never shared with other services/accounts.
- OFFICE_WORKSPACE: empty isolated real directory, no symlink/project config.
- OFFICE_MODEL: explicit model accessible under owner subscription; never guessed entitlement.
- OFFICE_PASSWORD, OFFICE_DATA_DIR, OFFICE_ORIGIN: dedicated password, private durable directory, exact HTTPS origin. Credentials never go in git/logs.
- HOST defaults to loopback, PORT to 3000. Public container binding requires reviewed proxy/TLS/access controls.

## Still blocks production launch
1. Official binary packaged/pinned in intended image; target environment startup and OS filesystem/network isolation verified. No Dockerfile has been changed here.
2. Owner performs official ChatGPT login on that isolated target; no keys copied from this assistant or other accounts.
3. Authenticated draft test verifies subscription/model access, interruption, reconnect/restart, usage limits and absence of paid fallback.
4. Visual UI QA, backup/restore, correct service identity and aggregate CPU/RAM limits. For previously observed 8 CPU/24028.3MB host, 70% memory was below 20GB; remeasure current host rather than assuming those figures still apply.
5. Full upstream tool/hook migration remains incomplete. This release offers a draft component, not the complete autonomous office. Never replace a working office and call this equivalent.

## Restart correction
Official unauthenticated app-server creates installation_id, .tmp, bundled skills/.system and SQLite state files. Previous auth-only home validation would reject those on restart. Validation now allows only these observed runtime-entry classes, rejects unknown config/plugins/custom-skill directories and top-level symlinks. This is an allowlist check, not a security boundary against a compromised binary or malicious administrator. No credentials were read during the observed-artifact check.

No server, service, DNS, budget, repository main or deployment was changed by this work.
