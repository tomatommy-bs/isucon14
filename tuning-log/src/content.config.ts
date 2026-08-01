import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const entries = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./entries" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    // このチューニング変更を行ったコミットのハッシュ(短縮形でも可)
    commit: z.string().optional(),
    // commitへの完全なURL。指定があれば tuning-log.config.json の repo マッピングより優先される
    commitUrl: z.string().url().optional(),
    // 対象リポジトリ名(例: webapp, nginx, mysql)。複数リポジトリを横断管理する場合に区別する。
    // tuning-log.config.json の repos に同名エントリがあれば commit へのリンクを自動生成する
    repo: z.string().optional(),
    // 自由形式のkey-value。グラフ化には metrics.after.score を用いる想定(AGENTS.md参照)
    metrics: z
      .object({
        before: z.record(z.string(), z.number()).optional(),
        after: z.record(z.string(), z.number()).optional(),
      })
      .optional(),
    // この計測(主にmetrics.afterの値)を取ったとき、MySQLスロークエリログ等の詳細ログが
    // 有効だったかどうか。有効だとログ書き込み自体のI/Oオーバーヘッドでスコアが変動しうるため、
    // 他の計測結果と単純比較してよいかの判断材料になる(run_bench_2tier.shの-vフラグに対応)
    verboseLogging: z.boolean().optional(),
    // ベンチマーク/メトリクスログへの参照(ログ本体はコピーしない)
    logs: z
      .array(
        z.object({
          label: z.string(),
          // 相対パス(サーバー上の実際の場所を示すドキュメント目的の参照)か、http(s)のURL
          path: z.string(),
          // 任意。ログの要点を短く貼り付けておける(pt-query-digestの上位数件など)
          excerpt: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

export const collections = { entries };
