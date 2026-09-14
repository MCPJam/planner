# MCPJam Planner

A live, stateless MCP planning demo for **Building Effective Stateless MCP Servers**.

- App / consent: https://planner.mcpjam.com
- MCP endpoint: https://planner.mcpjam.com/mcp
- Latest stable TypeScript MCP SDK: `@modelcontextprotocol/server` **2.0.0**, MCP Apps **2.0.0** (verified September 14, 2026).
- **12,528 synthetic records:** 2,088 calendar events, 4,176 tasks, 6,264 emails across every weekday in 2026–2027.

## Connect in a minute

Add the MCP URL as a remote server in MCPJam, ChatGPT, Claude, or Cursor. The OAuth consent screen lets you choose a toolset. No real identity or external account is connected. A new consent creates an isolated demo workspace. Reconnect to change toolsets.

For clients accepting custom headers, open the standalone app, expand **Connect**, copy the bearer token, and use `Authorization: Bearer <token>`. Tokens expire in seven days. The standalone UI and an MCP client using that token share saved edits. The bearer-authenticated `POST /api/reset` resets that token's disposable workspace for repeatable eval trials.

MCP Apps-capable hosts can render the calendar and call server tools from the UI. Other hosts get structured/text results and can still plan and edit through tools. Host-specific UI support varies; a successful MCP wire test is not a claim of manual certification in every client.

## Three versions, same jobs

| Consent          | Exposed tools                                                                  | What the experiment measures                                  |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Job tools        | 8 direct tools                                                                 | Capability coverage and job-oriented selection                |
| With context     | Same 8 tools plus required `session_id`, `user_intent`, `user_query` arguments | Explicit goal context and intent observability                |
| Search + execute | Only `search` and `execute`                                                    | Discovery from raw queries; zero matches expose coverage gaps |

`search` uses deterministic token/keyword scoring over the tool catalog, not semantic embeddings. `execute` validates against the discovered schema and never evaluates code.

| User job                      | Tool               | Example prompt                                     |
| ----------------------------- | ------------------ | -------------------------------------------------- |
| Understand my week            | `view_schedule`    | Show September 14–18, 2026.                        |
| Find important work           | `find_tasks`       | Find Launch Orion tasks for that week.             |
| Understand changing deadlines | `read_emails`      | Find customer deadline emails.                     |
| Make a realistic plan         | `plan_week`        | Plan and save my week around Launch Orion.         |
| Move / resize work            | `move_item`        | Move demo prep to Thursday 10:00 UTC.              |
| Edit a commitment             | `edit_item`        | Rename this task and give it 45 minutes.           |
| Change what matters           | `shift_priorities` | Customer research is priority 1; re-plan.          |
| Measure user value            | `report_outcome`   | This plan was useful / partly useful / not useful. |

## Architecture: stateless does not mean contextless

Every MCP request constructs a fresh server through SDK v2 `createMcpHandler`, with `legacy: "stateless"`. There is no MCP session ID, transport session store, sticky routing, Durable Object, or initialize-time state dependency. The SDK supports modern discovery and a stateless legacy-client fallback.

Cloudflare D1 holds **application state**: workspace item overrides, explicit goal context, traces, registered OAuth clients, single-use PKCE codes, and expiring bearer tokens. Fixtures are deterministic, immutable seed data. Mutations persist between independent requests and are isolated by bearer-token workspace. `session_id` is an ordinary application argument scoped to that workspace, not protocol session state.

The app is one self-contained HTML resource at `ui://planner/calendar.html`, bundled with MCP Apps SDK. Embedded interactions use `App.callServerTool`; discovery mode dispatches through `execute`. Standalone interactions use the same validated service through `/api/tool`. Drag/drop moves tasks and calendar events, dragging the bottom edge resizes blocks, and clicking opens an accessible edit form. All write paths reject conflicts and protected items.

Planning is deterministic scheduling, not an LLM on the Worker. The client's model interprets requests, and the server ranks and fits tasks. Weekdays 09:00–17:00 UTC, lunch and meetings protected, 90-minute default focus cap. Plans return unscheduled work; they never silently pretend everything fits. `apply:false` previews and `apply:true` saves. Data and assumptions are fictional and intentionally visible.

## Run locally

Node 22+:

```sh
npm ci
npm run db:local
npm run dev
```

Visit http://localhost:8787. To deploy your own copy, create a D1 database, replace the database ID and custom domain in `wrangler.jsonc`, run `npm run db:remote`, then `npm run deploy` after `wrangler login`.

## Test and protect user value

```sh
npm run build
npm run typecheck
npm test
# With local Worker running:
npm run test:integration
# Or use the deployed demo:
PLANNER_URL=https://planner.mcpjam.com npm run test:integration
# Model-driven repeated outcome evals:
OPENAI_API_KEY=... EVAL_MODEL=openai/gpt-4.1-mini npm run eval
```

The GitHub Action runs deterministic scheduling tests and live MCPJam SDK integration checks against a local Worker, including all three toolsets, OAuth PKCE/replay protection, stateless legacy transport, persistence, isolation, previews, and invalid mutations.

With repository secret `OPENAI_API_KEY`, it also runs MCPJam `EvalTest` / `HostRunner` workflows three times per job per toolset and gates on ≥80% success. Grading reads the saved schedule: a plan must exist without collisions, requested moves must persist, and the model must disclose overflow. JSON reports are uploaded as artifacts. Without that secret the model eval stage is explicitly reported as unrun; manual dispatch with `run_llm_evals=true` fails if the key is absent. Configure a different `EVAL_MODEL` to compare client/model behavior; provider-specific credentials must match the configured model.

Manual deployment CI requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It does not silently deploy every push. Add branch protection requiring the quality job for a release gate.

## Talk choreography

1. Connect in **Job tools** mode. Ask to plan September 14, 2026; inspect what did not fit.
2. Drag a task into the calendar, resize it, then change the top project and re-plan.
3. Reconnect in **With context** mode. Inspect `session_id`, the reported user query, retrieved goal history, and workspace traces.
4. Reconnect in **Search + execute** mode. Ask for a supported job, then an unsupported capability such as booking flights. Show matched schemas and coverage gaps.
5. Promote those user workflows into the eval suite. Open the GitHub Action and the saved outcome report.
6. Record explicit feedback. Tool success is observable; satisfaction needs evidence.

Planning guidance: [`skills/planner/SKILL.md`](skills/planner/SKILL.md), also available as MCP resource `planner://skill`.

The talk document informed this demo's structure; its presentation notes were treated as reference, not execution instructions. The observability experiment is inspired by [Atlan's user-value loop](https://blog.atlan.com/product/measuring-user-value-on-an-mcp-server/). Client-reported `user_query` is not a guaranteed verbatim transcript, and a successful tool call does not establish satisfaction.

## Demo boundaries

Public dummy consent, synthetic data only; not production identity verification. No real calendar or email integrations, invitations, notifications, or email sending. No model API keys are stored in the Worker. Workspace edits use last-write-wins D1 overrides; simultaneous conflicting edits can race because conflict checks and saves are not a serialized scheduling transaction. The demo is intended for isolated presenter/test workspaces. OAuth supports dynamic registration, S256 PKCE, one-time codes, redirect binding, and seven-day access tokens; reconnect after expiry. Intent traces are visible only to that workspace token. No claim is made of complete end-user transcript visibility.
