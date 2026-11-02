"use client";

import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { useLineMiniApp } from "./LineMiniAppProvider";
import styles from "./recent-schedules.module.css";

export default function RecentVisit({ shareId }: { shareId: string }) {
  const mini = Boolean(useLineMiniApp());
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    setFailed(false);
    void fetch(`/api/line/recent${mini ? "?line_context=mini" : ""}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: shareId })
    }).then(response => {
      // Administrators can inspect a share without a participant LINE session.
      if (!stopped && !response.ok && response.status !== 401 && response.status !== 403) setFailed(true);
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [shareId, mini, attempt]);
  return <nav className={styles.visit} aria-label="閲覧履歴">
    <a href={mini ? "/mini/recent" : "/recent"}><History size={18} aria-hidden="true" />最近見た対戦表</a>
    {failed ? <span role="status">履歴を保存できませんでした。<button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />再試行</button></span> : null}
  </nav>;
}
