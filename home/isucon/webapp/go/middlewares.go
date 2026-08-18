package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sync"

	"github.com/jmoiron/sqlx"
)

// access_tokenからuser/chair/owner行へのインメモリキャッシュ。
// 各テーブルのid/access_token/username等の識別情報は作成後どのコードパスからも
// 更新されないため、一度引いた行は安全にキャッシュしてよい
// (isucon14 Node.js実装 entries/0025と同じ最適化)。
// POST /api/initialize でDBがリセットされるため、そのタイミングで必ずclearする。
var (
	authCacheMu    sync.RWMutex
	userCacheByTok = map[string]*User{}
	// user.id→行のキャッシュ。chairGetNotificationがride.UserIDからユーザーの氏名を
	// 引く際に使う(access_tokenを持たない経路のため別マップが必要)。
	userCacheByID   = map[string]*User{}
	chairCacheByTok = map[string]*Chair{}
	ownerCacheByTok = map[string]*Owner{}
)

func clearAuthCaches() {
	authCacheMu.Lock()
	defer authCacheMu.Unlock()
	userCacheByTok = map[string]*User{}
	userCacheByID = map[string]*User{}
	chairCacheByTok = map[string]*Chair{}
	ownerCacheByTok = map[string]*Owner{}
}

func appAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		c, err := r.Cookie("app_session")
		if errors.Is(err, http.ErrNoCookie) || c.Value == "" {
			writeError(w, http.StatusUnauthorized, errors.New("app_session cookie is required"))
			return
		}
		accessToken := c.Value

		authCacheMu.RLock()
		user, cached := userCacheByTok[accessToken]
		authCacheMu.RUnlock()

		if !cached {
			user = &User{}
			if err := db.GetContext(ctx, user, "SELECT * FROM users WHERE access_token = ?", accessToken); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					writeError(w, http.StatusUnauthorized, errors.New("invalid access token"))
					return
				}
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			authCacheMu.Lock()
			userCacheByTok[accessToken] = user
			userCacheByID[user.ID] = user
			authCacheMu.Unlock()
		}

		ctx = context.WithValue(ctx, "user", user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// getUserByID は、user.id→行のキャッシュを使ってusersテーブルへのDB問い合わせを避ける
// (isucon14 Node.js実装 entries/0025と同じ最適化。usersテーブルは作成後どのコード
// パスからも更新されないため、キャッシュしても安全)。キャッシュに無い場合はDBへ問い合わせる。
func getUserByID(ctx context.Context, tx *sqlx.Tx, userID string) (*User, error) {
	authCacheMu.RLock()
	user, cached := userCacheByID[userID]
	authCacheMu.RUnlock()
	if cached {
		return user, nil
	}

	user = &User{}
	if err := tx.GetContext(ctx, user, "SELECT * FROM users WHERE id = ?", userID); err != nil {
		return nil, err
	}
	authCacheMu.Lock()
	userCacheByID[userID] = user
	authCacheMu.Unlock()
	return user, nil
}

func ownerAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		c, err := r.Cookie("owner_session")
		if errors.Is(err, http.ErrNoCookie) || c.Value == "" {
			writeError(w, http.StatusUnauthorized, errors.New("owner_session cookie is required"))
			return
		}
		accessToken := c.Value

		authCacheMu.RLock()
		owner, cached := ownerCacheByTok[accessToken]
		authCacheMu.RUnlock()

		if !cached {
			owner = &Owner{}
			if err := db.GetContext(ctx, owner, "SELECT * FROM owners WHERE access_token = ?", accessToken); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					writeError(w, http.StatusUnauthorized, errors.New("invalid access token"))
					return
				}
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			authCacheMu.Lock()
			ownerCacheByTok[accessToken] = owner
			authCacheMu.Unlock()
		}

		ctx = context.WithValue(ctx, "owner", owner)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func chairAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		c, err := r.Cookie("chair_session")
		if errors.Is(err, http.ErrNoCookie) || c.Value == "" {
			writeError(w, http.StatusUnauthorized, errors.New("chair_session cookie is required"))
			return
		}
		accessToken := c.Value

		authCacheMu.RLock()
		chair, cached := chairCacheByTok[accessToken]
		authCacheMu.RUnlock()

		if !cached {
			chair = &Chair{}
			if err := db.GetContext(ctx, chair, "SELECT * FROM chairs WHERE access_token = ?", accessToken); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					writeError(w, http.StatusUnauthorized, errors.New("invalid access token"))
					return
				}
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			authCacheMu.Lock()
			chairCacheByTok[accessToken] = chair
			authCacheMu.Unlock()
		}

		ctx = context.WithValue(ctx, "chair", chair)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
