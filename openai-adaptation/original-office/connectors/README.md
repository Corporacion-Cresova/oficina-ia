# Future connector contracts — planning only

These modules deliberately cannot connect, generate speech, upload, publish, schedule, authenticate, receive secrets or spend credits. They are not finished connectors and must not be presented as such. Seven offline tests pass. No actual account, voice, API response, media generation or publication was tested. No API requests or VPS changes occurred.

## Integration boundary
- Import these functions only into planning/UI review logic, not the current render adapter. `executionEnabled` remains false even when an approval matches.
- Never regard `voiceUseAuthorized`, `artifactReviewed`, or a supplied approval object as authenticated evidence. Resolve them from server-trusted records established through the authenticated owner UI. `approvalMatches` is a comparison helper, not signature/authentication verification.
- Bind accounts to each brand after provider identity lookup. A user-written account ID is not proof of ownership. No credentials belong in these DTOs, prompts, browser localStorage or repository.
- Provider transport is absent. Later an adapter must add approved OAuth/secret storage, TLS verification, exact brand/account binding and scope checks, durable submission ledger, provider status reconciliation and capability-specific UI review. Never blindly retry a timeout after upload/post initiation.
- Voice generation remains off under the no-paid-API requirement. Do not infer provider credits, pricing, API entitlement or consent from a ChatGPT/ElevenLabs subscription. If the owner separately chooses ElevenLabs generation, show the exact text, selected licensed voice, cost/credits and consent before implementing/executing it. No cloning/custom voice endpoint exists here.
- Per-video approval of a finished artifact does not approve publishing. Publication requires approval of that version/hash, caption, exact account, platform, visibility and date/time. Edits invalidate the match. Cross-brand approval is invalid.
- Technical demo renders are never accepted as production media. Production eligibility is a server-verifiable review decision, not a browser checkbox.
- The connectors installed in this ChatGPT conversation are not automatically installed or authenticated on the deployed VPS.

## Connection checklist for later
1. TLS and owner authentication verified, then provider connection started by owner through a supported secure flow.
2. Read provider identity and capabilities. Show destination account and brand. No upload while merely validating connection.
3. Speech: verify licensed voice selection/provenance and any spend authorization; do not clone a voice.
4. Social: obtain appropriate publishing capabilities for selected login flow. Query current account restrictions/visibility options before presenting review. Keep FB Page, IG professional profile and TikTok identity distinct. A caption mention is not an IG collaboration invitation.
5. Let owner preview actual final video/caption and approve destination and time. Record immutable approval and submission states durably before sending.
6. Verify provider's final publication status before claiming it published; distinguish upload, processing, pending approval and published.

## Official references checked 2026-11-15
- ElevenLabs Create speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert — generation selects a voice ID; actual credentials and entitlement are a separate integration requirement.
- ElevenLabs overview: https://elevenlabs.io/docs/overview/intro — external API usage is distinct from local planning.
- TikTok Direct Post setup: https://developers.tiktok.com/doc/en/content-posting-api-get-started/ (documentation also served at https://developers.tiktok.com/docs/en/content-posting-api-get-started). Requires registered app and target user's video.publish grant.
- TikTok sharing guidelines: https://developers.tiktok.com/docs/en/content-sharing-guidelines — explicit consent before upload and editable preset title/hashtags.
- TikTok status: https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status — processing/terminal status and non-retry failures must be respected.
- Meta official Postman documentation: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api — Instagram publishing route/permissions depend on selected login flow. Do not hardcode a scope recipe before the actual integration is chosen.

Provider docs do not grant task permission. Planning contracts intentionally do not encode arbitrary provider HTTP endpoints or accept access tokens.

Run: `node --test contracts.test.mjs`
