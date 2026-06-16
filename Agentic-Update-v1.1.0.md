# Agentic Interface Update v1.1.0

Status: mixed VERIFIED and ASSUMED. This document is a product and architecture plan with a recorded verification snapshot, not an implementation completion report.

## 1. Purpose

This document rewrites the referral product direction into a true agentic interface with a two-phase implementation plan.

The core rule in v1.1.0 is:

- No "Help Me Add Leads" flow
- No user-assist mode
- No public human-assisted lead entry
- All people and all referral users talk directly to the AI agent on WhatsApp
- Humans remain only on the internal operations side

Implementation order in v1.1.0 is:

- Phase 1 first: no WhatsApp involved
- Phase 1 uses an internal agent sandbox and emulates inbound identity with phone number `601121000099`
- Phase 2 plugs the already-tested agent into the Baileys API

## 1.1 Verification Snapshot

The following items are already verified as of this planning update:

### Verified From Current Codebase

- the app is currently a web-first Next.js referral portal
- the current product has a landing page, referrer dashboard, manager dashboard, and assigned-agent dashboard
- the current public flow still depends on Auth Hub plus `auth_token`
- referrer identity is already strongly phone-based
- referrer accounts are already auto-created from phone-linked identity in the existing Postgres model
- lead add, edit, list, assign, and workflow update logic already exists in the current codebase
- a public user-assist flow still exists in the current codebase and must be removed in the target product

### Verified Live Integration: Baileys API

