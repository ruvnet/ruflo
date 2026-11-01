#!/usr/bin/env node
/** Node 24, zero-network preflight by default. Live execution requires a built CLI,
 * explicit pricing/config, bound API key, enforce-mode policy, and owned checkpoint.
 * Never relax quotas or automatically repeat uncertain/failed paid calls. */
import { readFileSync, writeFileSync, renameSync, lstatSync, openSync, closeSync, unlinkSync, fsyncSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getGlobalAiBudget } from "../../src/services/global-ai-budget.ts";
const contextSha256 = text => createHash("sha256").update(text).digest("hex");
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../../../..");
const flags = process.argv.slice(2);
const value = (name) => {
  const i = flags.indexOf(name);
  return i < 0 ? void 0 : flags[i + 1];
};
const execute = flags.includes("--execute");
const budget = getGlobalAiBudget();
const caseDefinition = Object.freeze({
  id: "launch-fuse-analysis-v1",
  question: "Explain the default global concurrency, hourly and daily launch limits, quota cooldown, whether release restores hourly launch slots, and what happens if the budget ledger cannot be read. Cite the exact source spans supporting each claim.",
  expectedFactsForHumanReview: ["one concurrent model launch", "two launches per hour", "twelve launches per day", "sixty minute quota cooldown", "release frees concurrency but does not restore hourly launch slots", "ledger errors fail closed"]
});
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"));
const sourceMeta = corpus.sources.find((s) => s.path.endsWith("/global-ai-budget.ts"));
if (!sourceMeta) throw new Error("missing fixed fixture");
const limits = budget.getLimits();
const preflight = {
  kind: "live-provider-pilot-preflight",
  execute,
  credentialBound: !!process.env.ANTHROPIC_API_KEY,
  configProvided: !!value("--config"),
  phaseCount: 3,
  defaultPilotCases: 1,
  launchLimits: limits,
  resumeRequiredForDefaultHourlyLimit: limits.maxLaunchesPerHour < 3,
  caseDefinition,
  source: sourceMeta,
  modelCalls: 0,
  networkCalls: 0
};
if (!execute) {
  console.log(JSON.stringify(preflight, null, 2));
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY || !value("--config") || !value("--state")) {
  console.log(JSON.stringify({ ...preflight, status: "blocked", reason: "Requires runtime API key binding, explicit price/model config and checkpoint path. No network request made." }, null, 2));
  process.exitCode = 2;
} else {
  const runtimePath = resolve(value("--runtime") ?? join(root, "v3/@claude-flow/cli/dist/src/index.js"));
  const config = JSON.parse(readFileSync(resolve(value("--config")), "utf8"));
  const content = execFileSync("git", ["show", `${corpus.baselineCommit}:${sourceMeta.path}`], { cwd: root, encoding: "utf8" });
  if (contextSha256(content) !== sourceMeta.sha256) throw new Error("fixture hash mismatch");
  // Bind the whole built CLI tree plus first-party source and lockfile. This
  // does not attest OS binaries or mutable installed dependency bytes.
  const runtimeManifest = {};
  const runtimeRoot = resolve(root, "v3/@claude-flow/cli/dist");
  const walk = dir => { for (const name of readdirSync(dir).sort()) { const path=join(dir,name), stat=lstatSync(path); if(stat.isSymbolicLink()) throw new Error("runtime symlinks refused"); if(stat.isDirectory()) walk(path); else if(stat.isFile()) { if(stat.size>10_000_000 || Object.keys(runtimeManifest).length>10000) throw new Error("runtime manifest limit"); runtimeManifest[path.slice(runtimeRoot.length+1)] = contextSha256(readFileSync(path)); } else throw new Error("runtime nonregular file"); } };
  if (!runtimePath.startsWith(runtimeRoot + "/")) throw new Error("runtime must be inside built CLI dist tree");
  const runtimeEntry = runtimePath.slice(runtimeRoot.length + 1);
  walk(runtimeRoot);
  // Contained and hashed above before any of it runs.
  const { createAnthropicContextAdapter, delegateContextRead } = await import(pathToFileURL(runtimePath).href);
  const { loadPolicyState, authorizeMcpTool } = await import("../../dist/src/services/policy-runtime.js");
  if (loadPolicyState(root).mode !== "enforce") throw new Error("pilot requires existing enforce-mode policy; no mode changes are made");
  const sourceManifest = Object.fromEntries(["src/services/context-delegation.ts","src/services/anthropic-context-adapter.ts","src/services/global-ai-budget.ts"].map(p=>[p,contextSha256(readFileSync(join(root,"v3/@claude-flow/cli",p)))]));
  const runnerSha256 = contextSha256(readFileSync(fileURLToPath(import.meta.url)));
  const lockSha256 = contextSha256(readFileSync(join(root,"package-lock.json")));
  const configSha256 = contextSha256(JSON.stringify({ config, caseDefinition, sourceMeta, runtimeEntry, runtimeManifest, sourceManifest, runnerSha256, lockSha256 }));
  const statePath = resolve(value("--state"));
  const parent = dirname(statePath), parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) || (process.getuid && parentStat.uid!==process.getuid())) throw new Error("checkpoint directory must be owned and private");
  for(let dir=parent;;dir=dirname(dir)) { const stat=lstatSync(dir); if(stat.isSymbolicLink() || !stat.isDirectory() || ((stat.mode & 0o022) && !(stat.mode & 0o1000))) throw new Error("unsafe checkpoint ancestor"); if(dirname(dir)===dir) break; }
  const ensureOwnedFile = (path) => {
    try {
      const s = lstatSync(path);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 1e6 || process.getuid && s.uid !== process.getuid() || s.mode & 63) throw new Error("checkpoint must be a small owner-only regular file");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
  ensureOwnedFile(statePath);
  const lock = `${statePath}.lock`, fd = openSync(lock, "wx", 384);
  let state;
  try {
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      state = { schema: "ruflo.context-provider-pilot/v1", configSha256, phases: {}, source: sourceMeta, caseDefinition, runtimeEntry, runtimeManifest, sourceManifest, runnerSha256, lockSha256, requestedMaximumUsd: 3 * config.maxCostUsdPerCall };
    }
    if (state.schema !== "ruflo.context-provider-pilot/v1" || state.configSha256 !== configSha256) throw new Error("checkpoint/config mismatch");
    const save = () => {
      const tmp = `${statePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 384 });
      const fileFd = openSync(tmp, "r");
      try { fsyncSync(fileFd); } finally { closeSync(fileFd); }
      renameSync(tmp, statePath);
      const dirFd = openSync(parent, "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    };
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    for (const phase of ["baseline", "worker", "routedCoordinator"]) {
      if (state.phases[phase]?.status === "complete") continue;
      if (state.phases[phase] && state.phases[phase].status !== "blocked") throw new Error("inflight or failed phase requires charge review before a new pilot; never automatically repeated");
      const pricing = phase === "worker" ? config.worker : config.coordinator;
      const adapter = createAnthropicContextAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: pricing.model,
        workspace: root,
        pricing,
        maxOutputTokens: 1024,
        maxCostUsd: config.maxCostUsdPerCall,
        timeoutMs: 3e4,
        authorize: async (descriptor, signal) => {
          if (signal.aborted) return false;
          const decision = await authorizeMcpTool(
            "context.read.delegate",
            { model: descriptor.model, endpoints: descriptor.endpoints, sourceHashes: descriptor.sourceHashes, requestSha256: descriptor.requestSha256, totalRequestBytes: descriptor.totalRequestBytes },
            { projectRoot: root },
            { actionType: "context.read.delegate", network: true, costUsd: descriptor.costCeilingUsd, tokens: descriptor.inputTokenCeiling + descriptor.outputTokenCeiling, concurrency: 1 }
          );
          return !signal.aborted && decision.mode === "enforce" && decision.enforcedOutcome === "allowed";
        }
      });
      const sources = phase === "routedCoordinator" ? [{ path: "validated-worker-evidence.json", content: JSON.stringify(state.phases.worker.result, null, 2) }] : [{ path: sourceMeta.path, content }];
      state.attempts ??= [];
      if (state.attempts.length >= 64) throw new Error("pilot attempt limit; review checkpoint before further work");
      const attempt = { phase, status: "started", startedAt: new Date().toISOString() };
      state.attempts.push(attempt);
      state.phases[phase] = { status: "started" };
      save();
      const started = performance.now();
      const result = await delegateContextRead({
        read: { mode: "enforce", intent: "analysis" },
        question: caseDefinition.question,
        sources,
        adapter,
        signal: controller.signal,
        limits: { minInputBytes: 1, timeoutMs: 3e4 }
      });
      const receipts = adapter.receipts();
      const budgetBlocked = result.status === "escalate" && receipts.length === 1 && receipts[0].stage === "budget";
      state.phases[phase] = { status: result.status === "delegated" ? "complete" : budgetBlocked ? "blocked" : "failed", result, receipts, durationMs: performance.now() - started, chargeUncertain: result.status !== "delegated" && (receipts.length === 0 || receipts.some(r => r.stage !== "budget" && !r.usage)) };
      Object.assign(attempt, state.phases[phase], { finishedAt: new Date().toISOString() });
      save();
      if (result.status !== "delegated") {
        console.log(JSON.stringify({ status: budgetBlocked ? "blocked" : "failed", phase, checkpoint: statePath, result, receipts }, null, 2));
        process.exitCode = 2;
        break;
      }
    }
    if (Object.values(state.phases).filter((p) => p.status === "complete").length === 3) {
      console.log(JSON.stringify({
        status: "pilot-complete-human-review-required",
        checkpoint: statePath,
        caseDefinition,
        accounting: (() => {
          const priced = phase => { const calls=state.phases[phase].receipts; return calls.length>0 && calls.every(r=>Number.isFinite(r.usagePricedCostUsd)) ? calls.reduce((n,r)=>n+r.usagePricedCostUsd,0) : null; };
          const baseline = priced("baseline"), worker = priced("worker"), coordinator = priced("routedCoordinator");
          const candidate = worker === null || coordinator === null ? null : worker + coordinator;
          return { baselineUsagePricedCostUsd:baseline, candidateUsagePricedCostUsd:candidate,
            usagePricedCostReductionPct:baseline>0 && candidate!==null ? (1-candidate/baseline)*100 : null,
            baselineActiveMs:state.phases.baseline.durationMs,
            candidateActiveMs:state.phases.worker.durationMs+state.phases.routedCoordinator.durationMs,
            elapsedWallMs:Date.parse(state.attempts.at(-1).finishedAt)-Date.parse(state.attempts[0].startedAt),
            attempts:state.attempts.length, humanReviewRequired:true, invoiceReconciled:false };
        })(),
        note: "Compare all six facts manually. Sum coordinator+worker usage-priced cost and latency for candidate. No production acceptance or invoice claim follows from one pilot."
      }, null, 2));
    }
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
