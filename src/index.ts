import { handleMcp, runTool } from "./tools";
import { type Env, type Identity, type Mode } from "./store";
import { fixtures } from "./data";
import appHtml from "../dist/app.html";
import landingHtml from "../dist/landing.html";
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const random = () =>
  crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
const validRedirect = (s: string) => {
  try {
    const u = new URL(s);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
};
const modes: Mode[] = ["simple", "context", "discovery"];
async function issue(env: Env, mode: Mode, workspace = crypto.randomUUID()) {
  const token = random();
  await env.DB.prepare(
    "INSERT INTO tokens(token,workspace,mode,expires) VALUES(?,?,?,?)"
  )
    .bind(token, workspace, mode, Date.now() + 7 * 86400000)
    .run();
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: 604800,
    scope: mode,
    workspace,
    mode,
  };
}
async function identity(request: Request, env: Env): Promise<Identity | null> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT workspace,mode FROM tokens WHERE token=? AND expires>?"
  )
    .bind(token, Date.now())
    .first<{ workspace: string; mode: Mode }>();
  return row ?? null;
}
async function authInput(p: URLSearchParams, env: Env) {
  const client = await env.DB.prepare("SELECT body FROM clients WHERE id=?")
    .bind(p.get("client_id") ?? "")
    .first<{ body: string }>();
  if (!client) throw new Error("Register an OAuth client first.");
  const redirect = p.get("redirect_uri") ?? "";
  if (!JSON.parse(client.body).redirect_uris.includes(redirect))
    throw new Error("Unregistered redirect URI");
  if (
    p.get("response_type") !== "code" ||
    p.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(p.get("code_challenge") ?? "")
  )
    throw new Error("Authorization code with PKCE S256 is required");
  return redirect;
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    origin = url.origin,
    path = url.pathname;
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Expose-Headers":
          "WWW-Authenticate, MCP-Protocol-Version",
      },
    });
  if (path === "/health")
    return json({
      ok: true,
      server: "MCPJam Planner",
      sdk: "2.0.0",
      stateless: true,
      records: fixtures.length,
    });
  if (
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp"
  )
    return json({
      resource: origin + "/mcp",
      authorization_servers: [origin],
      scopes_supported: modes,
      bearer_methods_supported: ["header"],
    });
  if (
    path === "/.well-known/oauth-authorization-server" ||
    path === "/.well-known/oauth-authorization-server/mcp"
  )
    return json({
      issuer: origin,
      authorization_endpoint: origin + "/authorize",
      token_endpoint: origin + "/token",
      registration_endpoint: origin + "/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: modes,
    });
  if (path === "/register" && request.method === "POST") {
    const body = (await request.json()) as any;
    if (
      !Array.isArray(body.redirect_uris) ||
      !body.redirect_uris.length ||
      body.redirect_uris.length > 10 ||
      !body.redirect_uris.every(
        (x: unknown) => typeof x === "string" && validRedirect(x)
      )
    )
      return json({ error: "invalid_redirect_uri" }, 400);
    const id = crypto.randomUUID();
    const client = {
      client_id: id,
      client_name: String(body.client_name ?? "Demo MCP client").slice(0, 100),
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    };
    await env.DB.prepare("INSERT INTO clients(id,body) VALUES(?,?)")
      .bind(id, JSON.stringify(client))
      .run();
    return json(client, 201);
  }
  if (path === "/authorize" && request.method === "GET") {
    try {
      await authInput(url.searchParams, env);
    } catch (e) {
      return json(
        { error: "invalid_request", error_description: String(e) },
        400
      );
    }
    return new Response(landingHtml, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (path === "/consent" && request.method === "POST") {
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== origin
    )
      return json({ error: "invalid_origin" }, 403);
    const form = await request.formData();
    const mode = String(form.get("mode")) as Mode;
    if (!modes.includes(mode)) return json({ error: "invalid_scope" }, 400);
    const oauth = String(form.get("oauth") ?? "");
    if (oauth) {
      const p = new URLSearchParams(oauth);
      let redirect: string;
      try {
        redirect = await authInput(p, env);
      } catch (e) {
        return json(
          { error: "invalid_request", error_description: String(e) },
          400
        );
      }
      const code = random();
      await env.DB.prepare("INSERT INTO codes(code,body,expires) VALUES(?,?,?)")
        .bind(
          code,
          JSON.stringify({
            client_id: p.get("client_id"),
            redirect_uri: redirect,
            challenge: p.get("code_challenge"),
            mode,
          }),
          Date.now() + 300000
        )
        .run();
      const next = new URL(redirect);
      next.searchParams.set("code", code);
      if (p.has("state")) next.searchParams.set("state", p.get("state")!);
      return request.headers.get("Accept")?.includes("application/json")
        ? json({ redirect: next.toString() })
        : Response.redirect(next.toString(), 302);
    }
    const token = await issue(env, mode);
    const redirect =
      origin +
      "/app#" +
      new URLSearchParams({ token: token.access_token, mode });
    return request.headers.get("Accept")?.includes("application/json")
      ? json({ redirect })
      : Response.redirect(redirect, 302);
  }
  if (path === "/token" && request.method === "POST") {
    const p = new URLSearchParams(await request.text());
    if (p.get("grant_type") !== "authorization_code")
      return json({ error: "unsupported_grant_type" }, 400);
    const row = await env.DB.prepare(
      "DELETE FROM codes WHERE code=? AND expires>? RETURNING body"
    )
      .bind(p.get("code") ?? "", Date.now())
      .first<{ body: string }>();
    if (!row) return json({ error: "invalid_grant" }, 400);
    const c = JSON.parse(row.body);
    const verifier = p.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
      return json({ error: "invalid_grant" }, 400);
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    if (
      c.client_id !== p.get("client_id") ||
      c.redirect_uri !== p.get("redirect_uri") ||
      c.challenge !== challenge
    )
      return json({ error: "invalid_grant" }, 400);
    return json(await issue(env, c.mode));
  }
  if (path === "/" || path === "/app")
    return new Response(path === "/app" ? appHtml : landingHtml, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  if (path === "/mcp" || path.startsWith("/api/")) {
    const who = await identity(request, env);
    if (!who)
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
    if (path === "/mcp") return handleMcp(request, env, who);
    if (path === "/api/me") return json(who);
    if (path === "/api/reset" && request.method === "POST") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM changes WHERE workspace=?").bind(
          who.workspace
        ),
        env.DB.prepare("DELETE FROM contexts WHERE workspace=?").bind(
          who.workspace
        ),
      ]);
      return json({ reset: true });
    }
    if (path === "/api/traces") {
      const traces = await env.DB.prepare(
        "SELECT tool,session_id,user_query,user_intent,outcome,created_at FROM traces WHERE workspace=? ORDER BY created_at DESC LIMIT 50"
      )
        .bind(who.workspace)
        .all();
      return json({ traces: traces.results });
    }
    if (path === "/api/tool" && request.method === "POST") {
      const body = (await request.json()) as any;
      try {
        return json(await runTool(body.name, body.arguments ?? {}, env, who));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 400);
      }
    }
  }
  return json({ error: "not_found" }, 404);
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      const response = await route(request, env);
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set(
        "Access-Control-Expose-Headers",
        "WWW-Authenticate, MCP-Protocol-Version"
      );
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error(
        "planner_request_failed",
        error instanceof Error ? error.message : "unknown"
      );
      return json({ error: "request_failed" }, 500);
    }
  },
};
