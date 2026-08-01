import type { TuningLogConfig } from "./config";

type CommitLinkInput = {
  commit?: string;
  commitUrl?: string;
  repo?: string;
};

/**
 * コミットへのリンクURLを解決する。優先順位:
 * 1. frontmatterの commitUrl (完全指定)
 * 2. tuning-log.config.json の repos[repo] + "/commit/" + commit
 * どちらも無ければ undefined (呼び出し側はプレーンテキスト表示にフォールバックする)
 */
export function resolveCommitUrl(
  entry: CommitLinkInput,
  config: TuningLogConfig,
): string | undefined {
  if (entry.commitUrl) return entry.commitUrl;
  if (!entry.commit || !entry.repo) return undefined;
  const base = config.repos?.[entry.repo];
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/commit/${entry.commit}`;
}
