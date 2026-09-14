import { App } from "@modelcontextprotocol/ext-apps";
import type { Item } from "../src/data";
type Snapshot = {
  week: string;
  dates: string[];
  events: Item[];
  backlog: Item[];
  mode: string;
  summary?: string;
  applied?: boolean;
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const embedded = window.parent !== window;
const fragment = new URLSearchParams(location.hash.slice(1));
let token =
  fragment.get("token") ?? sessionStorage.getItem("planner-token") ?? "";
let mode =
  fragment.get("mode") ?? sessionStorage.getItem("planner-mode") ?? "simple";
if (fragment.has("token")) {
  sessionStorage.setItem("planner-token", token);
  sessionStorage.setItem("planner-mode", mode);
  history.replaceState(null, "", location.pathname);
}
let state: Snapshot | null = null,
  busy = false,
  editing: Item | null = null;
const goal = crypto.randomUUID();
const app = new App(
  { name: "MCPJam Planner", version: "1.0.0" },
  {},
  { autoResize: true }
);
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(
    2,
    "0"
  )}`;
const status = (message: string, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
};
function accept(data: any) {
  if (data?.mode) {
    mode = data.mode;
    $("mode").textContent =
      mode === "discovery"
        ? "Search + execute"
        : mode === "context"
        ? "With context"
        : "Job tools";
  }
  if (data?.events && data?.dates) {
    state = data;
    render();
    status(data.summary ?? "");
  }
}
async function call(
  name: string,
  args: Record<string, unknown>,
  query: string
) {
  if (busy) throw new Error("Please wait for the current change.");
  busy = true;
  document
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((x) => (x.disabled = true));
  try {
    if (mode === "context")
      args = {
        ...args,
        session_id: goal,
        user_intent:
          name === "view_schedule"
            ? "Understand my week"
            : "Adjust my weekly plan",
        user_query: query,
      };
    let data: any;
    if (embedded) {
      const result = await app.callServerTool(
        mode === "discovery"
          ? { name: "execute", arguments: { name, arguments: args } }
          : { name, arguments: args }
      );
      if (result.isError)
        throw new Error(
          result.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join(" ") ?? "Tool failed"
        );
      data =
        result.structuredContent ??
        JSON.parse(
          (result.content?.find((c: any) => c.type === "text") as any)?.text ??
            "{}"
        );
    } else {
      const r = await fetch("/api/tool", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Request failed");
    }
    accept(data);
    $("activity").textContent = JSON.stringify(
      {
        tool: name,
        arguments: args,
        result: data.summary ?? data.updated ?? "Success",
      },
      null,
      2
    );
    return data;
  } finally {
    busy = false;
    document
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((x) => (x.disabled = false));
  }
}
const act = (fn: () => Promise<unknown>) =>
  void fn().catch((e) => status(e.message, true));
function render() {
  if (!state) return;
  const s = state;
  $<HTMLInputElement>("week").value = s.week;
  $("backlog-count").textContent = `(${s.backlog.length})`;
  const backlog = $("backlog");
  backlog.replaceChildren();
  for (const item of s.backlog) {
    const el = document.createElement("div");
    el.className = "task";
    el.draggable = true;
    el.tabIndex = 0;
    const title = document.createElement("strong");
    title.textContent = item.title.split(" · ")[0];
    const meta = document.createElement("small");
    meta.textContent = `${item.duration} min · ${item.project}`;
    el.append(title, meta);
    el.ondragstart = (e) => e.dataTransfer?.setData("text/plain", item.id);
    el.onclick = () => edit(item);
    el.onkeydown = (e) => {
      if (e.key === "Enter") edit(item);
    };
    backlog.append(el);
  }
  const calendar = $("calendar");
  calendar.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "day-head";
  empty.textContent = "UTC";
  calendar.append(empty);
  for (const date of s.dates) {
    const head = document.createElement("div");
    head.className = "day-head";
    head.textContent = new Date(date + "T12:00:00Z").toLocaleDateString(
      "en-US",
      { weekday: "short", timeZone: "UTC" }
    );
    const b = document.createElement("b");
    b.textContent = date.slice(5);
    head.append(b);
    calendar.append(head);
  }
  const times = document.createElement("div");
  times.className = "times";
  for (let hour = 9; hour < 17; hour++) {
    const h = document.createElement("div");
    h.className = "hour";
    h.textContent = `${hour}:00`;
    times.append(h);
  }
  calendar.append(times);
  for (const date of s.dates) {
    const day = document.createElement("div");
    day.className = "day";
    day.dataset.date = date;
    day.ondragover = (e) => e.preventDefault();
    day.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("text/plain");
      const start =
        540 +
        Math.max(
          0,
          Math.min(
            31,
            Math.floor((e.clientY - day.getBoundingClientRect().top) / 18)
          )
        ) *
          15;
      if (id)
        act(() =>
          call(
            "move_item",
            { id, date, start },
            `Move ${id} to ${date} at ${time(start)} UTC`
          )
        );
    };
    for (const item of s.events.filter((x) => x.date === date)) {
      const el = document.createElement("div");
      el.className = `event ${item.fixed ? "fixed" : ""} ${
        item.status === "done" ? "done" : ""
      }`;
      el.style.top = `${(item.start - 540) * 1.2}px`;
      el.style.height = `${item.duration * 1.2}px`;
      el.draggable = !item.fixed;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute(
        "aria-label",
        `${item.title}, ${time(item.start)}, ${item.duration} minutes${
          item.fixed ? ", protected" : ""
        }`
      );
      const small = document.createElement("small");
      small.textContent = `${time(item.start)}–${time(
        item.start + item.duration
      )}${item.fixed ? " · locked" : ""}`;
      const title = document.createElement("b");
      title.textContent = item.title.split(" · ")[0];
      el.append(small, title);
      el.ondragstart = (e) => e.dataTransfer?.setData("text/plain", item.id);
      el.onclick = () => {
        if (!item.fixed) edit(item);
        else status("This commitment is protected.");
      };
      el.onkeydown = (e) => {
        if (e.key === "Enter" && !item.fixed) edit(item);
      };
      if (!item.fixed) {
        const resize = document.createElement("div");
        resize.className = "resize";
        resize.title = "Drag to resize";
        resize.onpointerdown = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const y = e.clientY;
          resize.setPointerCapture(e.pointerId);
          resize.onpointermove = (ev) => {
            const duration = Math.max(
              15,
              Math.min(
                180,
                Math.round((item.duration + (ev.clientY - y) / 1.2) / 15) * 15
              )
            );
            el.style.height = `${duration * 1.2}px`;
          };
          resize.onpointerup = (ev) => {
            ev.stopPropagation();
            resize.onpointermove = null;
            resize.onpointerup = null;
            const duration = Math.max(
              15,
              Math.min(
                180,
                Math.round((item.duration + (ev.clientY - y) / 1.2) / 15) * 15
              )
            );
            act(() =>
              call(
                "move_item",
                { id: item.id, date: item.date, start: item.start, duration },
                `Resize ${item.title} to ${duration} minutes`
              ).catch((error) => {
                render();
                throw error;
              })
            );
          };
        };
        resize.onclick = (e) => e.stopPropagation();
        el.append(resize);
      }
      day.append(el);
    }
    calendar.append(day);
  }
}
function edit(item: Item) {
  editing = item;
  $<HTMLInputElement>("edit-title").value = item.title;
  $<HTMLInputElement>("edit-date").value = item.date;
  $<HTMLInputElement>("edit-time").value = time(item.start || 600);
  $<HTMLInputElement>("edit-duration").value = String(item.duration);
  $<HTMLDialogElement>("editor").showModal();
}
$("cancel-edit").onclick = () => $<HTMLDialogElement>("editor").close();
$("edit-form").onsubmit = (e) => {
  e.preventDefault();
  if (!editing) return;
  const item = editing;
  const [h, m] = $<HTMLInputElement>("edit-time").value.split(":").map(Number);
  act(async () => {
    await call(
      "edit_item",
      {
        id: item.id,
        title: $<HTMLInputElement>("edit-title").value,
        date: $<HTMLInputElement>("edit-date").value,
        start: h * 60 + m,
        duration: Number($<HTMLInputElement>("edit-duration").value),
      },
      `Edit ${item.title} using the calendar form`
    );
    $<HTMLDialogElement>("editor").close();
  });
};
const refresh = () =>
  call(
    "view_schedule",
    { week: $<HTMLInputElement>("week").value },
    "Show my selected week"
  );
$("week").onchange = () => act(refresh);
for (const [id, days] of [
  ["prev", -7],
  ["next", 7],
] as const)
  $(id).onclick = () => {
    const d = new Date($<HTMLInputElement>("week").value + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    $<HTMLInputElement>("week").value = d.toISOString().slice(0, 10);
    act(refresh);
  };
$("replan").onclick = () =>
  act(() =>
    call(
      "plan_week",
      {
        week: $<HTMLInputElement>("week").value,
        priorities: [$<HTMLSelectElement>("priority").value],
        apply: true,
      },
      `Re-plan my week with ${
        $<HTMLSelectElement>("priority").value
      } as the top priority`
    )
  );

$("copy-token").onclick = () =>
  act(async () => {
    await navigator.clipboard.writeText(token);
    status(
      "Bearer token copied. Paste it into your MCP client authorization header."
    );
  });
$("traces").onclick = () =>
  act(async () => {
    const r = await fetch("/api/traces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    $("activity").textContent = JSON.stringify(await r.json(), null, 2);
  });
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-rating]"
))
  button.onclick = () =>
    act(async () => {
      const rating = button.dataset.rating!;
      await call(
        "report_outcome",
        { rating, feedback: `User selected ${rating} in the planner UI` },
        `The plan was ${rating}`
      );
      status("Feedback recorded. Thank you.");
    });
app.ontoolresult = (result) => {
  if (result.isError) {
    status(
      result.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join(" ") ?? "Tool failed",
      true
    );
    return;
  }
  const data =
    result.structuredContent ??
    JSON.parse(
      (result.content?.find((c: any) => c.type === "text") as any)?.text ?? "{}"
    );
  accept(data);
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme)
    document.documentElement.classList.toggle("dark", ctx.theme === "dark");
};
if (embedded) {
  $("connection").hidden = true;
  $("reconnect").hidden = true;
  app
    .connect()
    .then(() => {
      const theme = app.getHostContext()?.theme;
      if (theme)
        document.documentElement.classList.toggle("dark", theme === "dark");
    })
    .catch((e) => status(`Could not connect to MCP host: ${e.message}`, true));
} else if (!token) {
  location.replace("/");
} else {
  $(
    "connect-info"
  ).textContent = `MCP endpoint: ${location.origin}/mcp · Token is scoped to this demo workspace.`;
  act(async () => {
    const r = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      sessionStorage.removeItem("planner-token");
      location.replace("/");
      return;
    }
    accept(await r.json());
    await refresh();
  });
}
