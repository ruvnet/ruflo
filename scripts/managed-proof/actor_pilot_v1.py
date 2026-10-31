"""Bounded live prompt optimization pilot. Host-curated oracles, no promotion."""
import argparse, hashlib, json, os, pathlib, random, subprocess, time

def task(name, spec, cases):
    return {'id':name,'spec':spec,'cases':cases}
TRAIN=[task('sum-squares','Sum the squares of an array of finite numbers.',[[[[2,3]],13],[[[]],0]]),task('reverse-string','Reverse a string by Unicode code points.',[[['abc'],'cba'],[['😀a'],'a😀']]),task('max-number','Maximum of an array of numbers, or null when empty.',[[[[1,4,2]],4],[[[]],None]]),task('count-true','Count strictly true elements in an array.',[[[[True,1,False,True]],2],[[[]],0]])]
AUDIT=[
task('nearest-rank','Return nearest-rank p95 of a nonempty array of nonnegative finite numbers.',[[[[1]],1],[[list(range(1,21))],19],[[[9,1,3]],9]]),
task('interval-union','Merge overlapping or touching closed intervals, sort by start.',[([[[5,7],[1,3],[3,5]]],[[1,7]]),([[]],[])]),
task('gcd','Greatest common divisor of two integers; result nonnegative.',[[[12,18],6],[[0,-8],8],[[0,0],0]]),
task('binary-search','First index of a target in sorted numeric array, else -1.',[[[[1,2,2,3],2],1],[[[],4],-1],[[[1],2],-1]]),
task('utf8-length','Count UTF8 bytes in a string without Node Buffer.',[[['abc'],3],[['😀'],4],[['é'],2]]),
task('rotate','Rotate array right by integer k, including negative k.',[[[[1,2,3],-1],[2,3,1]],[[[],5],[]],[[[1,2,3],4],[3,1,2]]]),
task('balanced','Return whether string parentheses (),[],{} are balanced; ignore other characters.',[[['([{}])'],True],[['([)]'],False],[['abc'],True]]),
task('rle','Run length encode a string as array of [character,count] using Unicode code points.',[[['aa😀😀b'],[['a',2],['😀',2],['b',1]]],[[''],[]]]),
task('stable-unique','Deduplicate array of strings retaining first occurrence order.',[[[['b','a','b']],['b','a']],[[[]],[]]]),
task('transpose','Transpose rectangular matrix; [] becomes [].',[([[[1,2],[3,4]]],[[1,3],[2,4]]),([[]],[])]),
task('levenshtein','Levenshtein edit distance between two ASCII strings.',[[['kitten','sitting'],3],[['','abc'],3],[['a','a'],0]]),
task('roman','Convert integer 1..3999 to standard Roman numerals.',[[[1994],'MCMXCIV'],[[4],'IV'],[[58],'LVIII']]),
task('slug','Lowercase ASCII text, replace runs of non alphanumeric characters with one hyphen and trim hyphens.',[[[' Hello, WORLD! '],'hello-world'],[['---'],''],[['a__b'],'a-b']]),
task('csv','Parse one CSV row including quoted commas and doubled quotes; no newline.',[[['a,"b,c","d""e"'],['a','b,c','d"e']],[[''],['']]]),
task('versions','Compare dotted nonnegative integer version strings numerically, missing components zero; return -1,0,1.',[[['1.10','1.2'],1],[['1.0','1'],0],[['2','10'],-1]]),
task('base64url','Convert standard base64 string to unpadded base64url.',[[['+/8='],'-_8'],[['YWJj'],'YWJj']]),
task('query','Parse URL query string to object of arrays of values. Decode percent escapes and plus as spaces; preserve duplicates.',[[['a=1&a=2&b=hello+world'],{'a':['1','2'],'b':['hello world']}],[[''],{}]]),
task('median','Median of nonempty numeric array.',[[[[3,1,2]],2],[[[4,1,3,2]],2.5]]),
task('chunk','Split array into chunks of positive integer size.',[[[[1,2,3,4,5],2],[[1,2],[3,4],[5]]],[[[],3],[]]]),
task('flatten','Recursively flatten nested arrays of JSON scalars.',[[[[1,[2,[3]],[]]],[1,2,3]],[[[]],[]]]),
task('date-leap','Whether integer year is Gregorian leap year.',[[[1900],False],[[2000],True],[[2024],True],[[2023],False]]),
task('luhn','Validate a nonempty digit-only string using Luhn checksum. Return false for other input strings.',[[['79927398713'],True],[['79927398714'],False],[[''],False],[['a'],False]]),
task('ip4','Validate canonical dotted-decimal IPv4 string: four components 0..255, no leading zeros except zero itself.',[[['127.0.0.1'],True],[['01.2.3.4'],False],[['256.1.1.1'],False],[['1.2.3'],False]]),
task('toposort','Topological sort node strings given [from,to] edges; choose lexicographically smallest available node. Return null on cycle.',[[[['a','b','c'],[['a','c'],['b','c']]],['a','b','c']],[[['a','b'],[['a','b'],['b','a']]],None]]),
task('fibonacci','Nth Fibonacci for integer n>=0 with F0=0,F1=1.',[[[0],0],[[10],55],[[20],6765]]),
task('primes','All primes <= integer n in increasing order.',[[[10],[2,3,5,7]],[[1],[]],[[2],[2]]]),
task('escape-html','Escape &,<,>,double quote,single quote to &amp;,&lt;,&gt;,&quot;,&#39; respectively.',[[['<&\"\'>'],'&lt;&amp;&quot;&#39;&gt;'],[['abc'],'abc']]),
task('range-diff','Return numbers in first array absent from second, preserving first order and duplicates.',[[[[1,2,1,3],[2]],[1,1,3]],[[[],[]],[]]]),
task('anagrams','Whether two ASCII strings are anagrams after ignoring nonletters and case.',[[['Dormitory','Dirty room!!'],True],[['ab','a'],False]]),
task('group-count','Count string occurrences in an array into a JSON object; safely support keys __proto__ and constructor.',[[[['__proto__','a','a']],{'__proto__':1,'a':2}],[[[]],{}]])]
STRATEGIES={'baseline':'Implement carefully. Explain your reasoning briefly in an explanation field and return code in a code field.', 'compact':'Return only a code field, no explanation. Use compact readable code. Check edge cases silently.'}

