# First incomplete release: manual workspace only

This is **not** the completed autonomous office. It stores internal tasks, lets the owner mark completion/cancellation, and shows a prominent no-AI warning. No model, Claude SDK, paid API, connector, scheduler, MCP, repository access or Codex credentials are shipped. `/api/status` reports `functionalOffice:false`. `/health` is liveness only, not an authentication/persistence/model check.

## Build and source
- Repository `coden-creator/oficina-ia`, branch `junie/openai-adaptation`; deploy a reviewed immutable commit.
- Build context / Git build path: `openai-adaptation`.
- Dockerfile relative to context: `Dockerfile.manual` (NOT root Dockerfile).
- Example: `docker build -f openai-adaptation/Dockerfile.manual -t oficina-manual:reviewed openai-adaptation`.
- Official image version pinned to Node 22.16.0, **not immutable digest**. Before deployment resolve/record current official image digest and vulnerability scan; update base version deliberately if needed. No npm install and no runtime downloads.
- No Docker daemon exists in the preparation workspace: actual image build and container execution remain deployment validation steps. Node process/HTTP tests are independent of that missing evidence.

## Required private deployment values
- `OFFICE_PASSWORD`: unique strong random password, at least 16 characters; enter via private service secret/environment field, never Git, chat, image build args or logs. HTTP Basic username is `jorge`. One shared operator identity, not multi-user role management.
- `OFFICE_ORIGIN`: exact public HTTPS origin, e.g. `https://office.example.com`, no path/query/credentials. Proxy must preserve Host.
- `OFFICE_DATA_DIR=/data`, `HOST=0.0.0.0`, `PORT=3000`.
- Proxy target HTTP port **3000**, terminate TLS at proxy; do not expose container port publicly without TLS.
- Do not set model API credentials or `OFFICE_ENABLE_CHATGPT_DRAFTS=1`. This entrypoint refuses them; there is no automatic paid or demo fallback.

## Persistence, isolation, resources
- Mount a dedicated persistent named volume at `/data`, owned by UID/GID1000 and writable by that user. Empty Docker named volumes may inherit image directory ownership; verify, do not assume. Never mount host root, Docker socket, other services' volumes or user credentials.
- One replica only: JSON persistence is atomic but is not a multi-writer database. Back up the volume before changes; verify restore separately. Never discard the volume when replacing the image.
- Set a small initial limit, **1 CPU and 512 MiB**, reservation if desired 128 MiB, below the project total ceiling. Total allocated usage across project must also remain within min(5 CPU,70% host CPU) and min(20 GiB,70% host RAM). Existing assignments count. Limits must be set and verified in actual service/container configuration; Dockerfile cannot enforce them.
- If supported, read-only root filesystem with writable `/data`, drop all capabilities, no-new-privileges, pids limit128 and egress denied (no outgoing connectivity needed). Apply network/security changes only with required approval. No host network/privileged mode.
- Authentication is simple BasicAuth, no MFA or rate limiter in this release. Use a restricted HTTPS proxy and rate limiting/access allowlist where authorized. Do not use for sensitive customer records yet. Avoid credential-bearing URLs.

## Release gates
1. Build image, confirm it contains only manual files and no credentials/model binaries.
2. Confirm source commit, process `node server-manual-production.mjs`, UID1000, limits, volume, proxy3000 and HTTPS certificate.
3. Without auth: `/` and `/api/tasks` must401; `/health` may200 without data. Wrong Host with auth must403.
4. With private auth: UI/status accessible and explicitly manual/no inference. Create a synthetic task, restart, verify task retained; delete only the synthetic test after product deletion is supported or mark it cancelled. Do not invent successful restart evidence.
5. `/api/assistant/draft` must503. No outgoing actions/model usage. Check logs contain no secrets.
6. Test interface visually on desktop/mobile, record deployed image digest and commit. Health green alone is not readiness.

Rollback: retain prior service config/image and volume snapshot, redeploy previous reviewed manual image if needed; do not restore over newer records without reconciliation. Adding AI is a separate reviewed release and requires official owner login and host isolation validation.
