# ElevenLabs injectable adapter (disabled by default)

`contracts.mjs` remains planning-only. New `elevenlabs-adapter.mjs` is an execution boundary with an INJECTED provider, not a concrete ElevenLabs HTTP client. No keys, network transport, environment reads or live calls are included. Nothing imports or enables it in the deployed application.

## Required injected server interfaces
- `resolveConnection(id)`: verified account/brand binding, provider='elevenlabs', expiry and permitted licensed-catalog voice IDs. Must derive from verified provider identities, not browser fields.
- `authorize(scopeHash, scope)`: lookup authenticated Jorge approval in trusted storage. Scope binds brand/job/version/text/voice/model via planHash plus account, connection and credit limit. Must show exact text, voice/account and credits to owner. Never mint approval from a browser `approved:true`.
- `ledger.reserve(key, record)`: persistent, atomic insert-only; false for any prior request. `ledger.finish(key, record)`: durable update. No mock/in-memory ledger in production. Unknown outcomes require reconciliation, not resubmission.
- `provider.convert({text,voiceId,modelId,connectionId,accountId,maxCredits,idempotencyKey})`: future authenticated transport returning audio Buffer, audio/mpeg, creditsUsed, provider requestId. Must enforce a defensible PRE-CALL upper cost bound <= approved credits, timeouts and bounded responses. Passing maxCredits does NOT make it an ElevenLabs parameter nor guarantee the remote provider enforces it. Post-call overrun validation cannot undo charges. If a safe upper bound cannot be established, refuse generation before transmission.

Enablement requires BOTH factory `enabled:true` and call `optIn:true`, verified binding and matching unexpired credit approval. User's no-paid-API instruction remains in force until separate explicit approval; this code does not authorize spending. Clones/custom voices are rejected entirely in this revision, even if a caller says authorized. Future support would require separate genuine voice-owner consent handling, not removing validation.

Result audio is not decoded here; downstream media QA must verify actual audio before accepting it. Tests intentionally return marker bytes, not an MP3, and prove orchestration only. No generated voice/audio quality or real ElevenLabs compatibility has been verified. Provider errors are redacted; uncertain execution/persistence yields unknown state. Successful synthesis does not grant publication permission.

14 total tests (7 planning + 7 injectable-adapter) pass via `node --test *.test.mjs`. No changes made to VPS, live branch, runtime connection settings, repository secrets or publishing behavior.
