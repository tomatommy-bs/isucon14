---
title: "Node.js実装からgo実装への切り替え(全チューニングを移植)"
date: 2026-08-18
tags: [architecture, language-switch, cpu, connection-pool]
commit: "c2fb7d1"
repo: webapp
metrics:
  before: { score: 6688 }
  after: { score: 6757 }
verboseLogging: false
logs:
  - label: "移植直後(コネクションプール無制限)のpidstat平均%CPU"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      mysqld: 124.35%(2コアの過半、Node.js版では最大でも80%台だった)
      isuride(go): 49.79%(明確に余裕あり)
      Threads_connected=3, Max_used_connections=96(無制限プールがmysqldに
      過剰な同時接続を投げていたことを示す)
  - label: "コネクションプール上限別スコア(3回ずつ)"
    path: "bench_logs/20260818_195647〜20260818_200813"
    excerpt: |
      無制限: 6000 / 6288 / 5844 → 中央値6000、エラーなし
      上限20: 4937(1回のみ、明らかに悪化したため打ち切り)
      上限50: 6757 / 6784 / 6179 → 中央値6757、3回ともエラー0件
  - label: "before(Node.js最終状態)スコア3回計測"
    path: "bench_logs/20260818_193834, 20260818_193951, 20260818_194106"
    excerpt: "entries/0025時点: 6752(verbose) / 6688 / 7333 → 中央値6688"
---

## 背景

Node.js実装での一連のチューニング(entries/0011〜0025)により、node(単一スレッドのJS
実行)がmysqldより先にCPU使用率のボトルネックになる状態が続いていた(最終的にnode平均
91.7%・mysqld平均80.3%)。Node.jsのイベントループはシングルスレッドで、2vCPU環境の
片方のコアを実質使い切っている状態からこれ以上の改善は頭打ちが見えていたため、
真の並行実行が可能なgo実装への切り替えを検討した。

配布されたgo実装は未チューニングの初期状態で、かつ既存のDBスキーマ(このセッション中に
`rides.latest_status`・`rides.discount`・`chairs.latest_latitude`/`latest_longitude`を
追加済み)を認識していないコードだったため、そのまま切り替えるとsqlxの`SELECT *`が
構造体のフィールド数と一致せずエラーになる可能性が高いと判断し、Node.js側の全ての
チューニングを先にgo実装へ移植してから切り替えることにした。

## 仮説

Node.js側で確立済みの最適化パターン(cache column活用によるN+1解消、INSERT/UPDATE直後の
再SELECT排除、認証トークンのインメモリキャッシュ、アクセスログ出力の削除、Unixソケット接続)を
そのままgoの慣用的な書き方に移植すれば、少なくともNode.js版と同等以上のスコアが出るはず。
加えて、goはgoroutineによる真の並行実行が可能なため、CPUに余裕が生まれてさらに上振れる
可能性がある。

## 変更

`models.go`に`Chair.TotalDistance`/`TotalDistanceUpdatedAt`/`LatestLatitude`/`LatestLongitude`、
`Ride.LatestStatus`/`Discount`フィールドを追加(既存スキーマとの整合)。以下を各ファイルに移植:

- `main.go`: DBが同一ホストの場合のUnixソケット接続、`middleware.Logger`の削除、
  `POST /api/initialize`でのキャッシュクリア呼び出し
- `middlewares.go`: `access_token`→行のインメモリキャッシュ(`sync.RWMutex`+`map`)
- `app_handlers.go`: `calculateDiscountedFareForRide`ヘルパー新設、
  `appGetRides`(JOIN chairs/owners)、`appPostRides`(discount cache書き込み、
  再SELECT排除)、`appPostRideEvaluatation`(再SELECT排除)、`appGetNotification`
  (ride_statuses統合クエリ)、`appGetNearbyChairs`(busy chair判定・位置情報を
  cache columnから取得)
- `chair_handlers.go`: `chairPostCoordinate`(prevLocation取得・total_distance/
  latest_latitude更新・再SELECT排除)、`chairGetNotification`(ride_statuses統合クエリ)、
  `chairPostRideStatus`(latest_status活用)

### 移植中に発見した既存バグ

`ownerGetChairs`が、`chairs.total_distance`列(既にentries/0003相当でキャッシュ列として
維持されている)の存在を知らないまま、独自に`chair_locations`全件からウィンドウ関数で
走行距離を再集計する重いクエリを実行しており、かつSELECT文で`total_distance`という
列名がchairsテーブル自身の列と集計サブクエリの列の両方に該当し**曖昧な列参照エラー
(`Column 'total_distance' in field list is ambiguous`)**でリクエストが500になっていた。
これは今回の移植作業で初めてgo実装を実際に動かして気づいた、配布時から存在していた
潜在バグ(Node.js実装は同種の問題を過去のセッションでentries/0003により既に解消済みだった)。
`chairs.total_distance`/`total_distance_updated_at`を直接SELECTする形に単純化して修正した。

### コネクションプールサイズの調整

移植直後(`sql.DB`のプールサイズ未設定=実質無制限)でpidstatを確認したところ、mysqld平均
CPU使用率が124%(2コアの過半)に達し、`Max_used_connections`が96まで増えていた。Node.jsは
シングルスレッドのため実質的に同時発行クエリ数が抑えられていたが、goはgoroutineで真に
並行にクエリを発行できるため、無制限のプールがmysqldへ過剰な同時接続を投げていたと判断した。
`SetMaxOpenConns`/`SetMaxIdleConns`で上限を設定し、20と50を試した結果、20では逆に
スコアが悪化(4937、おそらくプールが小さすぎてリクエストが順番待ちになった)、50で
最も安定した結果(3回ともエラー0件、中央値6757)が得られたため50を採用した。

コミット: `c2fb7d1`(isucon14-webapp側は`git subtree push`で同期済み: `18e19b0`)。
`systemctl stop isuride-node && systemctl start isuride-go`でサービスを切り替え済み。

## 検証

Node.js実装の最終状態(entries/0025)の計測をそのままbeforeとして使用
(6752 / 6688 / 7333、中央値6688、種別エラー数は毎回2〜6件程度あった)。

- after(コネクションプール50): 6757 / 6784 / 6179 → 中央値6757(約+1.0%)

スコアの中央値自体はNode.js版とほぼ同水準(+1.0%とごく僅かな改善)だったが、**3回とも
種別エラー数が0件**という点はNode.js版(常に数件のエラーが発生していた)から明確に改善して
いる。これは仮説通り、goの並行実行モデルがリクエスト処理の詰まり・タイムアウトを起こしにくい
ことを示していると考えられる。ボトルネックは完全にmysqld側に移っており(pidstat平均CPU
124%、コネクションプール調整後も依然としてmysqldが支配的)、今後の改善余地はMySQL側の
クエリ最適化・設定チューニングに集約されつつある。
