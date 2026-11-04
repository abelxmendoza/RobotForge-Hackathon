# Wrench Muse-first repair

Approved scope from the user's pasted decision: Muse-first chat, no deploy. Keep live/ unchanged and preserve explicit command preview/approval. Existing demo/account edits are separate work.

1. Add pure conversation helpers with regression tests for bounded recent user/assistant history, HTML-to-text conversion, current-message retention, natural web requests and contextual spawn handoff.
2. Ordinary signed-in conversation uses Muse before recorded lookup. Feed history through the existing message field, capped at 2,000 characters; Worker cannot accept a new history API without deployment. Preserve explicit validated commands and demo-only recorded behavior. Do not replace failed live answers with unrelated fuzzy matches.
3. Resolve “spawn it” from recent user description into a distinct new-robot design prompt. Prefill Design mode; user sends and reviews generated output before saving. No invented save or reference-robot substitution.
4. Add natural web research grounding via the existing /web service. Give no web-source claim when fetch fails.
5. Run regressions, full suite, TypeScript and build; review diff. Open a PR for only routing changes and check CI. No manual deployment or Worker changes. Assess automated deployment configuration before merge under the no-deploy constraint.

## Verification

- 873 passed, 5 skipped on latest main plus the repair. Production static build passed.
- Independent review found contextual “search for it” lost its query and spawn follow-ups lost new constraints; both fixed with regressions.
- Browser rehearsal found the composer dropped a synchronous mode handoff while busy. Deferred the prompt until submit completion; browser recheck visibly selected Design mode and prefilled the Freenove/Pi4B/two-servo/four-motor description plus “lidar and 6 wheels”. No robot was silently saved.
- Signed-in Muse responses were not live-tested; no test account session was supplied. Context payload and bounds are exercised locally. Worker prompt and limit remain unchanged.
- Both Vercel projects report automatic commit deployment statuses. Push/PR/merge is held pending clarification of the approved “no deploy” scope. No Worker changes or deployment commands were made.
