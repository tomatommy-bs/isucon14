#!/usr/bin/env bash
# モノレポ側での変更(GitHub Web UIでの編集やPRマージ等)を、各単体リポジトリへ送る。
# サーバー上で `git pull origin master` すれば実ファイルに反映される。
set -eu
cd "$(dirname "$0")/.."

echo "=== git subtree push --prefix=etc etc-src master ==="
git subtree push --prefix=etc etc-src master

echo "=== git subtree push --prefix=home/isucon/webapp webapp-src master ==="
git subtree push --prefix=home/isucon/webapp webapp-src master

echo "=== 完了 ==="
echo "サーバー上で 'git pull origin master' すれば反映されます"
echo "  /etc                   -> git pull origin master (要sudo)"
echo "  /home/isucon/webapp    -> git pull origin master (isuconユーザーで)"
