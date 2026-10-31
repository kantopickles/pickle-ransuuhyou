import type { LineAccessState } from "./line-access";

export const PENDING_LINE_SHARE = "pickleball-line-pending-share";

export function lineRecoveryReturnTo(returnTo: string, remembered: string | null) {
  return returnTo === "/line-access" && remembered && /^\/s\/[A-Za-z0-9]{6,20}$/.test(remembered)
    ? remembered : returnTo;
}

export function lineCallbackMessage(reason: string | null, access?: LineAccessState) {
  // A callback can be replayed by Back/reload even after login succeeded. The
  // current server-verified status takes precedence over an old URL error.
  if (!reason || access === "allowed" || access === "friend_required") return "";
  if (reason === "cancelled") return "ログインがキャンセルされました。対戦表を見るにはLINEでログインしてください。";
  if (reason === "browser") return "ログインを始めたブラウザと戻り先が変わったか、ログイン確認用のCookieを引き継げませんでした。下のボタンから、このブラウザでもう一度ログインしてください。友だち登録をやり直す必要はありません。";
  if (reason === "session") return "ログイン手続きを確認できませんでした。時間が経ったか、別のタブやブラウザで開いた可能性があります。下のボタンからもう一度ログインしてください。";
  return "LINEとの接続に失敗しました。もう一度ログインしてください。";
}
