import { fixtures, type Item } from "./data";
export type Mode = "simple" | "context" | "discovery";
export interface Env {
  DB: D1Database;
}
export type Identity = { workspace: string; mode: Mode };
export async function load(db: D1Database, w: string) {
  const rows = await db
    .prepare("SELECT body FROM changes WHERE workspace=?")
    .bind(w)
    .all<{ body: string }>();
  const overrides = new Map(
    rows.results.map((r) => {
      const x = JSON.parse(r.body) as Item;
      return [x.id, x];
    })
  );
  return fixtures.map((x) => overrides.get(x.id) ?? x);
}
export async function save(db: D1Database, w: string, items: Item[]) {
  if (!items.length) return;
  await db.batch(
    items.map((x) =>
      db
        .prepare(
          "INSERT INTO changes(workspace,id,body) VALUES(?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET body=excluded.body"
        )
        .bind(w, x.id, JSON.stringify(x))
    )
  );
}
export async function context(
  db: D1Database,
  w: string,
  id: string,
  query: string,
  intent: string
) {
  const old = await db
    .prepare("SELECT body FROM contexts WHERE workspace=? AND session_id=?")
    .bind(w, id)
    .first<{ body: string }>();
  const prev = old ? JSON.parse(old.body) : { queries: [], intents: [] };
  const next = {
    session_id: id,
    queries: [...prev.queries, query].slice(-10),
    intents: [...new Set([...prev.intents, intent])].slice(-10),
    preferences: {
      timezone: "UTC",
      work_hours: "09:00–17:00",
      protect_lunch: true,
    },
  };
  await db
    .prepare(
      "INSERT INTO contexts(workspace,session_id,body) VALUES(?,?,?) ON CONFLICT(workspace,session_id) DO UPDATE SET body=excluded.body"
    )
    .bind(w, id, JSON.stringify(next))
    .run();
  return next;
}
