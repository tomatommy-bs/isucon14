#!/usr/bin/env bash
# 各単体リポジトリ(isucon14-etc, isucon14-webapp)の最新をモノレポへ取り込み、pushする。
# サーバー上で直接コミット・pushされた変更をモノレポ側に反映したいときに実行する。
set -eu
cd "$(dirname "$0")/.."

echo "=== etc-src の最新を取得 ==="
git fetch etc-src master
echo "=== git subtree pull --prefix=etc etc-src master ==="
git subtree pull --prefix=etc etc-src master -m "sync: etc-srcの最新を取り込み"

echo "=== webapp-src の最新を取得 ==="
git fetch webapp-src master
echo "=== git subtree pull --prefix=home/isucon/webapp webapp-src master ==="
git subtree pull --prefix=home/isucon/webapp webapp-src master -m "sync: webapp-srcの最新を取り込み"

echo "=== モノレポをpush ==="
git push origin main

echo "=== 完了 ==="
