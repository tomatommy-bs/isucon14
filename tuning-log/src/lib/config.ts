import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type TuningLogConfig = {
  repos?: Record<string, string>;
};

// プロジェクトルート直下の tuning-log.config.json を読む。存在しなければ空設定として扱う(必須ではない)。
// 注意: import.meta.url基準の相対パスは使わないこと。Astro/Viteのビルド時に
// バンドル後のモジュールがdist/配下等へ再配置され、意図したパスに解決されない。
const configPath = path.join(process.cwd(), "tuning-log.config.json");

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
