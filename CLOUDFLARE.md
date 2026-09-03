# Cloudflare運用メモ

このアプリは、画面・API・データ保存・リアルタイム更新をCloudflareだけで動かします。

- 公開先: `https://pickleball-randomizer.kanto-pickles-draw.workers.dev`
- データ保存: Cloudflare D1 `pickleball-randomizer`
- リアルタイム更新: Cloudflare Durable Objects / WebSocket
- 保存件数: 新しいものから10件
- PWA: iPhone・Androidのホーム画面へ追加可能

## スマホへ追加する方法

- iPhone: Safariで開き、共有ボタンから「ホーム画面に追加」を選びます。
- Android: Chromeで開き、メニューから「アプリをインストール」または「ホーム画面に追加」を選びます。

インストール後も同じCloudflare版へ接続します。アプリを更新するときは、通常どおりCloudflareへ公開すれば次回起動時に新しい版が取得されます。

## 普段の更新方法

1. このフォルダで変更内容を確認します。
2. `npm run build` で公開前の確認をします。
3. `npm run deploy` でCloudflareへ公開します。
4. 公開先をスマホで開き、乱数表の作成と共有ページを確認します。

GitHubへ保存する場合は、Cloudflareへの公開後にGitHub Desktopからコミットしてプッシュします。

## 初回だけ必要な設定

データベースを新しく作り直した場合は、次を実行して表を準備します。

```sh
npm run cf:migrate:remote
```

Cloudflareの管理画面またはWranglerから、次の2つをWorkerの秘密情報として登録します。

- `ADMIN_PASSWORD`: 管理画面へ入るためのパスワード
- `ADMIN_SESSION_SECRET`: ログイン状態を安全に保つための長いランダム文字列

これらの値はGitHubへ書き込まないでください。

## バックアップ

Cloudflare上のデータをSQLファイルへ保存できます。

```sh
npx wrangler d1 export pickleball-randomizer --remote --output backup.sql
```

`backup.sql`には参加者名や対戦表が含まれるため、公開場所へ置かないでください。

## 旧サービスの状態

2026年9月4日に、旧Supabase環境とVercelの `pickle-ransuuhyou` プロジェクトを削除しました。このアプリの稼働先はCloudflareだけです。

以前配った `pickle-ransuuhyou.vercel.app` の共有リンクとQRコードは開けません。今後はCloudflare版で発行したリンクを使用してください。

## 障害時の確認

```sh
npx wrangler deployments list --name pickleball-randomizer
npx wrangler d1 execute pickleball-randomizer --remote --command "SELECT COUNT(*) FROM pickleball_shared_schedules;"
```

1つ目は公開履歴、2つ目は保存件数を確認します。
