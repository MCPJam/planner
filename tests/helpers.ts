export const base = process.env.PLANNER_URL ?? "http://localhost:8787";
export async function consent(mode: string) {
  const r = await fetch(base + "/consent", {
    method: "POST",
    body: new URLSearchParams({ mode }),
    redirect: "manual",
  });
  if (r.status !== 302) throw new Error("Consent failed: " + (await r.text()));
  return new URLSearchParams(
    new URL(r.headers.get("location")!).hash.slice(1)
  ).get("token")!;
}
export async function api(
  token: string,
  name: string,
  args: Record<string, unknown>
) {
  const r = await fetch(base + "/api/tool", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  return { status: r.status, data: (await r.json()) as any };
}
