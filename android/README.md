# ドパガキガード Android 試作版

日本語のネイティブAndroidアプリ。Android 11以上。
**このフォルダーは試作用のソースです。APKは別配布。実機動作とGradle統合ビルドは未検証です。**

## できるように実装したこと
- ホーム画面から起動できるアプリを選び、全選択アプリ共通の1日30分（初期値）の目安を設定。
- 利用アクセスを本人がOS設定で許可してからUsageEventsを参照。未許可は「0分」と扱わない。
- 現在の端末タイムゾーンの0時からの時間を推定し、合計・残り・到達表示。選択変更は今日の履歴に遡って再計算。
- 複数アクティビティ／分割画面の同時利用は時間の和集合として集計し、重複加算しない。
- 画面表示中は10秒ごとに更新。任意の通知をONにするとJobSchedulerで15分以上の間隔で確認。1日1回まで。
- 設定とアプリ選択だけを端末内保存。利用履歴そのものは保存しない。インターネット権限・広告・アカウント・外部送信なし。バックアップ無効。

## 制限（重要）
**他のアプリを強制的に停止・ブロックする機能はありません。** 利用目安を表示・通知する試作版です。動画再生時間だけの計測でもありません。
公開SDKで取得できるパッケージ名とアクティビティのクラス名で対応付けます。同一クラスの複数インスタンスは区別できません。OSのイベント欠落、記録の遅延、アクティビティや端末固有の動作によって過大／過小推定になり得ます。過去24時間の前日イベントで日付を跨ぐセッションを補いますが、記録がないケースは復元できません。
端末の時計・タイムゾーン変更で日付と計測範囲も変わります。改ざん防止機能ではありません。
定期確認は省電力・Doze・強制停止などで遅れたり停止します。即時の到達検知は保証しません。再起動後はアプリを開いて再登録してください。通知を拒否／無効にすると通知できません。
Accessibility、Device Admin、全パッケージ参照、オーバーレイ、正確なアラーム、バックグラウンド画面起動は利用しません。

## ビルド
Googleの公式Android Studio / SDKと公式Gradleを用いること。SDK 35の公式公開APIスタブに対するJava全ソースのコンパイルは確認済みです。Gradle/SDK全体を使ったAPK生成は未実施です。
構成は互換性を固定した AGP 8.7.3 / Gradle 8.9 / JDK 17 / compileSdk・targetSdk 35。最新であるという主張ではありません。
1. Android Studioでこのフォルダーを開く。SDK Platform 35、Build Tools 34.0.0、Gradle 8.9を公式配布元から準備。
2. ローカルSDKの場所をAndroid Studioで指定（`local.properties` は共有しない）。
3. Gradle 8.9がある環境で `gradle :app:assembleDebug :app:lintDebug` を実行。
4. 出力予定: `app/build/outputs/apk/debug/app-debug.apk`。
Gradle Wrapperのjarは同梱していません。必要なら公式Gradle 8.9で `gradle wrapper --gradle-version 8.9` を生成してください。
ストア公開、端末へのインストール、権限付与はこの成果物では実施していません。

## 実行済み検証
`./test.sh`（JDKのcompilerモジュール必要）: 純Javaの時間計算を21条件で確認、PASS。
共有枠、同時利用の和集合、重複resume、関係ないpause、非選択アプリ、画面OFF、日跨ぎ、進行中セッション、未来イベント、残りゼロ、通知の日別重複抑止、東京0時、夏時間の日付境界を含む。
また、公式 Android SDK 35 公開APIスタブに対する Java 全ソースのコンパイルを確認。これは Gradle 統合ビルド、通知動作、画面検証の代わりにはなりません。

## 次の必須検証
- SDKビルドとLint、Android 11 / 13 / 15以降の許可・拒否画面、edge-to-edge。
- 実際のアプリ切替・分割画面・画面OFF・再起動・日付跨ぎ・利用権限撤回。
- 通知拒否、チャネルOFF、15分以上待機、省電力、同日のUIとジョブの同時チェック。
- 観測値とOSの実際の利用状況の比較。個人の履歴や画面を公開しない。

## 公式資料（2026-11-15参照）
- https://developer.android.com/reference/android/app/usage/UsageStatsManager
- https://developer.android.com/training/package-visibility/declaring
- https://developer.android.com/develop/ui/views/notifications/notification-permission
- https://developer.android.com/reference/android/app/job/JobInfo.Builder
- https://developer.android.com/guide/topics/large-screens/multi-window-mode-and-multi-resume
- https://developer.android.com/build/releases/agp-8-7-0-release-notes
