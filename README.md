# Echoes&Paths — Backend

REST API for **Echoes&Paths**, a mobile app (Expo / React Native) for discovering, conquering and sharing historical places, monuments and points of interest around the world.

The backend acts as:

- **Application server**: authentication (email/password + Google OAuth with JWT), user profiles, friendships, place "conquests", community contributions and a social feed.
- **Aggregation proxy**: enriches its own database with places from the **Google Places API** and details/translations from the **Wikipedia API**, and proxies external images (Europeana / Wikimedia) to avoid CORS and hotlinking issues on the client.
- **Geospatial engine**: uses **PostgreSQL + PostGIS** to store and query locations by proximity.

---

## Tech stack

| Area | Technology |
|------|------------|
| Runtime | Node.js (ESM) |
| Language | TypeScript, executed directly with [`tsx`](https://github.com/privatenumber/tsx) |
| Framework | Express 5 |
| Database | PostgreSQL + PostGIS |
| Query builder / migrations | Knex |
| Auth | JSON Web Tokens (`jsonwebtoken`) + `bcryptjs` |
| External services | Google Places API, Wikipedia API, Expo Push, Europeana/Wikimedia images |
| Deployment | Railway (see `railway.toml`) |

> **Note:** the project runs TypeScript directly with `tsx` in both development and production. The `build` / `typecheck` scripts (via `tsc`) exist mainly for type checking.

---

## Project structure

```
CastleApp-backend/
├── server.ts                 # Express entry point (mounts routers, port 8080)
├── knexfile.cjs              # Knex config (development / production)
├── docker-compose.yml        # Local PostGIS database
├── railway.toml              # Railway deploy config (startCommand)
├── tsconfig.json
├── docs/                     # Static legal pages (privacy / terms) + landing
├── seeds/
│   └── 01_dummy_users.cjs    # Demo users, places, visits and follows
└── src/
    ├── config/
    │   ├── db.ts             # Knex instance (picks env from NODE_ENV)
    │   ├── jwtSecret.ts      # Single source of truth for the JWT secret
    │   └── migrations/       # Knex migrations (PostGIS schema)
    ├── middleware/
    │   └── auth.ts           # verifyToken — reads "Authorization: Bearer <jwt>"
    ├── routes/
    │   ├── auth.routes.ts    # /auth/*
    │   ├── catlesRoutes.ts   # /api/*  (main app API)
    │   └── socialRoutes.ts   # /social/*
    ├── controller/           # Business logic per domain
    └── types/                # TypeScript ambient declarations
```

---

## Architecture

`server.ts` mounts three routers, each under its own prefix:

| Prefix | Router | Responsibility |
|--------|--------|----------------|
| `/auth` | `auth.routes.ts` | Registration, login, Google login, account deletion |
| `/api` | `catlesRoutes.ts` | Map, search, moderation, contributions, conquests, username, friends |
| `/social` | `socialRoutes.ts` | Follows, check-in visits and social feed |

Protected routes go through the `verifyToken` middleware, which validates the JWT and exposes the caller's id as `req.userId`.

---

## API reference

Base URL (production): `https://castleapp-backend-production.up.railway.app`. Base URL (local): `http://localhost:8080`.

A ✅ in the **Auth** column means the route requires an `Authorization: Bearer <jwt>` header.

### 🔐 Auth — `/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | — | Register with `username`, `email`, `password` (password is bcrypt-hashed). Returns a JWT. |
| POST | `/auth/login` | — | Login with `email` + `password`. Returns a JWT. |
| POST | `/auth/google` | — | Google Sign-In. Verifies the Google `id_token` against `tokeninfo`, checks the audience matches `GOOGLE_CLIENT_ID`, and creates the user on first login. Returns a JWT. |
| DELETE | `/auth/:id` | — | Delete a user account. |
| DELETE | `/auth/users/:id` | — | Alias of the above. |
| POST | `/auth/create-test` | — | Debug helper — returns the column names of the `users` table. |

JWTs are signed with `JWT_SECRET` and expire in **7 days**.

### 🗺️ Main API — `/api`

**Map & places**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/` | — | Hybrid map feed: merges the local DB with live Google Places results, ordered by distance. |
| POST | `/api/suggest` | — | Save a discovered place into the local database. |

**External search (SearchScreen)**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/external/search` | — | Text search via Google Places (`places:searchText`). |
| GET | `/api/external/wiki` | — | Full Wikipedia details for a place, including language links / translations. |
| GET | `/api/image-proxy` | — | Proxies an external image (Europeana / Wikimedia) through the backend. |

**Moderation (admin)**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/pending` | ✅ | List locations awaiting approval. |
| PUT | `/api/admin/approve/:id` | ✅ | Approve a suggested location. |
| DELETE | `/api/admin/reject/:id` | ✅ | Reject a suggested location. |
| GET | `/api/admin/contributions/pending` | ✅ | List pending community contributions. |
| PUT | `/api/admin/contributions/approve/:id` | ✅ | Approve a contribution. |
| DELETE | `/api/admin/contributions/reject/:id` | ✅ | Reject a contribution. |

> Admin routes require a valid JWT, but there is **no dedicated admin role** yet — any authenticated user passes. Add a role/permission check before treating these as truly admin-only.

**Community contributions**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/contributions` | ✅ | Submit a contribution about a place. |
| GET | `/api/contributions` | — | Get approved contributions for a place. |
| GET | `/api/contributions/mine` | ✅ | The caller's own contribution for a place. |
| GET | `/api/contributions/my-discoveries` | ✅ | All places the caller has contributed to. |

**Conquests & ranking**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/conquests` | ✅ | Conquer a place (check-in). Server enforces a 150 m proximity check. |
| GET | `/api/conquests/mine` | ✅ | List the caller's conquests. |
| GET | `/api/conquests/check` | ✅ | Check whether the caller has conquered a given place. |
| GET | `/api/conquests/rank` | ✅ | The caller's global rank (medieval tiers by conquest count). |
| PUT | `/api/push-token` | ✅ | Store the caller's Expo push token. |

**Username**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/username` | ✅ | Get the caller's username. |
| GET | `/api/username/check` | ✅ | Check username availability. |
| PUT | `/api/username` | ✅ | Update username. |

**Friends**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/friends` | ✅ | List the caller's friends. |
| GET | `/api/friends/search` | ✅ | Search users. |
| GET | `/api/friends/requests` | ✅ | Pending friend requests. |
| POST | `/api/friends/request` | ✅ | Send a friend request (triggers an Expo push to the recipient). |
| PUT | `/api/friends/request/:id` | ✅ | Accept / reject a friend request. |
| DELETE | `/api/friends/:id` | ✅ | Remove a friend. |
| GET | `/api/friends/:userId/conquests` | ✅ | A friend's conquests (only if you are friends). |

### 👥 Social — `/social`

All `/social` routes require authentication and act on the logged-in user (`req.userId`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/social/search` | ✅ | Search users. |
| POST | `/social/follow/:id` | ✅ | Follow a user. |
| DELETE | `/social/unfollow/:id` | ✅ | Unfollow a user. |
| GET | `/social/feed` | ✅ | Social activity feed (visits of people you follow). |
| POST | `/social/visit/:locationId` | ✅ | Register a visit / check-in. |
| GET | `/social/visits/me` | ✅ | The caller's visits. |
| GET | `/social/visits/user/:id` | ✅ | Another user's visits. |

---

## Database

PostgreSQL with the **PostGIS** extension enabled. The schema is created by the Knex migrations in `src/config/migrations/`:

- `..._db_final.cjs` — base schema (`users`, `historical_locations` with a `geom (Point, 4326)` GiST index, `follows`, `visited_places`).
- `..._add_missing_schema.cjs` — additive & idempotent (`IF NOT EXISTS`): adds the `conquests`, `friendships` and `location_contributions` tables plus the extra columns the controllers query. It is a no-op on databases that already have them (e.g. production).

### Tables

- **`users`** — `id`, `username` (unique), `email` (unique), `password` (bcrypt hash), `avatar_url`, `push_token` (Expo notifications), timestamps.
- **`historical_locations`** — `id`, `name` (unique), `category`, `description`, `country`, `image_url`, `images (text[])`, `geom (Point, 4326)`, `author`, `license`, **plus** `latitude`, `longitude`, `is_approved`, `created_by_user_id` (FK → `users`), `google_place_id`, `location_text`, timestamps. Spatial GiST index on `geom`.
- **`follows`** — `follower_id`, `following_id` (both FK → `users`, cascade), unique pair.
- **`visited_places`** — `user_id`, `location_id` (FKs, cascade), `visited_at`.
- **`conquests`** — `id`, `user_id` (FK), `google_place_id`, `location_id` (FK), `place_name`, `place_lat`, `place_lon`, `user_lat`, `user_lon`, `image_url`, `category`, `conquered_at`.
- **`friendships`** — `id`, `requester_id`, `addressee_id` (both FK → `users`), `status` (`pending` / `accepted`), timestamps, unique `(requester_id, addressee_id)`.
- **`location_contributions`** — `id`, `google_place_id`, `location_id` (FK), `user_id` (FK), `photo_url`, `info_text`, `is_approved`, timestamps.

> **Coordinates caveat:** the hybrid map and moderation queries read `latitude` / `longitude` / `is_approved`, while the `/social/visits/*` map endpoints read the coordinates from the PostGIS `geom` column (`ST_X` / `ST_Y`). Places created through `POST /api/suggest` only fill `latitude` / `longitude`, not `geom`, so they won't appear on the `geom`-based visits map. Unifying these is a good future cleanup.

---

## Environment variables

Create a `.env` file in the project root (it is git-ignored).

**Database**

| Variable | Used by | Notes |
|----------|---------|-------|
| `NODE_ENV` | `db.ts`, `jwtSecret.ts` | `development` (default) or `production`. Selects the Knex config and enables the strict JWT check. |
| `DB_HOST` | dev | Local Postgres host. |
| `DB_USER` | dev | Local Postgres user. |
| `DB_PASSWORD` | dev | Local Postgres password. |
| `DB_DATABASE` | dev | Local database name. |
| `DB_PORT` | dev | Local Postgres port (e.g. `5433` with the provided Docker Compose). |
| `DATABASE_URL` | prod | Full connection string (used by Railway). |

**Auth & external services**

| Variable | Notes |
|----------|-------|
| `JWT_SECRET` | Secret used to sign JWTs. **Required in production** — the server throws on startup if it is missing while `NODE_ENV=production`. In development an insecure fallback is used with a console warning. |
| `GOOGLE_CLIENT_ID` | OAuth client id used to validate Google `id_token` audience. Has a committed default. |
| `GOOGLE_API_KEY` | Google Places API key (search, nearby, photos). |

---

## Getting started (local)

### 1. Prerequisites

- Node.js 18+
- Docker (for the local PostGIS database), or your own PostgreSQL + PostGIS instance

### 2. Install dependencies

```bash
npm install
```

### 3. Start the database

```bash
docker compose up -d
```

This starts a `postgis/postgis:15-3.3` container exposing Postgres on **port 5433**.

### 4. Configure environment

Create `.env`:

```env
NODE_ENV=development
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=test_password_123
DB_DATABASE=map_tracker_db2
DB_PORT=5433

JWT_SECRET=change_me
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_API_KEY=your_google_places_api_key
```

### 5. Run migrations & seed

```bash
npx knex migrate:latest --knexfile knexfile.cjs
npx knex seed:run --knexfile knexfile.cjs   # optional: demo data
```

### 6. Start the server

```bash
npm start
```

The server listens on `http://localhost:8080`. Visit `/` to confirm it's running.

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `tsx server.ts` | Run the server (TypeScript directly). |
| `npm run build` | `tsc` | Compile to `dist/` (type checking / optional). |
| `npm run typecheck` | `tsc --noEmit` | Type-check without emitting. |

---

## Deployment (Railway)

Deployment is configured in `railway.toml`:

```toml
[deploy]
startCommand = "npx tsx server.ts"
```

- Set `NODE_ENV=production` and provide `DATABASE_URL`, **`JWT_SECRET`** and the Google keys in Railway. Without `JWT_SECRET` the server intentionally refuses to start in production.
- Migrations use the `production` block of `knexfile.cjs` (`DATABASE_URL`, connection pool 2–10).
- The server binds to `0.0.0.0:8080`.

---

## Notes & conventions

- Some source filenames and comments are in Spanish (e.g. `catlesRoutes.ts` — the misspelling is intentional to match imports). Keep them as-is to avoid breaking imports.
- Passwords are always hashed with bcrypt; Google-created users get a random hashed password.
- Admin/moderation and social endpoints now require authentication. Admin routes still lack a **role** check (any logged-in user passes) — add one before exposing a real moderation panel.
- Legal pages served from `docs/` (`/privacy`, `/terms`) are required for Google OAuth verification and the app-store listing.
