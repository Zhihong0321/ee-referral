# How to Integrate Webchat Portable

## Purpose

`webchat-portable` is a separate deployable application, but it is **not** a separate data system. It must connect to the **exact same PostgreSQL database** as the existing referral app.

There is no database copy, sync job, migration, replica, or import/export step. Both apps read and write the same records.

## What is shared

| Data | Database location | Result of using the same values |
| --- | --- | --- |
| Referrer accounts and referral leads | `customer`, `referral` | Leads and profiles created in either app are immediately visible to the other. |
| Staff / agent lookup | `user`, `agent` | Staff detection uses the existing agent and user records. |
| Chat history | `et_channel_sessions.metadata.conversations` | A user can continue the same conversation from either app. |
| Agent workflow state | `et_channel_sessions.metadata.agentStates` | In-progress assistant context is shared. |

The portable app does not create a new schema or migrate any tables.

## Required environment configuration

Create `.env.local` from [`.env.example`](./.env.example). Set the following values to the exact values used by the existing referral app:

```dotenv
# Must be the exact same PostgreSQL database used by the existing app.
DATABASE_URL="postgresql://..."

# Used for the optional staff badge and Auth Hub token verification.
JWT_SECRET="same-auth-hub-secret"

# Must match exactly to share the same conversation and assistant state.
WHATSAPP_AGENT_BAILEYS_SESSION_ID="same-session-id"
WHATSAPP_AGENT_TENANT_ID="same-tenant-id"
```

Use the same LLM configuration when you want the assistant to behave consistently:

```dotenv
WHATSAPP_AGENT_LLM_BASE_URL="https://..."
WHATSAPP_AGENT_LLM_MODEL="..."
MINIMAX_API_KEY="..."
```

Set the vision variables only when image uploads should work.

### Direct database connection vs. SQL proxy

The portable app always requires `DATABASE_URL`. By default, it connects directly to that database.

If all three settings below are present, the chat data layer uses the SQL proxy instead. In that case, the proxy must target the **exact same database**:

```dotenv
WHATSAPP_AGENT_PROXY_URL="https://..."
WHATSAPP_AGENT_PROXY_AUTH="Bearer ..."
WHATSAPP_AGENT_PROXY_DB_NAME="same-database-name"
```

Do not point one app at a different environment, a read replica, or a copied database. That would split leads and conversation state.

## Deploy the portable app

Deploy it as an independent app on its own hostname or subdomain. This is the simplest integration because its UI and API routes use relative URLs.

```bash
cd webchat-portable
npm ci
npm run build
npm start
```

Then add a normal link from the other app to the portable app, for example:

```text
https://chat.example.com
```

The portable app owns these routes:

```text
/
POST /api/web-chat/login
GET  /api/web-chat/history?phone=...
POST /api/web-chat/message
POST /api/web-chat/reset
```

Do not mount it under a path such as `/webchat` unless the deployment is also configured with a Next.js base path; the supplied package is built to run from the hostname root.

## Shared-state rules

1. Keep `DATABASE_URL`, `WHATSAPP_AGENT_BAILEYS_SESSION_ID`, and `WHATSAPP_AGENT_TENANT_ID` identical in both apps.
2. Use the same phone number in both apps to see the same chat history.
3. Avoid sending messages for the same phone through both apps at exactly the same time. Conversation and agent state are stored together in one shared session record.
4. A **Reset chat** action in either app clears the shared conversation and in-progress agent state for that phone. It does not delete referral leads or referrer accounts.
5. The browser stores the entered phone number locally. On a new hostname, users enter their phone once; the app then loads their shared history from the database.

## Authentication and access control

The current web-chat flow accepts a phone number and does not add an OTP step. Keep the portable app behind the access control appropriate for the new host.

The staff badge is optional. It appears only when the browser sends a valid `auth_token` cookie that the portable host can receive and verify using the same `JWT_SECRET`. If that cookie is unavailable on the new hostname, the chat still works; only the staff badge is absent.

## Verification checklist

After deployment, use a known test phone and confirm:

- The portable app opens at its new URL.
- Logging in loads the same prior chat history as the existing app.
- A reset in the portable app is reflected in the existing app for that test phone.
- A referral created or updated in either app appears in the other.
- Image upload works only if the vision environment variables are configured.
- The portable app and original app both point to the exact same database and share the same session and tenant IDs.

## Rollback

To roll back the integration, stop or remove the portable deployment. No database rollback is required because it does not add a schema or duplicate data. Normal referral and conversation changes made while it was running remain in the shared database.
