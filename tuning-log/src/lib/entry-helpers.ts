type MetricsLike = {
  metrics?: {
    before?: Record<string, number>;
    after?: Record<string, number>;
  };
};

export function beforeScore(entry: MetricsLike): number | undefined {
  return entry.metrics?.before?.score;
}

export function afterScore(entry: MetricsLike): number | undefined {
  return entry.metrics?.after?.score;
}

/** スコアが変更前より下がった(または変わらなかった)エントリを検出する。効果なし/逆効果の目印用。 */
export function isRegression(entry: MetricsLike): boolean {
  const before = beforeScore(entry);
  const after = afterScore(entry);
  if (before == null || after == null) return false;
  return after <= before;
}
