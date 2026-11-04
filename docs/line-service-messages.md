# LINE service-message prerequisite

## Status (2026-11-05)

Implementation is staged, not active for participants. The LINE Console still
shows the mini app as unverified and the production service-message feature as
unavailable. No message template was registered or submitted, no real service
message was sent, and no channel secret was read, rotated or copied.

`LINE_SERVICE_MESSAGES_REQUIRED=false` keeps existing public shares usable.
Do not enable it until the mini app AND the exact service-message usage/template
have passed review and real-device delivery tests. The simulator at
`/demo/service-message` uses fictitious data and never calls LINE.

## Requested Flow

1. Open the individual mini-app permanent link.
2. Establish a server-verified mini login and confirm friendship with `@892ixgpm`.
3. Send a service message containing that schedule's permanent link.
4. Only LINE's successful API response permits participant data reads.

This confirms API acceptance, not handset arrival, notifications being enabled,
or the participant reading the message. Sending failures do not silently unlock
the schedule. The owner/admin session remains separate and can edit as before.
Legacy web links are directed to the individual mini-app URL while this gate is
enabled; merely adding `line_context=mini` never creates an authenticated session.

## Server Controls

`LineServiceGate` prevents the viewer, image export, copy, polling and sockets
from mounting before the prerequisite completes. `worker.ts` independently gates
both share reads and realtime upgrades, including HEAD/encoded/trailing paths.

The server derives the viewer HMAC and LIFF access token from the encrypted mini
cookie. The browser sends neither a recipient nor a token, URL, title, template
or claimed delivery result. Titles come from the existing database, and links
are constructed from the configured mini-app LIFF ID and validated schedule ID.

Viewer-scoped instances of the existing `ScheduleRoom` binding serialize requests
with `blockConcurrencyWhile`. These instances use a `line-service:` name prefix
and a private internal origin; public realtime requests cannot reach the delivery
handler. No new database migration or Durable Object binding is needed.

Accepted receipts are kept for 90 days and reused for the same viewer/share.
Notification tokens are AES-GCM encrypted, tied to the channel/account, and kept
only until the verified mini session expires. Token fingerprints are SHA-256,
not raw user IDs. Alarm-based cleanup runs even after ambiguous failures.

LINE permits only one notification-token issuance per LIFF access token. That
token is reused/rotated after each successful send, up to LINE's remaining count.
A successful response with zero expiry/count is accepted as the final delivery;
the exhausted fingerprint remains until session expiry to prevent re-issuance.

Before issuing/sending, durable uncertain markers are written. Timeouts or crashes
do not unlock reads or cause automatic retries. A participant can explicitly retry
with a fresh LINE session; a rare duplicate is possible if the previous response
was lost after successful delivery. The screen warns about this. If LINE's token
quota is exhausted, close/reopen LINE rather than minting extra notification tokens
for the same access token. No notification/channel credentials are returned or logged.

## Remaining Console Work

The review screen reports missing multilingual channel details, development and
review endpoint URLs, business information (15 items), and contact information
(7 items). The operator must supply the accurate business entity and private
contact/verification details directly in LINE. Do not infer legal identity from
another app or account, accept agreements for the operator, or invent documents.

The current template catalog includes order/reservation/entry/ticket categories.
No reviewed template for this exact view-and-return request has been selected.
Do not disguise viewing a schedule as completing an order, attendance check-in,
reservation, ticket purchase or event entry. Seek LINE's confirmation of the
actual notification purpose and suitable template before submitting.

Suggested truthful usage description for consultation/review (not yet submitted):

> 利用者が主催者から受け取った共有QR・リンクで、練習会の対戦表の閲覧を要求した際、
> 同じ対戦表へ後から戻るためのリンクを初回に1件送信します。
> LINE APIの送信受付を確認後に対戦表を表示する設計です。
> 参加申込、予約、決済、出席確認の完了通知ではありません。
> 広告や別イベントの案内は含めません。この用途の可否と適切なテンプレートを確認したいです。

## Configuration After Approval

- Keep the production internal channel and LIFF IDs paired; never substitute the
  development/review IDs into the live worker just to bypass the feature restriction.
- Store the matching `LINE_MINIAPP_CHANNEL_SECRET` as a Cloudflare secret only
  after permission to connect this credential to the worker. Do not rotate it.
- `LINE_SERVICE_TEMPLATE_NAME` is the actual approved API template name, ending
  in `_ja`. No assumed template name is included in production configuration.
- `LINE_SERVICE_TEMPLATE_PARAMS` is a JSON string-to-string map matching the
  approved template. Set its actual URL field to `{{shareUrl}}`; optional title
  fields can use `{{title}}`. Those are whole-value substitutions, not arbitrary
  code or interpolated recipient data. Do not enable with fabricated field names.
- Test the development channel using an isolated local/preview worker with its
  matching development credentials. Never replace the production IDs or disable
  friendship to test. Real messages must use an appropriate template and tester.
- Test acceptance, timeout, refusal, friendship/blocking, fresh/expired sessions,
  reopening, quota exhaustion, concurrent opens, old web URLs and websocket reads.
- Only then set `LINE_SERVICE_MESSAGES_REQUIRED=true` and redeploy. Rollback is
  setting it to `false`; friendship/login requirements remain intact.

## References

- https://developers.line.biz/ja/docs/line-mini-app/develop/service-messages/
- https://developers.line.biz/ja/reference/line-mini-app/
- https://developers.line.biz/ja/docs/line-mini-app/service/service-operation/
- https://developers.line.biz/ja/docs/basics/channel-access-token/