- `https://ee-baileys-production.up.railway.app/health` responded with `{"status":"ok"}`
- `https://ee-baileys-production.up.railway.app/api` responded successfully
- the live `/api` response confirms these currently exposed endpoints:
- `POST /sessions/:id`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /sessions/:id/qr`
- `POST /messages/send`
- `POST /simulate/inbound`
- `POST /groups/create`
- `DELETE /groups/:jid?sessionId=...`
- `GET /chats?sessionId=...`
- `GET /chats/:jid/messages?sessionId=...&limit=50&beforeTimestamp=...`
- `DELETE /sessions/:id`

### Verified Live Integration: MiniMax Access

- `mmx auth status --non-interactive --quiet --output json` returned a valid configured auth source
- auth method is `api-key`
- auth source is local `config.json`
- `mmx quota show --non-interactive --quiet --output json` returned `status_code: 0` and `status_msg: "success"`
- this proves a working MiniMax API key is available from this machine through `mmx`

### Verified Working Assumption For Planning

- there is enough verified information to continue architecture planning for the agentic interface
- the Baileys API is live and reachable
- MiniMax access is not only configured but successfully accepted by the API
- Phase 1 can proceed without any WhatsApp dependency because the core agent can be tested through an internal sandbox first

### Verified Production Schema Findings

The production database schema has now been read through the proxy in read-only mode.

Read method used:

- proxy docs were reviewed first
- schema discovery used `SELECT` only
- no writes, schema changes, updates, or deletes were executed

Verified relevant public tables:

- `customer`
- `referral`
- `user`
- `agent`
- `conversation`
- `chat_thread`
- `chat_message`

Verified `customer` shape:

- primary key: `id`
- unique business key: `customer_id`
- key columns present:
- `name`
- `phone`
- `email`
- `address`
- `city`
- `state`
- `postcode`
- `notes`
- `created_by`
- `updated_by`
- `profile_picture`
- `lead_source`
- `remark`

Verified `referral` shape:

- primary key: `id`
- unique business key: `bubble_id`
- foreign key present on `linked_customer_profile`
- key columns present:
- `linked_customer_profile`
- `name`
- `relationship`
- `mobile_number`
- `status`
- `linked_agent`
- `linked_invoice`
- `project_type`
- `deal_value`
- `commission_earned`
- `created_at`
- `updated_at`

Verified `user` shape:

- primary key: `id`
- unique business key: `bubble_id`
- key columns present:
- `linked_agent_profile`
- `access_level`
- `name`
- `contact`
- `email`

Verified `agent` shape:

- primary key: `id`
- unique business key: `bubble_id`
- key columns present:
- `linked_user_login`
- `name`
- `contact`
- `email`

Verified existing chat-related tables:

- `conversation`
- `chat_thread`
- `chat_message`

These tables may help with Phase 1, but they are not yet a full agent-run audit model by themselves.

Verified missing optional fields in prod:

- `customer.linked_referrer` is not present
- `referral.assigned_agent` is not present
- `referral.lead_state` is not present
- `referral.lead_city` is not present
- `referral.lead_address` is not present
- `referral.preferred_agent_log` is not present

Phase 1 impact from verified schema:

- Phase 1 should reuse the current referral service capability-detection approach
- Phase 1 should not assume a richer referral schema than prod actually has
- lead location should continue to come from `customer.state`, `customer.city`, and `customer.address`
- linked referrer context should continue to be stored through existing metadata patterns when direct columns are absent
- manager and preferred-agent logic must respect that prod currently has `linked_agent` but not `assigned_agent`

Validated planning conclusion:

- the current production schema supports Phase 1 sandbox development if the app reuses the existing service abstractions instead of assuming new tables or richer optional columns

### Not Yet Fully Verified

- whether the same MiniMax key is already wired into the app runtime or deployment vault used by this project
- the exact inbound event contract between Baileys and this app
- whether `POST /leads/verify-whatsapp` is enabled in the currently deployed Baileys server, because it appears in HTML docs but not in the live `/api` listing

## 1.2 Implementation Progress

- COMPLETED: Phase 1 Milestone 1 scaffolding has started in the codebase
- COMPLETED: added a read-only referrer lookup helper so sandbox inspection does not auto-create prod-backed accounts
- COMPLETED: added an internal `/agent-sandbox` page for emulated phone-based inspection
- COMPLETED: the sandbox currently resolves a phone number, displays the matched referrer account snapshot, and lists current leads
- COMPLETED: Phase 1 Milestone 2 added a read-only conversational loop to `/agent-sandbox`
- COMPLETED: the sandbox now accepts a user message, detects a basic intent, and renders a safe agent reply plus planned tools
- COMPLETED: supported read-only prompts now include help, list leads, and lead detail lookup
- COMPLETED: unsupported write intents such as add lead, update lead, or follow-up now return explicit blocked responses for this milestone
- COMPLETED: Phase 1 Milestone 3 replaced the rule-based turn runner with a MiniMax-backed sandbox chat API
- COMPLETED: sandbox conversation memory is now explicitly ephemeral and capped at 30 rounds in browser state
- COMPLETED: MiniMax-backed turns now fall back to the local rule-based responder if structured output fails
- VALIDATED: the MiniMax-backed sandbox path compiles cleanly with `npx tsc --noEmit`
- COMPLETED: Phase 1 Milestone 4 added a confirmation-first lead creation flow with field-by-field collection in the sandbox
- COMPLETED: sandbox write mode now uses the provided Postgres proxy when local `DATABASE_URL` is unavailable
- COMPLETED: obvious off-topic prompts are now rejected so the sandbox stays limited to referral lead management
- VALIDATED: live runtime testing through `/api/agent-sandbox/chat` created three demo leads for phone `601121000099`
- VALIDATED: demo lead 1 created as referral ID `218`
- VALIDATED: demo lead 2 created as referral ID `219`
- VALIDATED: demo lead 3 created as referral ID `220`
- VALIDATED: `my leads` returned the three newly created demo leads in the sandbox identity
- VALIDATED: `show lead 2` resolved the correct lead detail payload after multi-lead creation
- VALIDATED: the off-topic guard rejected a weather question and kept the agent on referral-only tasks
- NEXT: add duplicate-prevention refinement, edit-lead flow, and follow-up request flow on top of the validated add/check baseline

## 2. Rechecked Findings From Current Codebase

The current app is still a web-first portal with landing page, referrer dashboard, manager dashboard, and assigned-agent dashboard.

Observed codebase behavior:

- Referrer public landing page exists in `src/app/page.tsx`
- Referrer dashboard exists in `src/app/dashboard/page.tsx`
- Public WhatsApp sign-in currently depends on Auth Hub and `auth_token`
- Referral identity is already strongly tied to phone number
- Referral accounts are auto-created in Postgres from phone-linked identity
- Lead add, edit, list, assign, and workflow update logic already exists
- A public user-assist flow still exists and must be removed in the target architecture

Relevant current areas:

- `src/app/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/actions.ts`
- `src/lib/auth.ts`
- `src/lib/referrals.ts`
- `src/lib/internal-users.ts`
- `README.md`

## 3. V1.1.0 Product Rule

Referrer-facing interface:

- final end-state: WhatsApp AI only
- implementation Phase 1: internal chat sandbox used for testing the same agent before WhatsApp is enabled

Internal-facing interface:

- Internal web operations console only

Identity rule:

- Incoming WhatsApp number = referrer account identity

Authentication rule:

- Referrers do not need Auth Hub or web login to add leads, check leads, or request follow-up

Public workflow rule:

- No staff member should act on behalf of another referrer in the public product flow

## 4. End-State Product Shape

The final product is no longer a normal referral portal with chat added on top.

The final product is:

- A WhatsApp-first AI referral agent for all referrers
- A server-side orchestration layer that understands user intent and uses tools safely
- A Postgres-backed source of truth for leads and referral workflow
- A slim internal web console for monitoring, assignment, intervention, and auditability

## 4.1 Implementation Phases

### Phase 1: Agent Sandbox First

Phase 1 exists to validate the whole agent workflow before any WhatsApp integration is introduced.

Phase 1 rules:

- no Baileys dependency for core testing
- no live WhatsApp message dependency
- simulate inbound sender identity with phone number `601121000099`
- test the agent through an internal chat UI or internal harness
- validate reads, writes, prompts, tool calls, and conversation state first
- use ephemeral conversation memory only, capped at 30 rounds
- keep Postgres as the only persistent business record source for referrer and lead data

Phase 1 target outcome:

- the agent can complete referral flows correctly without relying on WhatsApp transport

### Phase 2: Baileys Integration

Phase 2 begins only after Phase 1 functions are proven through sandbox testing.

Phase 2 rules:

- preserve the same agent orchestrator
- preserve the same tool layer
- preserve the same database logic
- replace sandbox input/output with Baileys inbound and outbound message handling

Phase 2 target outcome:

- the already-validated agent runs on the live WhatsApp channel

## 5. What Must Be Removed

The following concepts are removed from the target product:

- "Help Other to Add Lead"
- user-assist unlock page
- user-assist password
- any support-password behavior
- public staff-assisted referrer workflow
- public dependency on Auth Hub for normal referrer activity
- referrer dependence on the old web dashboard

## 6. V1.1.0 Core Architecture

### 6.1 Channel Layer

Phase 1 channel:

- internal agent sandbox with simulated sender phone

Phase 2 channel:

- WhatsApp via your Baileys server

Responsibilities:

- receive inbound user messages or sandbox test messages
- send AI replies to the sandbox or to WhatsApp depending on the phase
- recover session state
- read chats for reconciliation and replay if needed

### 6.2 Agent Layer

Primary intelligence:

- Minimax M3 using your token plan from vault/server secret storage

Responsibilities:

- classify intent
- manage multi-turn lead collection
- ask clarifying questions
- summarize and confirm lead details
- trigger allowed server-side tools
- answer general referral questions
- create handoff requests when needed

Important rule:

- The AI agent must not directly write to the database from freeform generation
- All writes must happen through explicit tool calls controlled by the server

### 6.3 Business Layer

Primary source of truth:

- existing Postgres `customer` and `referral` tables

Responsibilities:

- referrer account creation from incoming number
- lead creation and updates
- lead listing and lead retrieval
- manager assignment
- agent assignment tracking
- referral status workflow

### 6.4 Operations Layer

Primary internal surface:

- internal web operations console

Responsibilities:

- view live conversations
- inspect transcripts
- monitor failed runs
- review unresolved threads
- perform human takeover
- review lead queues
- assign or reassign internal agents
- manage prompt and tool configuration

## 7. Identity Model

Identity in v1.1.0 is simplified:

- sender phone number is the identity key
- normalize phone number on every inbound message
- find existing referrer account by phone
- if none exists, create a referrer account automatically

This fits the current codebase direction because the existing referral account logic already maps well to phone-based identity.

## 8. Main User Journeys

In Phase 1, these journeys are tested through the internal agent sandbox using emulated phone number `601121000099`.

In Phase 2, the exact same journeys are exposed through WhatsApp.

### 8.1 Add New Lead

User messages the AI:

- "new lead"
- "I want to refer someone"
- "add lead"

Agent flow:

- detect add-lead intent
- collect lead name
- collect lead mobile number
- collect state
- collect city
- collect address
- collect relationship
- collect project type
- collect remarks if any
- optionally ask preferred agent
- run duplicate checks
- present a final summary
- ask for confirmation
- save lead
- reply with confirmation and current status

### 8.2 Check All Leads

User messages the AI:

- "my leads"
- "check my referrals"
- "show all leads"

Agent flow:

- identify sender from phone
- load all leads tied to that referrer
- return a compact list with:
- lead name
- lead mobile
- project type
- current status
- assigned agent
- latest update if available

The agent should support follow-up messages such as:

- "show lead 2"
- "which one is qualified"
- "who is handling Mr Lee"

### 8.3 Check One Lead

User messages the AI:

- "status of John"
- "show my latest lead"

Agent flow:

- resolve the target lead from list context or name/number
- show detailed lead summary
- include assignment and status
- provide next possible actions

### 8.4 Update Lead

User messages the AI:

- "change the number"
- "update address"
- "edit my lead"

Agent flow:

- identify target lead
- ask which fields to change
- show updated summary
- ask for confirmation
- perform safe update through server tool

### 8.5 Ask For Human Follow-Up

User messages the AI:

- "ask your sales team to contact"
- "I want an agent to follow up"
- "assign to someone"

Agent flow:

- identify the target lead
- capture follow-up intent
- capture preferred agent if user names one
- record the request
- either move into assignment workflow or create manager review task
- return clear next-step message to the user

## 9. Agent Operating Model

The AI should behave as a bounded tool-using agent, not a general chatbot without controls.

The operating sequence should be:

1. Receive inbound sandbox message in Phase 1 or inbound WhatsApp message in Phase 2
2. Normalize sender phone
3. Resolve or create referrer account
4. Load conversation state
5. Classify user intent
6. Decide whether a tool is needed
7. Collect missing slots
8. Confirm structured data before write
9. Execute tool
10. Persist transcript and action log
11. Send final WhatsApp reply

## 10. Minimax M3 Role

Use Minimax M3 for:

- intent classification
- slot filling
- conversational reply generation
- lead summary generation
- follow-up question generation
- long-thread summarization

Do not use Minimax M3 for:

- direct SQL generation
- authorization decisions
- permission enforcement
- hidden privileged actions
- bypassing tool validation

Required safeguards:

- fixed system prompt
- tool whitelist
- server-side permission checks
- structured tool schema
- audit logging for prompt, tool input, tool output, and reply

## 11. Proposed Server-Side Tools

The agent should only be allowed to call explicit tools such as:

- `get_or_create_referrer_by_phone`
- `get_referrer_profile`
- `start_lead_capture`
- `save_lead`
- `update_lead`
- `list_referrer_leads`
- `get_lead_details`
- `request_follow_up`
- `set_preferred_agent`
- `list_internal_agents`
- `send_agent_reply`
- `append_conversation_summary`

Rules:

- all tool inputs must be validated
- all write tools must be audited
- all privileged tools must be staff-only

Phase note:

- in Phase 1, `send_agent_reply` targets the sandbox conversation UI
- in Phase 2, `send_agent_reply` targets Baileys `POST /messages/send`

## 12. Data Model Strategy

### 12.1 Keep Existing Business Tables

Keep as source of truth:

- `customer`
- `referral`

Keep existing business logic where possible:

- referrer account creation
- referral creation
- referral update
- manager assignment
- status workflow

### 12.2 Phase 1 Memory Strategy

Phase 1 does not require persisted conversation storage.

Phase 1 memory rule:

- keep only ephemeral conversation memory in the sandbox session
- cap memory at 30 rounds
- treat Postgres business records as the only persistent source of truth

Persistent data in Phase 1:

- referrer account data
- lead data
- created leads
- edited leads
- future follow-up actions when enabled

Deferred for later:

- durable transcript storage
- agent-run audit tables
- replayable conversation persistence

## 13. Baileys Integration Strategy

Baileys integration is a Phase 2 concern, not a Phase 1 dependency.

Documented usable endpoints include:

- `POST /sessions/:id`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /sessions/:id/qr`
- `POST /messages/send`
- `GET /chats`
- `GET /chats/:jid/messages`
- `DELETE /sessions/:id`

