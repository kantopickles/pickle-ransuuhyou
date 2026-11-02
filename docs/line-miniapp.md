# LINE mini app and participant viewer

## Implemented

- Optional participant selection highlights that person's name and court, including
  resting or not-participating states. The selection is stored per share on the
  device; it is display-only and does not prove identity or grant editing rights.
- Initial entry jumps once to the first unchecked match (or last match when all
  are complete). Explicit URL fragments and user interaction take priority.
  Live updates update the current indicator without moving the reader's scroll.
- Per-LINE-account view history is stored in D1, maximum ten entries. The server
  verifies LINE identity, then HMACs the user ID. No raw user ID, display name,
  profile picture, player selection or access token is stored in the history.
- `/recent` lists history. `/resume` opens the latest surviving share automatically.
- `/mini` does the same using LIFF. `/mini/recent` lists mini-app history;
  `/mini/s/{shareId}` displays an individual schedule.
- Mini and ordinary web authentication use separate encrypted HttpOnly cookies.
  Browser-supplied profile IDs are never trusted. Mini tokens are verified with
  LINE for the configured internal channel, expiry and profile scope; actual
  friendship is checked before any schedule or history can be read.
- The official-account return URL remains `/resume`. Once mini sharing is enabled,
  it redirects to the mini-app entry. No individual user's share ID is placed in
  the official account's common menu or reply.

## Production Connection Status (2026-11-03)

The operator created `関東ピックルズ対戦表` and accepted the platform agreements.
The production internal channel is `2012345212`, with LIFF ID
`2012345212-6NyHtvbD`. Its endpoint is the production `/mini` URL. The default
official account is linked to `@892ixgpm`, with friend-add `On (normal)` and the
existing `openid, profile` scopes. Privacy and terms URLs are configured.

The operator confirmed that the production mini link opens the schedule in
smartphone LINE. Mini sharing is enabled: newly issued participant links and QR
codes use the production mini permanent link. Existing web share links remain
valid. This confirms the initial launch only, not the full device/auth matrix
listed below.

The operator deferred the official-account return feature. Do not add a return
entry to the rich menu, link collection, greeting or automatic replies. Existing
menus and message delivery settings remain unchanged. The implemented history
routes remain available within the app, but no official-account entry is added.

## LINE Console Setup Checklist

Provider: `関東ピックルズ` (2005657811). Link the mini app to official account
`@892ixgpm`, not the other similarly named official account.

1. Create the LINE mini-app channel. Proposed name: `関東ピックルズ対戦表`.
   The operator must personally review and accept the platform agreements and
   country/authority declarations. The agent must not accept those on their behalf.
2. In web-app settings, set the endpoint URL to:
   `https://pickleball-randomizer.kanto-pickles-draw.workers.dev/mini`.
   Use the correct internal app's LIFF ID; do not mix development/review/production IDs.
3. Enable `profile` and `openid` scopes and the friend-add option. Link the default
   official account to `@892ixgpm` in the same provider.
4. Use the PRODUCTION internal channel ID and LIFF ID for the production worker.
   No mini-app channel secret or Messaging API access token is required by this
   implementation. Do not paste secrets into chat or commit them to Git.
5. Set privacy URL to `/privacy` and terms URL to `/terms` on the app's HTTPS origin.
   Review these pages for the actual operator's requirements before certification.
6. Configure `LINE_MINIAPP_CHANNEL_ID` and `LINE_MINIAPP_LIFF_ID` in worker vars.
   Keep `LINE_MINIAPP_SHARE_ENABLED` unset or false for the initial connection test.
   Existing OAuth vars and the session encryption secret must remain unchanged.
7. Test the PRODUCTION mini URL on actual iOS/Android LINE: friend/nonfriend,
   block/unblock, fresh launch, expired/revoked token, independent web login,
   selecting a participant, progress updates and reopening the latest share.
8. Only after successful testing set `LINE_MINIAPP_SHARE_ENABLED=true` and deploy.
   New share links/QR codes then use the mini permanent link. Existing `/s/` links
   continue to work in the web viewer.
9. Official-account return entry is deferred by the operator (2026-11-03).
   Do not change the menu, link collection or replies to add `/resume` unless
   the operator requests it again.

Unauthenticated mini apps may be published with limited features. Certification
and any acceptance by LINE are separate external processes; this implementation
does not claim approval or guarantee that the friend-only design passes review.
Do not silently remove the required-friend condition to obtain approval.

## Database and Retention

`0002_line_view_history.sql` adds a separate history table and cascade foreign key;
it does not modify or delete existing schedules. Each viewer's history is limited
to ten entries. Entries over 90 days old are filtered from reads and removed in
background work after a successful history request. No extra cron trigger is
allocated: the account's Workers Free cron quota was already full. Inactive data
may remain stored until the next history request. Deleting one's history never deletes a schedule or
another person's history.

## Authentication Lifecycle

Fresh mini launches establish a new mini session because LIFF access tokens can
be revoked when its browser closes. External-browser reconnect clears the stale
SDK token before login. In-client reconnect re-enters through the mini-app URL.
As in the existing web gate, friendship is cached for at most five minutes; closing
LIFF or revoking a token does not promise instantaneous server-cookie invalidation.
The official LINE SDK manages its own browser credentials; app code does not copy
them to app-managed localStorage or URLs.

## Verification and Known Follow-Up

Unit tests cover viewer selection/roster changes, current-match selection,
audience/scope/expiry/friend checks, isolated cookies, bounded streamed requests,
history identity/isolation, ten-item pruning, retention and cascading deletion.
Test fixtures are local only; no production test schedules are created because
the existing global ten-schedule limit could remove an organizer's older schedule.

Installing the LINE SDK surfaced existing dependency audit advisories in the base
Next/vinext/Cloudflare toolchain, not in `@line/liff`. A separate dependency update
and compatibility pass is still needed; do not run an unreviewed broad audit fix
as part of mini-app activation.

## Official References

- https://developers.line.biz/ja/docs/line-mini-app/develop/web-to-mini-app/
- https://developers.line.biz/ja/docs/line-mini-app/discover/console-guide/
- https://developers.line.biz/ja/docs/liff/using-user-profile/
- https://developers.line.biz/ja/docs/line-mini-app/service/add-friend-option/
- https://developers.line.biz/ja/docs/line-mini-app/develop/permanent-links/
