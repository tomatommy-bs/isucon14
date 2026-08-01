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
    // 対象リポジトリ名(例: webapp, nginx, mysql)。複数リポジトリを横断管理する場合に区別する
    repo: z.string().optional(),
    // 自由形式のkey-value。グラフ化には metrics.after.score を用いる想定(AGENTS.md参照)
    metrics: z
      .object({
        before: z.record(z.string(), z.number()).optional(),
        after: z.record(z.string(), z.number()).optional(),
      })
      .optional(),
    // ベンチマーク/メトリクスログへの相対パス参照(ログ本体はコピーしない)
    logs: z
      .array(
        z.object({
          label: z.string(),
          path: z.string(),
        }),
      )
      .default([]),
  }),
});

export const collections = { entries };
