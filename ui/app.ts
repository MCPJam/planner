import { registerViewTools } from "./view-tools";
import { App } from "@modelcontextprotocol/ext-apps";
import type { Item } from "../src/data";
import { snapStart, proposedIssue, minutes } from "./scheduling";
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
  embedded ? "" : fragment.get("token") ?? sessionStorage.getItem("planner-token") ?? "";
let mode =
  embedded ? "simple" : fragment.get("mode") ?? sessionStorage.getItem("planner-mode") ?? "simple";
if (!embedded && fragment.has("token")) {
  sessionStorage.setItem("planner-token", token);
  sessionStorage.setItem("planner-mode", mode);
  history.replaceState(null, "", location.pathname);
}
let state: Snapshot | null = null,
  busy = false,
  editing: Item | null = null;
let dragged: Item | null = null;
let grabOffset = 0;
let editAction: "edit" | "move" | "resize" | "schedule" = "edit";
let preview: Item | null = null;
let pendingPlan: {snapshot: Snapshot; args: Record<string, unknown>} | null = null;
let contextTimer: ReturnType<typeof setTimeout>;
function viewState(): Record<string, unknown> {
  const compact = (item: Item) => ({id:item.id,title:item.title,date:item.date,start:item.start,duration:item.duration,fixed:item.fixed,project:item.project});
  const displayed = pendingPlan?.snapshot ?? state;
  return {week: displayed?.week, timezone:"UTC", busy, events: displayed?.events.map(compact) ?? [], backlog: displayed?.backlog.map(compact) ?? [], pending: pendingPlan ? {type:"replan",saved:false,summary:pendingPlan.snapshot.summary} : editing ? {type:"move",saved:false,item:editCandidate(),issue:proposedIssue(editCandidate()!,state?.events ?? [])} : null};
}
function syncContext() {
  clearTimeout(contextTimer);
  contextTimer = setTimeout(() => {
    if (embedded && app.getHostCapabilities()?.updateModelContext)
      void app.updateModelContext({content:[{type:"text",text:JSON.stringify(viewState())}]}).catch(() => {});
  }, 150);
}
function requireAvailable() {
  if (!state) throw new Error("Open a week with view_schedule first.");
  if (busy || editing || pendingPlan || dragged) throw new Error("Finish or cancel the current preview first.");
}
async function previewReplan(options: {priorities:string[];max_focus_minutes:number}) {
  requireAvailable();
  const args = {week:state!.week,...options};
  const snapshot = await call("plan_week",{...args,apply:false},"Preview my weekly plan",false);
  pendingPlan = {snapshot,args};
  $("plan-preview").hidden = false;
  $("plan-summary").textContent = snapshot.summary;
  render();
  syncContext();
  return viewState();
}
const guideDefault = "Drag to move · Pull the bottom edge to resize";
const goal = crypto.randomUUID();
const app = new App(
  { name: "MCPJam Planner", version: "1.0.0" },
  { tools: { listChanged: true } },
  { autoResize: true }
);
const disposeViewTools = registerViewTools(app, {
  state: viewState,
  move(args) {
    requireAvailable();
    const item = [...state!.events,...state!.backlog].find(x => x.id === args.id);
    if (!item || item.fixed) throw new Error("Choose a visible, movable item.");
    if (!state!.dates.includes(args.date)) throw new Error("Choose a date in the visible week.");
    const candidate = {...item,...args};
    const issue = proposedIssue(candidate,state!.events);
    if (issue) throw new Error(issue);
    edit(item,candidate,"move");
    return viewState();
  },
  replan: previewReplan,
});
app.onteardown = async () => {clearTimeout(contextTimer);disposeViewTools();return {};};
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
    pendingPlan = null;
    $("plan-preview").hidden = true;
    state = data;
    render();
    status(data.summary ?? "");
    syncContext();
    if ($<HTMLDialogElement>("editor").open) validateEdit();
  }
}
async function call(
  name: string,
  args: Record<string, unknown>,
  query: string,
  acceptResult = true
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
    if (acceptResult) accept(data);
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
    syncContext();
    document
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((x) => (x.disabled = false));
    if ($<HTMLDialogElement>("editor").open) validateEdit();
  }
}
const act = (fn: () => Promise<unknown>) =>
  void fn().catch((e) => status(e.message, true));
