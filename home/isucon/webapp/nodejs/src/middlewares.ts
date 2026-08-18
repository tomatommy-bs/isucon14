import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { RowDataPacket } from "mysql2/promise";
import type { Environment } from "./types/hono.js";
import type { Chair, Owner, User } from "./types/models.js";

// access_tokenからuser/chair/owner行へのインメモリキャッシュ。
// 各テーブルのid/access_token/username等の識別情報は作成後どのコードパスからも
// 更新されない(usersテーブルへのUPDATEは存在しない。chairsで変化するis_activeは
// 認証結果からは参照されない)ため、一度引いた行は安全にキャッシュしてよい。
// POST /api/initialize でDBがリセットされるため、そのタイミングで必ずclearする
// (main.tsのpostInitializeから呼ばれる)。
const userCacheByToken = new Map<string, User & RowDataPacket>();
const chairCacheByToken = new Map<string, Chair & RowDataPacket>();
const ownerCacheByToken = new Map<string, Owner & RowDataPacket>();

export const clearAuthCaches = (): void => {
  userCacheByToken.clear();
  chairCacheByToken.clear();
  ownerCacheByToken.clear();
};

export const appAuthMiddleware = createMiddleware<Environment>(
  async (ctx, next) => {
    const accessToken = getCookie(ctx, "app_session");
    if (!accessToken) {
      return ctx.text("app_session cookie is required", 401);
    }
    try {
      let user = userCacheByToken.get(accessToken);
      if (!user) {
        const [[fetched]] = await ctx.var.dbConn.query<
          Array<User & RowDataPacket>
        >("SELECT * FROM users WHERE access_token = ?", [accessToken]);
        if (!fetched) {
          return ctx.text("invalid access token", 401);
        }
        user = fetched;
        userCacheByToken.set(accessToken, user);
      }
      ctx.set("user", user);
    } catch (error) {
      return ctx.text(`Internal Server Error\n${error}`, 500);
    }
    await next();
  },
);

export const ownerAuthMiddleware = createMiddleware<Environment>(
  async (ctx, next) => {
    const accessToken = getCookie(ctx, "owner_session");
    if (!accessToken) {
      return ctx.text("owner_session cookie is required", 401);
    }
    try {
      let owner = ownerCacheByToken.get(accessToken);
      if (!owner) {
        const [[fetched]] = await ctx.var.dbConn.query<
          Array<Owner & RowDataPacket>
        >("SELECT * FROM owners WHERE access_token = ?", [accessToken]);
        if (!fetched) {
          return ctx.text("invalid access token", 401);
        }
        owner = fetched;
        ownerCacheByToken.set(accessToken, owner);
      }
      ctx.set("owner", owner);
    } catch (error) {
      return ctx.text(`Internal Server Error\n${error}`, 500);
    }
    await next();
  },
);

export const chairAuthMiddleware = createMiddleware<Environment>(
  async (ctx, next) => {
    const accessToken = getCookie(ctx, "chair_session");
    if (!accessToken) {
      return ctx.text("chair_session cookie is required", 401);
    }
    try {
      let chair = chairCacheByToken.get(accessToken);
      if (!chair) {
        const [[fetched]] = await ctx.var.dbConn.query<
          Array<Chair & RowDataPacket>
        >("SELECT * FROM chairs WHERE access_token = ?", [accessToken]);
        if (!fetched) {
          return ctx.text("invalid access token", 401);
        }
        chair = fetched;
        chairCacheByToken.set(accessToken, chair);
      }
      ctx.set("chair", chair);
    } catch (error) {
      return ctx.text(`Internal Server Error\n${error}`, 500);
    }
    await next();
  },
);
