# Webchat Portable

A self-contained Next.js version of the Referral Assistant web chat. It keeps the current web-chat user experience and API behavior while living in its own project folder.

It shares the existing PostgreSQL data model:

- referrer and referral records
- agent roster and staff lookup
- web-chat conversation history and assistant state in `et_channel_sessions.metadata`

No credential files are copied from the main application.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set the same `DATABASE_URL`, `JWT_SECRET`, `WHATSAPP_AGENT_BAILEYS_SESSION_ID`, and `WHATSAPP_AGENT_TENANT_ID` used by the current referral app.
3. Add `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`. The model must support images for uploads.
4. Install and start:

   ```bash
   npm ci
   npm run dev
   ```

Open http://localhost:3000.

## Shared-database behavior

The portable app must use the same WhatsApp session ID and tenant ID as the original web chat to read and continue the same conversations. A different session ID creates a separate conversation/state namespace in the same database.

If `WHATSAPP_AGENT_PROXY_URL`, `WHATSAPP_AGENT_PROXY_AUTH`, and `WHATSAPP_AGENT_PROXY_DB_NAME` are all set, this app uses that SQL proxy. Otherwise it connects directly with `DATABASE_URL`.

## API routes

- `POST /api/web-chat/login`
- `GET /api/web-chat/history?phone=...`
- `POST /api/web-chat/message`
- `POST /api/web-chat/reset`

The UI stores the entered phone number in browser local storage, matching the existing web chat. It does not add an OTP challenge, so deploy it only behind the access controls appropriate for your new app.

## Production

```bash
npm ci
npm run build
npm start
```

A standalone Docker build is included:

```bash
docker build -t webchat-portable .
docker run --rm -p 3000:3000 --env-file .env.local webchat-portable
```
