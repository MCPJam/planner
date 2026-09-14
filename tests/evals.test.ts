import { describe, it, expect } from "vitest";
import { MCPClientManager, HostRunner, EvalTest } from "@mcpjam/sdk";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { base, consent, api } from "./helpers";
const key = process.env.OPENAI_API_KEY;
const model = process.env.EVAL_MODEL ?? "openai/gpt-4.1-mini";
const guidance = await readFile(
  new URL("../skills/planner/SKILL.md", import.meta.url),
  "utf8"
);
// Missing credentials fail explicitly when `npm run eval` is requested.
if (!key)
  throw new Error(
    "OPENAI_API_KEY is required for LLM user-value evals. Deterministic MCP tests run with npm run test:integration."
  );
for (const mode of ["simple", "context", "discovery"])
  describe(`${mode} user-value evals`, () => {
    for (const job of ["plan", "move", "reprioritize"])
      it(
        job,
        async () => {
          const reports: unknown[] = [];
          const token = await consent(mode);
          const manager = new MCPClientManager();
          await manager.connectToServer("planner", {
            url: base + "/mcp",
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          });
          const runner = new HostRunner({
            tools: await manager.getToolsForAiSdk(["planner"]),
            model,
            apiKey: key!,
            systemPrompt: guidance,
            maxSteps: 10,
          });
          const test = new EvalTest({
            id: `${mode}-${job}`,
            name: `${mode}: ${job}`,
            test: async (iterationRunner) => {
              const reset = await fetch(base + "/api/reset", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!reset.ok)
                throw new Error("Could not reset isolated eval workspace");
              const extra =
                mode === "context"
                  ? {
                      session_id: "eval-check",
                      user_intent: "Verify planning outcome",
                      user_query:
                        "Check whether the requested outcome was achieved",
                    }
                  : {};
              try {
                const prompts = {
                  plan: "Plan and save the week of September 14, 2026, prioritizing Launch Orion. Use 09:00–17:00 UTC, keep existing meetings and lunch, cap focus at 90 minutes. Tell me what will not fit. You have permission to apply the plan.",
                  move: "Move task task-2026-09-14-0 to September 15, 2026 at 10:00 UTC for 60 minutes. Save that change now.",
                  reprioritize:
                    "Set Customer research to priority 1 for the week of September 14, 2026, then rebuild and save my week prioritizing Customer research. Work 09:00–17:00 UTC, protect meetings and lunch. Tell me what did not fit.",
                };
                const result = await iterationRunner.run(
                  prompts[job as keyof typeof prompts]
                );
                const snapshot = (
                  await api(token, "view_schedule", {
                    week: "2026-09-14",
                    ...extra,
                  })
                ).data;
                const tasks = snapshot.events.filter(
                  (x: any) => x.kind === "task"
                );
                const collisions = snapshot.events.some((a: any, i: number) =>
                  snapshot.events.some(
                    (b: any, j: number) =>
                      i < j &&
                      a.date === b.date &&
                      a.start < b.start + b.duration &&
                      b.start < a.start + a.duration
                  )
                );
                let passed = !collisions;
                if (job === "move")
                  passed &&= tasks.some(
                    (x: any) =>
                      x.id === "task-2026-09-14-0" &&
                      x.date === "2026-09-15" &&
                      x.start === 600 &&
                      x.duration === 60
                  );
                else {
                  passed &&=
                    tasks.length > 0 &&
                    snapshot.backlog.length > 0 &&
                    /unscheduled|not fit|didn.t fit|remain|overflow|backlog|couldn.t|cannot fit/i.test(
                      result.text
                    );
                  if (job === "reprioritize")
                    passed &&= tasks
                      .filter((x: any) => x.project === "Customer research")
                      .every((x: any) => x.priority === 1);
                }
                reports.push({
                  mode,
                  job,
                  model,
                  passed,
                  text: result.text,
                  toolCalls: result.getToolCalls(),
                  scheduled: tasks.length,
                  unscheduled: snapshot.backlog.length,
                  collisions,
                });
                return passed;
              } finally {
                /* The manager lives for this job; each trial resets its workspace. */
              }
            },
          });
          // Serial trials reset this job's isolated workspace; EvalTest clones the runner.
          try {
            await test.run(runner, {
              iterations: Number(process.env.EVAL_ITERATIONS ?? 3),
              concurrency: 1,
              timeoutMs: 120000,
            });
          } finally {
            await manager.disconnectServer("planner");
          }
          await mkdir("test-results", { recursive: true });
          await writeFile(
            `test-results/${mode}-${job}.json`,
            JSON.stringify({ accuracy: test.accuracy(), reports }, null, 2)
          );
          expect(test.accuracy()).toBeGreaterThanOrEqual(0.8);
        },
        420000
      );
  });