def digest(v): return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def run_oracle(code,t):
    # No network, home, credentials, writable host mounts, or child privilege.
    js='const assert=require("node:assert/strict");const vm=require("node:vm");const ctx=vm.createContext({});vm.runInContext('+json.dumps(code+';globalThis.answer=solve')+',ctx,{timeout:500});const cases='+json.dumps(t['cases'])+';for(const [args,expected] of cases){ctx.args=JSON.parse(JSON.stringify(args)); const before=JSON.stringify(ctx.args);const actual=vm.runInContext("answer(...args)",ctx,{timeout:500});assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)),expected);assert.equal(JSON.stringify(ctx.args),before)};console.log("PASS")'
    cmd=['bwrap','--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--clearenv','/usr/bin/node','--max-old-space-size=64','-e',js]
    try: return subprocess.run(cmd,capture_output=True,timeout=4).returncode==0
    except subprocess.TimeoutExpired: return False

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--budget',type=float,default=.99);p.add_argument('--cli',default='/home/ruv/.local/bin/claude-ruflo');a=p.parse_args();root=pathlib.Path(a.root);root.mkdir(mode=0o700,parents=True,exist_ok=True)
    plan={'training':TRAIN,'audit':AUDIT,'strategies':STRATEGIES,'seed':4472,'costLimit':a.budget,'independentFamilies':'unestablished: curated programming microtasks, not a representative agent workload corpus'}
    planhash=digest(plan);f=root/'plan.json'
    if f.exists(): raise SystemExit('Consumed pilot directory; use fresh campaign, never silently replay holdout')
    f.write_text(json.dumps({'hash':planhash,'plan':plan},indent=2));spent=0;rows=[]
    def actor(t,strategy,split,arm):
        nonlocal spent
        remaining=a.budget-spent
        if remaining<.025: raise RuntimeError('Aggregate reported-cost cap reached')
        prompt='Implement JavaScript function solve. Do not mutate inputs. '+t['spec']+' '+STRATEGIES[strategy]+' Return valid JSON, no Markdown.'
        cmd=[a.cli,'-p',prompt,'--tools','','--restricted','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--max-budget-usd',str(min(.025,remaining)),'--output-format','json']
        started=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True,timeout=50,cwd=root)
        raw=json.loads(r.stdout);cost=raw.get('total_cost_usd');
        if not isinstance(cost,(int,float)) or cost<0: raise RuntimeError('Missing reported metering')
        spent+=cost;passed=False;output=raw.get('result','')
        try: code=json.loads(output)['code'];passed=isinstance(code,str) and len(code)<20000 and run_oracle(code,t)
        except (KeyError,ValueError,TypeError): pass
        row={'task':t['id'],'split':split,'arm':arm,'strategy':strategy,'passed':bool(passed and r.returncode==0 and not raw.get('is_error',True)),'costUSD':cost,'latencyMs':round((time.monotonic()-started)*1000),'outputHash':digest(output),'output':output,'modelUsage':raw.get('modelUsage',{}),'terminalSuccess':r.returncode==0 and not raw.get('is_error',True)};rows.append(row)
        (root/'rows.json').write_text(json.dumps(rows,indent=2));print(json.dumps({k:v for k,v in row.items() if k not in ['output','modelUsage']}),flush=True)
    for t in TRAIN:
        for strategy in STRATEGIES: actor(t,strategy,'train',strategy)
    scored={s:(sum(r['passed'] for r in rows if r['strategy']==s),-sum(r['costUSD'] for r in rows if r['strategy']==s)) for s in STRATEGIES};selected=max(scored,key=scored.get)
    (root/'selection.json').write_text(json.dumps({'selected':selected,'trainingScores':scored,'planHash':planhash}))
    rng=random.Random(4472)
    schedule=[(t,arm,('baseline' if arm=='baseline' else selected if arm=='learned' else rng.choice(list(STRATEGIES)))) for t in AUDIT for arm in ['baseline','random','learned']];rng.shuffle(schedule)
    for t,arm,strategy in schedule: actor(t,strategy,'audit',arm)
    summary={arm:{'passed':sum(r['passed'] for r in rows if r['split']=='audit' and r['arm']==arm),'total':len(AUDIT),'costUSD':sum(r['costUSD'] for r in rows if r['split']=='audit' and r['arm']==arm)} for arm in ['baseline','random','learned']}
    result={'planHash':planhash,'selected':selected,'trainingCalls':8,'auditCalls':90,'reportedCostUSD':spent,'summary':summary,'claim':'pilot-only; no established adaptive or general agent improvement','staticBestCaveat':'Selected prompt may equal a universally better fixed prompt; requires fresh static-best control before claiming adaptation','defaultsChanged':False}
    (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__': main()
