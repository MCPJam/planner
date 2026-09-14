import { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
export type ViewAdapter = {
  state(): Record<string, unknown>;
  move(args: {id: string; date: string; start: number; duration?: number}): unknown;
  replan(args: {priorities: string[]; max_focus_minutes: number}): Promise<unknown>;
};
export function registerViewTools(app: App, adapter: ViewAdapter) {
  let active = true;
  const run = async (fn: () => unknown) => {
    try {
      if (!active) throw new Error('Planner view is closed. Open the calendar again.');
      const data = await fn();
      return {content: [{type: 'text' as const, text: JSON.stringify(data)}]};
    } catch (error) {
      return {isError: true, content: [{type: 'text' as const, text: error instanceof Error ? error.message : 'Preview failed'}]};
    }
  };
  const handles = [
    app.registerTool('planner_get_view_state', {
      description: 'Read the currently displayed week, visible item IDs and pending confirmation from this planner view. No server request.',
      inputSchema: z.object({}), annotations: {readOnlyHint: true},
    }, () => run(() => adapter.state())),
    app.registerTool('planner_preview_move', {
      description: 'Preview moving or resizing a visible item. Opens the user confirmation dialog; never saves. start is minutes after midnight UTC. Read view state for IDs first.',
      inputSchema: z.object({id: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.number().int().min(540).max(1005).multipleOf(15), duration: z.number().int().min(15).max(180).multipleOf(15).optional()}),
      annotations: {destructiveHint: false},
    }, args => run(() => adapter.move(args))),
    app.registerTool('planner_preview_replan', {
      description: 'Preview a re-plan of the visible week. Fetches a server plan with apply=false and displays it for user confirmation. Never saves; report remaining unscheduled work.',
      inputSchema: z.object({priorities: z.array(z.string().min(1).max(100)).max(5).default([]), max_focus_minutes: z.number().int().min(30).max(180).default(90)}),
      annotations: {destructiveHint: false},
    }, args => run(() => adapter.replan(args))),
  ];
  return () => { active = false; handles.forEach(handle => handle.remove()); };
}
