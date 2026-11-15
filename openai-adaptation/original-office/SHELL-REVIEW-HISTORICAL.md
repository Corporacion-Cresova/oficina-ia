# Historical shell-only review; see README.md for current integrated behavior

# Local review build, not deployed

Prepared against original source commit273a9ad. Original backend/source untouched. This draft preserves original HTML, both stylesheets, OfficeHQ renderer and sprites, but replaces the operational frontend bootstrap with a capability-limited driver. It is NOT the whole original app operating under OpenAI.

Implemented: original visual architecture, rooms and character canvas; original navigation and chat drawer; explicit disabled states; authenticated config/state/capability read endpoints; a single finite SSE snapshot for contract testing. No long-lived stream/reconnect contract yet; bootstrap does not open EventSource. All writes503, all unknown assets404. No original app import, no background tasks, no paid model. Credentials remain deployment input, never included.

UI limitations: operational panel contents retained in DOM but hidden until individually integrated; controls disabled. Ambient original animation remains but banner explicitly says it is not agent work. Original Cresova references remain inside preserved unavailable contents, not rebound to Jorge data. Fonts external request removed; final font match requires authorized local font assets. Test suite confirms original CSS and sprites byte-for-byte, but screenshots/mobile rendering not yet verified. No claim of visual QA.

An explicit start.mjs and Dockerfile are now prepared locally. They ship no model binaries, dependencies or original backend. Context is this directory, port3000, UID1000; OFFICE_PASSWORD (>=16) and exact HTTPS OFFICE_ORIGIN are required privately. No writes are enabled, so there is no data persistence yet; preserve the existing data volume untouched, do not migrate or discard it. Base image version is pinned but digest/build/scan remain unverified. It must not replace deployment automatically: complete visual QA and coordinate autoDeploy with root before any ref update.

Tests: `node --test test.mjs` =>7/7. Preservation assertions now use a portable SHA256 manifest of original assets. Node HTTP and configuration checks are real; no real auth account/inference used. Original14 display agents are statically extracted scalar metadata, not active agents. Cost null means unknown/unconnected, not0.

Next: approved original-compatible persistent tasks and genuine first ChatGPT drawer using existing isolated app-server bridge. Real owner login is still needed; backend original services cannot simply be turned on.

Visual QA attempted: Chromium aborted on about:blank with process_singleton socket() Operation not permitted. No sandbox bypass attempted. No screenshot exists. Docker unavailable, therefore no actual image build claimed. UI source and HTTP tests are not visual acceptance.

Audit correction: all OfficeHQ characters including DEV_PEOPLE start unavailable; inactive desks no longer show processing bars. Operational Diego identity and L100,000 goal removed. OfficeHQ now has three targeted status-rendering edits, so its original hash is provenance, not equality assertion.7/7 tests include executing drawDesk for idle/unavailable/working.

Independent static audit confirmed all four corrections including visible configuration-load failure.7 tests executed successfully. Original OfficeHQ visual design retained with deliberate status-rendering adaptations; not byte-identical.
