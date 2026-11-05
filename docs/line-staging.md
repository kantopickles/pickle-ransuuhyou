# LINE development and review environments

## Setup Status (2026-11-05)

- Business and contact information are complete in LINE Console. The operator
  entered and uploaded private information directly; do not copy it into this repo.
- English channel name/description are saved as `Kanto Pickles Draw` and an
  accurate description of the existing participant viewer.
- Both non-production LINE endpoints are connected to dedicated Workers.
- All required fields in the review checklist show complete. The application
  has NOT been submitted. The service-message template list is still empty;
  its green checklist mark is not approval of a notification template or usage.
- Notification delivery remains off in all three environments. No service
  message has been sent. Confirm the exact view-and-return purpose with LINE;
  do not describe viewing as an event entry, check-in, order or reservation.
- A review comment has been drafted in Console with the sample URL, normal
  entry flow, and the fact that the proposed notification feature is inactive.
  Verify the comment before submission; do not assume it is saved across reloads.

## Environment Map

| Use | Worker | Internal channel | LIFF ID |
| --- | --- | --- | --- |
| Development | `pickleball-randomizer-dev` | `2012345210` | `2012345210-zWCKCToM` |
| Review | `pickleball-randomizer-review` | `2012345211` | `2012345211-qarTg5SE` |
| Production (unchanged) | `pickleball-randomizer` | `2012345212` | `2012345212-6NyHtvbD` |

Development endpoint:
`https://pickleball-randomizer-dev.kanto-pickles-draw.workers.dev/mini`

Review endpoint:
`https://pickleball-randomizer-review.kanto-pickles-draw.workers.dev/mini`

Each Worker uses the same compiled application but its own matching channel
credentials, random session-encryption secret, admin credentials and Durable
Object namespace. Production login, secrets, endpoint, database, LINE menus and
notification settings were not changed during staging setup.

Development and review share ONE non-production database, `pickleball-line-staging`
(`13b82842-beb7-46cd-9374-59ccfcadab83`). It contains fictitious data only. It is
not bound to production and cannot prune the production history. Avoid changing
the fixture while LINE is reviewing it. View-history identities remain isolated
by each Worker's independently generated HMAC/encryption secret.

## Repeat Deployments

```sh
npm run build
npx wrangler deploy --config wrangler.line-dev.json
npx wrangler deploy --config wrangler.line-review.json
```

Do not use `npm run deploy` for staging: that command targets production.
Never add the production D1 binding to either staging config.

Initial staging-only database setup (already applied):

```sh
npx wrangler d1 migrations apply pickleball-line-staging --remote --config wrangler.line-dev.json
npx wrangler d1 execute pickleball-line-staging --remote --config wrangler.line-dev.json --file fixtures/line-staging.sql
```

`fixtures/line-staging.sql` inserts `LineTest01` idempotently without replacing
existing rows. Never apply the fixture to a production database.

## Secret Handling

The operator authorized connecting the two non-production channels. Their
existing matching secrets were read from the Console (not rotated), transferred
using owner-only temporary files to Cloudflare secrets, then those files were
removed. No values are in tracked configuration, docs, commits or chat output.

Each staging Worker has these secret names:

- `LINE_CHANNEL_SECRET`: its matching mini-app internal channel secret, used by
  the shared auth configuration. Web OAuth is not configured as a staging entry
  flow; use the LINE mini-app URLs below.
- `LINE_MINIAPP_CHANNEL_SECRET`: the same matching secret, reserved for future
  approved service-message tests.
- `LINE_SESSION_SECRET`: independent random value per Worker.
- `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`: independent random values;
  staging does not reuse production admin access.

Keep templates unset and `LINE_SERVICE_MESSAGES_REQUIRED=false` until there is
an appropriate approved use case/template and successful real-device testing.

## Device Test

Open through LINE, not a direct Worker `/s/` URL:

- Development: `https://miniapp.line.me/2012345210-zWCKCToM/s/LineTest01`
- Review: `https://miniapp.line.me/2012345211-qarTg5SE/s/LineTest01`

Development access is restricted by LINE channel roles; use an authorized
operator's LINE account. LINE says the review LIFF URL becomes accessible when
review starts, so inability to open that URL before submission is not by itself
an application-auth failure. Do the operator device test on the development URL.

The fixture has eight `Sample` participants and five rounds. Round 1 is checked,
so the initial jump should target round 2. Select a participant to check name and
court highlighting; reopen the mini app to check recent-view restoration. No
real notification should be expected or claimed during this test.

The normal `/mini` entry opens recent history, which is initially empty. Give
the reviewer the individual sample URL in the review comment to supply the same
entry path participants receive from the organizer.

## Verification Already Completed

- Full automated suite: 109 passing tests; TypeScript and production build pass.
- Staging configs match internal channel IDs and LIFF IDs, and exclude production D1.
- LINE accepted stateless-token requests for both matching channel credentials
  (HTTP 200). Returned credentials were neither logged nor persisted.
- Both public config endpoints report the correct LIFF ID and `@892ixgpm`.
- Anonymous share reads return 401; malformed mini-session requests return 400.
- Authenticated staging-admin reads see only the eight-person/five-round fixture.
- Both service prerequisite endpoints return `disabled`.
- Remaining: operator device login/friendship/view tests, exact notification-purpose
  and template confirmation, real notification tests, and explicit submission approval.

## Official References

- https://developers.line.biz/ja/docs/line-mini-app/submit/submission-guide/
- https://developers.line.biz/ja/docs/line-mini-app/develop/service-messages/
- https://developers.line.biz/ja/reference/line-mini-app/
