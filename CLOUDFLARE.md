# Cloudflare運用メモ

このアプリは、画面・API・データ保存・リアルタイム更新をCloudflareだけで動かします。

- 公開先: `https://pickleball-randomizer.kanto-pickles-draw.workers.dev`
- データ保存: Cloudflare D1 `pickleball-randomizer`
- リアルタイム更新: Cloudflare Durable Objects / WebSocket
- 保存件数: 新しいものから10件

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

## 旧サービスを停止する前の注意

以前配った `pickle-ransuuhyou.vercel.app` の共有リンクは、Vercelを削除すると開けなくなります。Cloudflareには同じIDのデータを移してありますが、リンクのドメイン部分は自動では変わりません。

旧リンクを今後も開けるようにするには、独自ドメインをCloudflareへ接続してから切り替える方法が確実です。過去のQRコードが不要だと確認できるまでは、VercelとSupabaseのプロジェクトを削除しないでください。

## 障害時の確認

```sh
npx wrangler deployments list --name pickleball-randomizer
npx wrangler d1 execute pickleball-randomizer --remote --command "SELECT COUNT(*) FROM pickleball_shared_schedules;"
```

1つ目は公開履歴、2つ目は保存件数を確認します。
