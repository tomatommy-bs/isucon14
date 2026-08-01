import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type TuningLogConfig = {
  repos?: Record<string, string>;
};

// プロジェクトルート直下の tuning-log.config.json を読む。存在しなければ空設定として扱う(必須ではない)。
const configPath = fileURLToPath(
  new URL("../../tuning-log.config.json", import.meta.url),
);

export function loadConfig(): TuningLogConfig {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.warn(`tuning-log.config.json の読み込みに失敗しました: ${e}`);
    return {};
  }
}
