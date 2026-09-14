import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const css=await readFile('design-system/src/tokens.css','utf8')+'\n'+await readFile('ui/style.css','utf8');
const result=await build({entryPoints:['ui/app.ts'],bundle:true,format:'esm',platform:'browser',write:false,minify:true,target:'es2022'});
for(const page of ['app','landing']){let html=await readFile(`ui/${page}.html`,'utf8');html=html.replace('/*CSS*/',()=>css);if(page==='app')html=html.replace('/*JS*/',()=>result.outputFiles[0].text.replaceAll('</script','<\\/script'));await writeFile(`dist/${page}.html`,html);}
console.log('Built self-contained MCP App and consent page.');
