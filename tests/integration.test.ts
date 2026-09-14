import { it, expect, describe } from "vitest";
import { MCPClientManager } from "@mcpjam/sdk";
import { base, consent, api } from "./helpers";
describe("Stateless MCP wire + persisted user outcomes", () => {
  for (const mode of ["simple", "context", "discovery"])
    it(`${mode}: consent, discover, execute, resource`, async () => {
      const token = await consent(mode);
      const manager = new MCPClientManager();
      try {
        await manager.connectToServer("planner", {
          url: base + "/mcp",
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        const tools = await manager.listTools("planner");
        expect(tools.tools.length).toBe(mode === "discovery" ? 2 : 8);
        const args = {
          week: "2026-09-14",
          ...(mode === "context"
            ? {
                session_id: "goal-1",
                user_intent: "Plan my week",
                user_query: "Show my calendar",
              }
            : {}),
        };
        const result = await manager.executeTool(
          "planner",
          mode === "discovery" ? "execute" : "view_schedule",
          mode === "discovery"
            ? { name: "view_schedule", arguments: args }
            : args
        );
        expect(result.isError).not.toBe(true);
        const data = result.structuredContent as any;
        expect(data.events.length).toBe(20);
        if (mode === "context")
          expect(data.fetched_context.session_id).toBe("goal-1");
        if (mode === "discovery") {
          const search = await manager.executeTool("planner", "search", {
            query: "drag my calendar event",
          });
          expect(JSON.stringify(search)).toContain("move_item");
        }
        const resource = await manager.readResource("planner", {
          uri: "ui://planner/calendar.html",
        });
        expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
        expect(String("text" in resource.contents[0] ? resource.contents[0].text : "")).toContain("Re-plan week");
        const resources = await manager.listResources("planner");
        expect(JSON.stringify(resources)).toContain(
          "ui://planner/calendar.html"
        );
      } finally {
        await manager.disconnectServer("planner");
      }
    }, 30000);
  it("preview does not save, applied plan persists, workspaces are isolated", async () => {
    const a = await consent("simple"),
      b = await consent("simple");
    const preview = await api(a, "plan_week", {
      week: "2026-09-14",
      apply: false,
    });
    expect(preview.data.applied).toBe(false);
    expect(
      (await api(a, "view_schedule", { week: "2026-09-14" })).data.events.length
    ).toBe(20);
    const applied = await api(a, "plan_week", {
      week: "2026-09-14",
      apply: true,
      priorities: ["Launch Orion"],
    });
    expect(applied.data.unscheduled.length).toBeGreaterThan(0);
    expect(
      (await api(a, "view_schedule", { week: "2026-09-14" })).data.events.length
    ).toBeGreaterThan(20);
    expect(
      (await api(b, "view_schedule", { week: "2026-09-14" })).data.events.length
    ).toBe(20);
  });
  it("rejects protected moves, conflicts, invalid dates, and missing context before mutation", async () => {
    const a = await consent("simple");
    expect(
      (
        await api(a, "move_item", {
          id: "event-2026-09-14-0",
          date: "2026-09-14",
          start: 600,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await api(a, "move_item", {
          id: "task-2026-09-14-0",
          date: "2026-09-14",
          start: 540,
        })
      ).status
    ).toBe(400);
    expect((await api(a, "view_schedule", { week: "2026-02-31" })).status).toBe(
      400
    );
    const c = await consent("context");
    expect(
      (await api(c, "plan_week", { week: "2026-09-14", apply: true })).status
    ).toBe(400);
  });
  it("does not require or issue an MCP transport session", async () => {
    const token = await consent("simple");
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1" },
        },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.headers.get("mcp-session-id")).toBeNull();
    expect(
      (
        await fetch(base + "/mcp", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status
    ).toBe(405);
  });
  it("requires authorization", async () =>
    expect((await fetch(base + "/mcp", { method: "POST" })).status).toBe(401));
  it("exchanges PKCE codes once and rejects arbitrary redirect URIs", async () => {
    const verifier = "a".repeat(43);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    const challenge = Buffer.from(hash).toString("base64url");
    const redirect = "http://localhost:12345/callback";
    const client = (await (
      await fetch(base + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirect] }),
      })
    ).json()) as any;
    const p = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "preserve-me",
    });
    const approved = await fetch(base + "/consent", {
      method: "POST",
      body: new URLSearchParams({ mode: "context", oauth: p.toString() }),
      redirect: "manual",
    });
    const location = new URL(approved.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe("preserve-me");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: redirect,
      code: location.searchParams.get("code")!,
      code_verifier: verifier,
    });
    const exchanged = await fetch(base + "/token", { method: "POST", body });
    expect(exchanged.status).toBe(200);
    expect(((await exchanged.json()) as any).scope).toBe("context");
    expect(
      (await fetch(base + "/token", { method: "POST", body })).status
    ).toBe(400);
    p.set("redirect_uri", "https://evil.example/callback");
    expect((await fetch(base + "/authorize?" + p)).status).toBe(400);
  });
});
