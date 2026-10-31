# LINE login recovery

## Observed defect

A reported Android screenshot displayed both a successful connection test and a
login-expiration error. The callback used one shared flow cookie for all login
attempts. Missing, mismatched, or expired flow cookies all redirected to
`/line-access` with the same expiration message, losing the original share URL.
The gate kept that URL error even when the current server status was allowed.

The screenshot alone does not establish why those particular devices lost or
replayed the login context. Browser/app handoff and overlapping login attempts
are scenarios covered by the recovery changes, not confirmed device diagnoses.

## Changes

- Each login attempt has an independently named, encrypted, HttpOnly flow cookie.
- OAuth state includes an authenticated, short-lived navigation context, encoded
  as alphanumeric hex as required by LINE. It contains only a safe local return
  path and expiration, never a PKCE verifier or access token.
- Missing browser cookies cannot authorize or exchange a code. They can only
  recover the intended share URL and offer a fresh cookie-bound login.
- The recovery login disables LINE app auto-login to reduce another browser
  handoff; ordinary login remains unchanged.
- Existing authenticated sessions and legacy in-flight flow cookies remain valid.
- Server-verified access supersedes obsolete callback errors. Overlapping status
  requests cannot restore an older result after a newer one completes.
- A local navigation hint helps the legacy fallback page offer a return button.
  That hint is not an authentication credential and cannot bypass any access gate.
- The fallback page no longer strands participants on a connection-test message.

## Verification

- 59 unit/regression tests pass, including missing-cookie, parallel-login,
  tampered-state, callback-replay, and stale-UI-error cases.
- TypeScript type checking and the production Workers build pass.
- Production missing-cookie callbacks preserve the share path without issuing a
  session; unauthenticated share reads still return 401.
- A real LINE login in desktop Chrome succeeds after deployment.
- Smartphone-width rendering has no horizontal overflow or stale error alert.
- The affected Android devices still require a real-world retry to confirm the
  original report is resolved for those users.

No schedule data, official-account settings, secrets, or friend-only restrictions
were changed.
