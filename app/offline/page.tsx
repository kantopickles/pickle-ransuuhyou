export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section className="offline-panel">
        <img
          className="offline-icon"
          src="/icon-192x192.png"
          alt=""
          width="96"
          height="96"
        />
        <h1>インターネットに接続できません</h1>
        <p>通信状態を確認してから、もう一度お試しください。</p>
        <a className="offline-retry" href="/">再読み込み</a>
      </section>
    </main>
  );
}
