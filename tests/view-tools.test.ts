import {it,expect} from 'vitest';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/client';
import {registerViewTools} from '../ui/view-tools';
it('discovers and calls iframe view tools through the MCP Apps bridge without saving',async()=>{
 const app=new App({name:'test',version:'1'}, {tools:{listChanged:true}}, {autoResize:false});
 let previews=0;
 const dispose=registerViewTools(app,{
  state:()=>({week:'2026-09-14',pending:null}),
  move:args=>{previews++;return {pending:args,saved:false};},
  replan:async args=>{previews++;return {pending:args,saved:false};},
 });
 const bridge=new AppBridge(null,{name:'test-host',version:'1'},{});
 const [host,view]=InMemoryTransport.createLinkedPair();
 await bridge.connect(host);
 await app.connect(view);
 try {
  expect(bridge.getAppCapabilities()?.tools).toBeDefined();
  expect((await bridge.listTools({})).tools.map(t=>t.name)).toEqual(['planner_get_view_state','planner_preview_move','planner_preview_replan']);
  const state=await bridge.callTool({name:'planner_get_view_state',arguments:{}});
  expect(JSON.stringify(state)).toContain('2026-09-14');
  const move=await bridge.callTool({name:'planner_preview_move',arguments:{id:'event-1',date:'2026-09-15',start:600,duration:60}});
  expect(JSON.stringify(move)).toContain('saved');
  expect(move.isError).not.toBe(true);
  await expect(bridge.callTool({name:'planner_preview_move',arguments:{id:'event-1',date:'bad',start:607}})).rejects.toThrow('Invalid input');
  expect(previews).toBe(1);
  const plan=await bridge.callTool({name:'planner_preview_replan',arguments:{priorities:['Launch']}});
  expect(plan.isError).not.toBe(true);
  expect(previews).toBe(2);
  dispose();
  expect((await bridge.listTools({})).tools).toHaveLength(0);
 } finally {await app.close();await bridge.close();}
});
