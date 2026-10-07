import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root=new URL('../',import.meta.url); const read=(p)=>readFileSync(new URL(p,root),'utf8'); const checks=[]; const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name)};
const manifest=JSON.parse(read('.claude-plugin/plugin.json'));
check('manifest name',manifest.name==='ruflo-ai-team');
check('manifest semver',/^\d+\.\d+\.\d+$/.test(manifest.version));
check('manifest keywords',manifest.keywords?.includes('ruvector'));
check('no component arrays',!manifest.skills&&!manifest.commands&&!manifest.agents);
for(const dir of ['skills','commands','agents','docs/adrs'])check(`${dir} exists`,existsSync(new URL(dir,root)));
check('README v3.48 pin',read('README.md').includes('v3.48'));
check('README namespace',read('README.md').includes('Namespace coordination'));
check('ADR proposed',read('docs/adrs/0001-multitenant-service-boundary.md').includes('Status: Proposed'));
check('six skills',readdirSync(new URL('skills/',root),{withFileTypes:true}).filter((entry)=>entry.isDirectory()).length===6);
check('four agents',readdirSync(new URL('agents/',root)).filter((name)=>name.endsWith('.md')).length===4);
check('four commands',readdirSync(new URL('commands/',root)).filter((name)=>name.endsWith('.md')).length===4);
const server=read('src/server.mjs');
check('fourteen MCP tools',(server.match(/mcp\.tool\('/g)||[]).length+(server.match(/mcp\.registerTool\('/g)||[]).length===14);
check('explicit annotation factories',server.includes('readOnlyHint: true')&&server.includes('readOnlyHint: false')&&server.includes('destructiveHint: false')&&server.includes('idempotentHint:')&&server.includes('openWorldHint: false'));
// mod (ADR-445 pattern)
const hooksJson=JSON.parse(read('hooks/hooks.json'));
check('mod: hooks.json names register.ts',hooksJson.modules?.includes('./register.ts'));
for(const name of ['options','screen','guard','command','status','register']){check(`mod: hooks/${name}.ts present and <=500 lines`,existsSync(new URL(`hooks/${name}.ts`,root))&&read(`hooks/${name}.ts`).split('\n').length<=501)}
check('mod: guard defaults on',manifest.userConfig?.guard?.default==='on');
check('mod: no network or process in hooks',!['screen','guard','command','status','register','options'].some((name)=>/\$\.(http|process)\.|child_process|fetch\(/.test(read(`hooks/${name}.ts`))));
check('mod: /ai-team-mod collides with no command or skill',read('hooks/register.ts').includes("name: 'ai-team-mod'")&&!existsSync(new URL('commands/ai-team-mod.md',root))&&!existsSync(new URL('skills/ai-team-mod',root)));
console.log(`smoke ok: ${checks.length} checks`);