Docs also mention:

- `POST /leads/verify-whatsapp`

V1.1.0 integration rules:

- outbound messages always go through `POST /messages/send`
- session health must be monitored before or around send attempts
- chat-read APIs are for replay, reconciliation, or support workflows
- inbound messages should trigger the orchestrator immediately

If Baileys does not already push inbound events directly into the app:

- add a lightweight inbound bridge or webhook forwarder

Phase 1 rule:

- none of the above Baileys transport wiring is required to validate the agent logic

## 14. Internal Ops Console

The new web interface should be internal-only and agent-centric.

Suggested screens:

- live conversations
- unresolved conversations
- human handoff queue
- all referral leads
- assignment manager
- session health
- AI run logs
- prompt and policy settings

Users:

- managers
- internal agents
- admins
- ops staff

Non-goal:

- public referrer self-service on the web

## 15. Human Roles In V1.1.0

Humans still exist in the system, but not as public workflow substitutes.

Allowed internal human roles:

- monitor conversations
- review escalations
- assign internal agents
- intervene in failed or risky conversations
- handle exceptions and compliance issues

Disallowed public role:

- manually acting as another referrer in the front-end product flow

## 16. Security And Safety Rules

- referrer identity comes from inbound phone only
- internal actions still require staff authentication
- AI cannot escalate its own permissions
- AI cannot bypass tool boundaries
- duplicate lead checks should run before writes
- rate limiting should exist per sender phone
- spam and abuse detection should exist
- secrets must stay in vault/server-side environment only
- Minimax credentials must never be exposed in client code