function render() {
  if (!state) return;
  const s = pendingPlan?.snapshot ?? state;
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
    wireDrag(el, item, true);
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
    day.ondragover = (e) => {
      if (!dragged || busy || pendingPlan) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = day.getBoundingClientRect();
      showPreview({
        ...dragged,
        date,
        start: snapStart(
          e.clientY,
          rect.top,
          rect.height,
          dragged.duration,
          grabOffset
        ),
      });
    };
    day.ondragleave = (e) => {
      if (
        !day.contains(e.relatedTarget as Node | null) &&
        !$<HTMLDialogElement>("editor").open
      )
        clearPreview();
    };
    day.ondrop = (e) => {
      e.preventDefault();
      if (!dragged || busy || pendingPlan) return;
      const rect = day.getBoundingClientRect();
      const candidate = {
        ...dragged,
        date,
        start: snapStart(
          e.clientY,
          rect.top,
          rect.height,
          dragged.duration,
          grabOffset
        ),
      };
      edit(dragged, candidate, dragged.start ? "move" : "schedule");
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
      if (!item.fixed) wireDrag(el, item);
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
          if (busy || pendingPlan) return;
          e.stopPropagation();
          e.preventDefault();
          const y = e.clientY;
          const scale = day.getBoundingClientRect().height / 480;
          resize.setPointerCapture(e.pointerId);
          el.classList.add("drag-source");
          let candidate = { ...item };
          showPreview(candidate);
          resize.onpointermove = (ev) => {
            const duration = Math.max(
              15,
              Math.min(
                180,
                1020 - item.start,
                Math.round((item.duration + (ev.clientY - y) / scale) / 15) * 15
              )
            );
            candidate = { ...item, duration };
            showPreview(candidate);
          };
          const cleanup = () => {
            resize.onpointermove = null;
            resize.onpointerup = null;
            resize.onpointercancel = null;
            el.classList.remove("drag-source");
          };
          resize.onpointerup = (ev) => {
            ev.stopPropagation();
            cleanup();
            if (candidate.duration !== item.duration)
              edit(item, candidate, "resize");
            else clearPreview();
          };
          resize.onpointercancel = () => {
            cleanup();
            clearPreview();
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
function wireDrag(el: HTMLElement, item: Item, backlog = false) {
  el.ondragstart = (e) => {
    if (busy || pendingPlan || $<HTMLDialogElement>("editor").open) {
      e.preventDefault();
      return;
    }
    dragged = item;
    grabOffset = backlog
      ? 0
      : Math.max(
          0,
          (e.clientY - el.getBoundingClientRect().top) /
            (el.parentElement!.getBoundingClientRect().height / 480)
        );
    e.dataTransfer?.setData("text/plain", item.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    el.classList.add("drag-source");
    $("calendar").classList.add("dragging");
    $("drag-guide").textContent = "Drop on a time slot to review the change";
  };
  el.ondragend = () => {
    dragged = null;
    el.classList.remove("drag-source");
    $("calendar").classList.remove("dragging");
    if (!$<HTMLDialogElement>("editor").open) clearPreview();
  };
}
function clearPreview() {
  preview = null;
  document.querySelectorAll(".drop-preview").forEach((x) => x.remove());
  document
    .querySelectorAll(".drop-target")
    .forEach((x) => x.classList.remove("drop-target"));
  $("drag-guide").textContent = guideDefault;
}
function showPreview(item: Item) {
  preview = item;
  const day = Array.from(document.querySelectorAll<HTMLElement>(".day")).find(
    (x) => x.dataset.date === item.date
  );
  document
    .querySelectorAll(".drop-target")
    .forEach((x) => x.classList.remove("drop-target"));
  let ghost = document.querySelector<HTMLElement>(".drop-preview");
  if (!day) {
    ghost?.remove();
    return;
  }
  if (!ghost) {
    ghost = document.createElement("div");
    ghost.className = "drop-preview";
    ghost.setAttribute("aria-hidden", "true");
  }
  const issue = proposedIssue(item, state?.events ?? []);
  ghost.classList.toggle("conflict", !!issue);
  ghost.style.top = `${((item.start - 540) / 480) * 100}%`;
  ghost.style.height = `${(item.duration / 480) * 100}%`;
  ghost.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = `${time(item.start)}–${time(item.start + item.duration)}`;
  const name = document.createElement("span");
  name.textContent = item.title.split(" · ")[0];
  const detail = document.createElement("small");
  detail.textContent = issue ? "Time conflict" : `${item.duration} min`;
  ghost.append(label, name, detail);
  day.append(ghost);
  day.classList.add("drop-target");
  $("drag-guide").textContent = `${item.date} · ${time(item.start)}–${time(
    item.start + item.duration
  )} · ${item.duration} min${issue ? " · Time conflict" : ""}`;
}
function edit(
  item: Item,
  candidate: Item = { ...item, start: item.start || 600 },
  action: typeof editAction = "edit"
) {
  if (busy || pendingPlan || $<HTMLDialogElement>("editor").open) return;
  editing = item;
  editAction = action;
  $("editor-heading").textContent =
    action === "move"
      ? "Move event"
      : action === "resize"
      ? "Resize event"
      : !item.start
      ? "Schedule task"
      : "Edit event";
  $("edit-before").textContent = item.start
    ? `From ${item.date} · ${time(item.start)}–${time(
        item.start + item.duration
      )}`
    : "Unscheduled task";
  $<HTMLInputElement>("edit-title").value = item.title;
  $<HTMLInputElement>("edit-date").value = candidate.date;
  $<HTMLInputElement>("edit-time").value = time(candidate.start);
  $<HTMLInputElement>("edit-duration").value = String(candidate.duration);
  $<HTMLInputElement>("edit-end").value = time(
    candidate.start + candidate.duration
  );
  $("save-edit").textContent =
    action === "move"
      ? "Confirm move"
      : action === "resize"
      ? "Confirm duration"
      : !item.start
      ? "Schedule"
      : "Save changes";
  $<HTMLDialogElement>("editor").showModal();
  validateEdit();
}
function editCandidate(): Item | null {
  if (!editing) return null;
  return {
    ...editing,
    title: $<HTMLInputElement>("edit-title").value,
    date: $<HTMLInputElement>("edit-date").value,
    start: minutes($<HTMLInputElement>("edit-time").value),
    duration: Number($<HTMLInputElement>("edit-duration").value),
  };
}
function validateEdit() {
  const candidate = editCandidate();
  if (!candidate) return false;
  const issue = !candidate.title.trim()
    ? "Enter a title."
    : proposedIssue(candidate, state?.events ?? []);
  $("edit-error").textContent = issue;
  $<HTMLButtonElement>("save-edit").disabled = busy || !!issue;
  $("edit-summary").textContent =
    Number.isFinite(candidate.start) && Number.isFinite(candidate.duration)
      ? `${time(candidate.start)}–${time(
          candidate.start + candidate.duration
        )} · ${candidate.duration} minutes total`
      : "Choose a start time and duration";
  if (
    !issue ||
    (Number.isFinite(candidate.start) &&
      candidate.duration >= 15 &&
      candidate.duration <= 180)
  )
    showPreview(candidate);
  else clearPreview();
  document
    .querySelectorAll<HTMLButtonElement>("[data-duration]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(Number(b.dataset.duration) === candidate.duration)
      )
    );
  syncContext();
  return !issue;
}
for (const id of ["edit-date", "edit-title"])
  $(id).oninput = () => validateEdit();
for (const id of ["edit-time", "edit-duration"])
  $(id).oninput = () => {
    const candidate = editCandidate();
    $<HTMLInputElement>("edit-end").value =
      candidate && Number.isFinite(candidate.start + candidate.duration)
        ? time(candidate.start + candidate.duration)
        : "";
    validateEdit();
  };
$("edit-end").oninput = () => {
  $<HTMLInputElement>("edit-duration").value = String(
    minutes($<HTMLInputElement>("edit-end").value) -
      minutes($<HTMLInputElement>("edit-time").value)
  );
  validateEdit();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-duration]"
))
  button.onclick = () => {
    $<HTMLInputElement>("edit-duration").value = button.dataset.duration!;
    const candidate = editCandidate();
    if (candidate)
      $<HTMLInputElement>("edit-end").value = time(
        candidate.start + candidate.duration
      );
    validateEdit();
  };
$("cancel-edit").onclick = () => {
  if (!busy) $<HTMLDialogElement>("editor").close();
};
$("editor").addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
$("editor").addEventListener("close", () => {
  editing = null;
  clearPreview();
  syncContext();
});
$("edit-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!validateEdit()) return;
  const candidate = editCandidate()!;
  const action = editAction;
  try {
    await call(
      "edit_item",
      {
        id: candidate.id,
        title: candidate.title,
        date: candidate.date,
        start: candidate.start,
        duration: candidate.duration,
      },
      `${action} ${candidate.title} to ${candidate.date}, ${time(
        candidate.start
      )}–${time(candidate.start + candidate.duration)} UTC (${
        candidate.duration
      } minutes)`
    );
    $<HTMLDialogElement>("editor").close();
    status(
      `Saved · ${candidate.date} · ${time(candidate.start)}–${time(
        candidate.start + candidate.duration
      )} · ${candidate.duration} min`
    );
  } catch (error) {
    $("edit-error").textContent =
      error instanceof Error ? error.message : "Could not save. Try again.";
  }
};
const refresh = async () => {
  if (pendingPlan || editing) throw new Error("Finish or cancel the preview first.");
  return call(
    "view_schedule",
    { week: $<HTMLInputElement>("week").value },
    "Show my selected week"
  );
};
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
$("replan").onclick = () => act(() => previewReplan({priorities:[$<HTMLSelectElement>("priority").value],max_focus_minutes:90}));
$("cancel-plan").onclick = () => {pendingPlan=null;$("plan-preview").hidden=true;render();syncContext();};
$("save-plan").onclick = () => act(async () => {
  if (!pendingPlan) return;
  await call("plan_week",{...pendingPlan.args,apply:true},"User confirmed the displayed re-plan");
});

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
