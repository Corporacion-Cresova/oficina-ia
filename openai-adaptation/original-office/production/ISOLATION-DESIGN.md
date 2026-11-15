# Codex isolation decision — proposal, not deployed

## Recommendation
Keep Codex an internal text-only planning daemon, and execute all video rendering in a separate credential-free worker. Do not enable general-purpose agent execution in the authenticated daemon. The existing structured storyboard adapter fits this separation; a new OAuth implementation is not needed.

A: office HTTP/UI + trusted orchestrator. Never expose app-server JSON-RPC directly to browser. Allow only narrowly fixed thread/turn/status methods, validate brand and job ownership, and reject user-provided cwd/config/provider/tools. No credentials in jobs, transcripts, returned errors or SSE.
B: Codex daemon, private IPC, independent UID/container/PID/mount namespace, root-owned requirements. Its managed login storage is ONLY mounted here; never in A or C. All native execution/read/browser/MCP/plugin paths must be disabled and empirically tested. Empty working directory, only explicit approved evidence text. No Docker socket or host mounts. Even read-only access to auth is unacceptable for model tools.
C: renderer, separate UID/container and filesystem, no auth volume, no daemon /proc visibility, no credential environment or inherited fds. Accept strict scene JSON, not generated JS, shell strings, arbitrary paths or URLs. Use bundled templates/assets. Return MP4 and metadata. Tool-like operations are performed here, not in B. No network needed for baseline rendering.

## Hard limit
Codex MUST hold a usable ChatGPT access credential in its process memory to authenticate. A second broker, keyring or ephemeral storage does not remove this fact. A same-UID command or memory-reading tool can defeat such a design. This architecture isolates credentials from tools, NOT from the Codex implementation itself. A demand for zero tokens anywhere in the inference process cannot be met with this local authenticated app-server design. Do not proxy/scrape ChatGPT private web endpoints to evade it.

## Authentication choices
Recommended production after acceptance: standard official ChatGPT login managed solely by B, isolated private credential storage; plan limits apply, never fallback to API key. Ephemeral mode is useful for initial testing but may require re-login on restart. Keyring is storage hygiene, not tool isolation. External-token mode is not a shortcut: it presumes an application legitimately owns the user's auth lifecycle; avoid new token extraction/copying merely to use it.

## Evidence
Official authentication docs distinguish ChatGPT subscription login from usage-based API credentials and document file, keyring, auto and ephemeral storage. Ephemeral means in-process only. https://learn.chatgpt.com/docs/auth
Official app-server documents externally managed tokens and dynamic tool calls sent to the client; these can support separated execution, but do not by themselves disable built-in tools. It also warns externalSandbox skips internal sandbox enforcement: do not use it to get around failed sandbox checks. https://learn.chatgpt.com/docs/app-server
Local 0.167.0-alpha.4, clean HOME/CODEX_HOME, --strict-config -c cli_auth_credentials_store='"ephemeral"' --print-startup-config accepted (exit 0) on 2026-11-15; no login or inference. This proves schema acceptance only, not auth storage behavior. Existing managed-probe proves 22 flags disabled, not tool inventory or full isolation. Existing mock model test stops at sandbox helper setup error; not a security pass.

## Acceptance test proposal (no real credentials)
1. Build existing pinned runtime on supported Docker host without changing host policy. Operator explicitly approves container UID/mount/capability/network settings before applying. Never privileged or host PID/network. Do not weaken internal sandbox to pass tests.
2. Run actual app-server with existing synthetic local-model harness and fake canaries; capture full announced tools and injected tool dispatch. Required: no native shell/exec/read/file-edit/browser/MCP/skill/subagent capabilities offered or executed. Reject unknown calls, fail closed.
3. Start C with distinct namespace/UID; attempt reads of dummy B auth path, B /proc/PID/environ/mem, fd inheritance and symlink escape. Verify denied/unavailable, independent from model prose. Check MP4 job outputs and event streams contain no canary.
4. Try malformed scene JSON, arbitrary command/URL/path, cross-brand IDs, and client requests for config/login/command/exec. No execution or credential reveal; legitimate storyboard-to-MP4 still works.
5. Only after passing: Jorge completes official login on valid TLS, verify ChatGPT account mode, run one small genuine turn and full video job, check usage and no API fallback. Keep publication behind approved revision/hash.

Do not set isolation-verified booleans from this proposal. Runtime restrictions and network changes remain an operator-approved deployment step. The honest immediate deliverable is the working UI + deterministic renderer; autonomous planning remains gated until actual tool isolation test passes.