## 17. Rollout Plan

### Phase 1: Agent Sandbox First

- build the internal agent sandbox UI or test harness
- emulate inbound sender identity using phone number `601121000099`
- build the agent orchestration layer
- preserve current database model
- keep manager and internal workflows operational
- validate prompt behavior, tool usage, and confirmation flow
- validate add-lead, list-leads, lead-details, update-lead, and follow-up flows
- verify reads and writes against Postgres
- log every run, message, and tool call for debugging

### Phase 2: Baileys Integration

- connect the already-tested agent to Baileys inbound and outbound flows
- map live sender number to the same identity resolver used in Phase 1
- route outbound replies through `POST /messages/send`
- add session health checks, retries, and operational monitoring
- keep handoff and assignment reviewed internally
- remove or hide public dashboard routes for referrers when live WhatsApp flow is ready
- improve prompts, duplicate detection, routing logic, and analytics after live traffic begins

## 18. Success Criteria

The product is considered aligned with v1.1.0 when:

- Phase 1 proves the agent works without WhatsApp transport
- referrers no longer need the old dashboard
- all referrers can manage leads directly through WhatsApp AI
- the system safely maps phone number to account
- lead operations are reliable, auditable, and tool-driven
- internal teams can still review and assign leads from an ops console

## 19. Final Checklist

