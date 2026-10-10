# NexTalk

Next.js frontend in `f/`, Express + Socket.IO API in `b/`, and MySQL persistence.

## Run locally

1. Install locked dependencies with `npm ci` in `b/` and `f/`.
2. Configure `b/.env` from `b/.env.example` and `f/.env.local` as described below. Never commit real secrets.
3. In `b/`, run `npm run setup-db` once and after pulling schema changes. It adds missing tables/columns without deleting accounts or messages.
4. In `b/`, run `npm run dev` (Node's native watch mode).
5. In `f/`, run `npm run dev -- --hostname 127.0.0.1` and open http://127.0.0.1:3000.

Frontend environment:

```dotenv
API_URL=http://127.0.0.1:5000
NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:5000
```

The older `NEXT_PUBLIC_API_URL` setting is still supported. No API keys or database credentials belong in `NEXT_PUBLIC_*` variables.

## Behavior

- Registration creates an account and returns to `/login`; it never logs in automatically. Username and email uniqueness are enforced by database indexes, including concurrent attempts.
- Protected pages validate the session on the server. Page layouts and initial account/friend/profile/notification data render server-side. Forms and live updates use client islands.
- Add people from their profile. Once the recipient accepts, both can message each other; messages are saved before delivery and retries use an idempotency key.
- `/profile` opens your profile. Edit your name, bio, photo, banner, and optional click-to-play song. Images are limited to 2 MB / 16 megapixels, re-encoded as WebP, and stripped of image metadata. Audio is limited to 6 MB; it never autoplays. Uploads are private until attached to a profile, then available to signed-in members. Per-user uploaded media allowance is 32 MB.
- ChatAi uses OpenAI web search and renders source citations. Rizzler sends only the snippet you explicitly enter and the selected tone; it never fetches private chat history. Suggestions and Conversation Sparks fill the draft; sending requires a separate click.
- AI requires a funded API account. Provider failures and quota errors are shown explicitly; no fake web answers are substituted.
- Notifications are confined to their page.
- Friend requests and acceptances are stored permanently in notifications, with profile links, accept/message actions, persistent read status, and pagination for older activity. Setup backfills existing pending requests.
- Shared read caching expires after two seconds and coalesces simultaneous misses into one database load. Mutation invalidation prevents an older in-flight read from overwriting fresh cache data. Session validity remains checked against the database.
- Authenticated requests have per-account rate limits, including a shared 60-message/minute budget across HTTP and all sockets. Repeated mutations to the same resource have a two-second cooldown and return HTTP 429 with Retry-After. Reads, login/logout, socket renewal, and message delivery are exempt from that cooldown so navigation, recovery, and conversations stay responsive. Failed validation releases its cooldown immediately.

## Session and deployment details

- Authentication uses signed, revocable server sessions in HttpOnly, SameSite cookies. The browser receives only short-lived socket tickets, never the main session token in JSON/localStorage.
- REST authorization checks session validity; socket handshakes and sends check the session and friend relationship. Logout revokes the session and disconnects its sockets.
- Same-origin API proxy validates mutating request origins and an application header. Backend CORS and socket origins use `CLIENT_ORIGINS`. CSP, no-referrer, no-sniff, frame restrictions, no-store private responses, size limits, and rate limits are enabled.
- The backend binds `127.0.0.1` by default. For production, use HTTPS, `NODE_ENV=production`, a persistent volume for `b/storage/media`, a reverse proxy that forwards `/socket.io/` upgrades, and explicit frontend origin/socket URLs. Do not expose database credentials or the internal backend to arbitrary origins.
- Session revocation and messages persist in MySQL. Socket rooms and rate limits currently run in one backend process; multiple replicas require a shared Socket.IO adapter and shared limiter store.
- A legacy weak JWT signing secret was rotated locally. Old sessions require logging in again.

## Verification

```text
cd b
npm test
node scripts/verify-web.js   # frontend and backend must be running
cd ../f
npm run lint
npm run build
```

Integration tests cover registration, concurrent duplicate prevention, session/cookie handling, friendship permissions, WebSocket delivery/retries/history, profile ownership, validated uploads, audio range responses, AI response contracts (explicit mocked provider), and logout revocation. `verify-web.js` checks the real same-origin proxy and server-rendered private pages; test accounts are cleaned up.

Latest live AI check initially returned a web answer with a citation; later requests reported `credit_balance_exhausted`. ChatAi and Rizzler need API credits restored for new live replies. Backend and frontend production dependency audits were clean after patching. The frontend development linter still has a transitive `braces` advisory; do not run it on untrusted glob patterns. No unsupported downgrade of Next's lint tooling was applied.