- [ ] Phase 1 sandbox exists without WhatsApp
- [ ] Phone number `601121000099` can be used to emulate a referrer identity in Phase 1
- [ ] The agent can add a lead end-to-end in the sandbox
- [ ] The agent can list all leads for the emulated phone in the sandbox
- [ ] The agent can show lead details in the sandbox
- [ ] The agent can update an existing lead in the sandbox
- [ ] The agent can request human follow-up in the sandbox
- [ ] The agent confirms before writes in the sandbox
- [ ] Tool calls, prompts, and outputs are logged in Phase 1
- [ ] Postgres reads and writes are verified in Phase 1
- [ ] No Baileys dependency exists for Phase 1 validation
- [ ] Phase 2 reuses the same orchestrator and tools instead of rebuilding the agent
- [ ] No "Help Me Add Leads" feature exists anywhere in the product
- [ ] No user-assist unlock/password feature exists anywhere in the product
- [ ] Every referrer talks directly to the AI agent on WhatsApp
- [ ] Incoming phone number is the only referrer identity key
- [ ] Referrers do not need Auth Hub or web login to manage leads
- [ ] Users can add leads fully inside WhatsApp
- [ ] Users can check all leads fully inside WhatsApp
- [ ] Users can update lead details fully inside WhatsApp
- [ ] Users can request human follow-up fully inside WhatsApp
- [ ] All writes happen through validated server-side tools
- [ ] Existing Postgres lead and referral workflow remains the source of truth
- [ ] Managers can still review, assign, and monitor through an internal web console
- [ ] Baileys session health and outbound delivery are observable
- [ ] Minimax M3 token stays server-side in vault/env only
- [ ] Every AI action and conversation is auditable
- [ ] The final product is truly WhatsApp-first and agentic

## 20. Open Items

These items remain unvalidated and must be confirmed before implementation:

- exact runtime secret path or vault wiring for the MiniMax key inside this app deployment
- exact inbound event contract from the Baileys deployment
- whether `POST /leads/verify-whatsapp` is live in the deployed server
- whether the internal sandbox will be a dedicated route, admin-only page, or test harness plus page
- assignment policy for follow-up requests:
- manager review only
- automatic routing
- hybrid routing
- preferred WhatsApp conversation tone and language policy
