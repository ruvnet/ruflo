# How to Run SWE-Bench Tests: Claude-Flow vs Native Claude

**A practical guide to measuring and comparing actual performance**

---

## 🎯 Why Run These Tests?

**Current Problem:** All claude-flow performance claims are:
- ❌ Self-reported by the author
- ❌ Tested on different benchmarks (Lite vs Verified)
- ❌ No direct comparison to native Claude Task tool

**Solution:** Run your own tests to get objective, comparable data!

---

## 📋 What You'll Test

### **Option 1: Quick Validation (Recommended First)**
- Run 3-10 instances from SWE-Bench Lite
- Compare claude-flow vs native Claude manually
- Takes: 30-60 minutes
- Cost: ~$1-5 in API calls

### **Option 2: SWE-Bench Lite (300 instances)**
- Full Lite benchmark (easier subset)
- Requires: 5-8 hours, automation setup
- Cost: ~$50-100 in API calls

### **Option 3: SWE-Bench Verified (500 instances)**
- Official hard benchmark (what Anthropic uses)
- Requires: 8-12 hours, full automation
- Cost: ~$100-200 in API calls

---

## 🚀 Quick Start: Run Your First Test

### **Step 1: Install Dependencies**

```bash
# Claude-flow already has the infrastructure!
cd /workspaces/claude-flow/benchmark

# Install benchmark system (includes SWE-Bench tools)
pip install -e .

# This installs:
# - datasets (for loading SWE-Bench)
# - Official SWE-Bench evaluation tools
# - Claude-flow benchmark framework

# Verify installation
python -c "from swarm_benchmark.swe_bench import OfficialSWEBenchEngine; print('✅ Ready')"
```

### **Step 2: Test Native Claude First (Baseline)**

```bash
# 1. Pick a test instance (we'll use a simple one)
INSTANCE_ID="django__django-11099"

# 2. Get the problem description
python -m swebench.harness.get_tasks \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --instance_ids $INSTANCE_ID \
  --output_file test_instance.json

# 3. Read the problem
cat test_instance.json | jq '.[0].problem_statement'

# 4. Open Claude Code and manually solve it
claude

# In Claude Code CLI, tell Claude:
# "Here's a GitHub issue to fix: [paste problem statement]
#  Use Task tool to spawn agents if needed.
#  Generate a git patch when done."

# 5. Save the patch Claude generates
# Copy it to: baseline_predictions.jsonl
```

**Format for `baseline_predictions.jsonl`:**
```json
{
  "instance_id": "django__django-11099",
  "model_name_or_path": "claude-3.5-sonnet-native-task-tool",
  "model_patch": "diff --git a/file.py ...\n[your patch]"
}
```

### **Step 3: Test Claude-Flow (Comparison)**

**✨ The EASIEST Way (Using Built-in Scripts):**
```bash
# Navigate to claude-flow benchmark directory
cd /workspaces/claude-flow/benchmark

# Run the real SWE-Bench script (already exists!)
python3 run_real_swe_bench.py

# This will:
# 1. Load SWE-bench-Lite dataset automatically
# 2. Run 3 test instances with claude-flow
# 3. Generate patches using hive-mind spawn with --claude flag
# 4. Parse stream-json output to extract patches
# 5. Save to: benchmark/swe-bench-official/real-results/predictions.json
# 6. Generate evaluation_report.json with metrics
```

**What the Script Does Internally:**
```python
# From run_real_swe_bench.py:
# - Uses OfficialSWEBenchEngine (real integration)
# - Runs: ./claude-flow hive-mind spawn "<prompt>" --claude --non-interactive
# - Parses stream-json output format
# - Extracts git patches automatically
# - Tracks tokens, timing, success rate
```

**Manual Testing (if you want control):**
```bash
# 1. Get instance details
python -c "
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
inst = ds[0]
print(f'ID: {inst[\"instance_id\"]}')
print(f'Problem: {inst[\"problem_statement\"][:200]}...')
"

# 2. Run claude-flow manually
./claude-flow hive-mind spawn "Fix this issue: [paste problem]" --claude --non-interactive

# 3. Save the generated patch
# (The script does this automatically for you)
```

### **Step 4: Evaluate Both Solutions**

```bash
# Evaluate native Claude patch
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path baseline_predictions.jsonl \
  --max_workers 1 \
  --run_id native-claude-test

# Evaluate claude-flow patch
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path claude_flow_predictions.jsonl \
  --max_workers 1 \
  --run_id claude-flow-test

# Compare results
cat native-claude-test/report.json
cat claude-flow-test/report.json
```

**What you'll see:**
- ✅ Pass/Fail for each test
- ⏱️ Execution time
- 📊 Success rate
- 🐛 Which tests passed/failed

---

## 📊 Automated Testing (Larger Scale)

### **Method 1: Using Claude-Flow's Built-in Scripts (RECOMMENDED)**

Claude-flow already has a complete SWE-Bench integration! Here's what's available:

**Quick Test (3 instances):**
```bash
cd /workspaces/claude-flow/benchmark
python3 run_real_swe_bench.py
```

**Full Lite Benchmark (300 instances):**
```bash
cd /workspaces/claude-flow/benchmark

# Edit run_real_swe_bench.py:
# Line 60-83: Comment out the instance filtering
# Or just use the Python API directly:

python3 << EOF
import asyncio
from swarm_benchmark.swe_bench import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig

async def run_full():
    config = BenchmarkConfig(
        name="Full-Lite-Test",
        max_agents=8,
        task_timeout=300,  # 5 minutes per instance
        output_directory="benchmark/swe-bench-official/full-lite"
    )

    engine = OfficialSWEBenchEngine(config)
    report = await engine.run_evaluation(
        use_lite=True,           # Use Lite dataset
        instances_limit=None,    # Run ALL instances (no limit)
        save_predictions=True    # Save for submission
    )

    print(f"✅ Success Rate: {report['success_rate']:.1%}")

asyncio.run(run_full())
EOF
```

**Key Features of Built-in Scripts:**
- ✅ Automatic dataset loading from HuggingFace
- ✅ Real subprocess execution (`./claude-flow hive-mind spawn`)
- ✅ Stream-JSON parsing for patch extraction
- ✅ Progress tracking and metrics
- ✅ Automatic predictions.json generation (ready for submission)
- ✅ Detailed evaluation reports

### **Method 2: Using the Python API Directly**

**No need to write your own wrapper!** Claude-flow has `OfficialSWEBenchEngine`:

```python
#!/usr/bin/env python3
"""
Direct usage of OfficialSWEBenchEngine for custom testing.
"""
import asyncio
from swarm_benchmark.swe_bench import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode

async def custom_benchmark():
    # Configure your test
    config = BenchmarkConfig(
        name="Custom-SWE-Bench",
        strategy=StrategyType.OPTIMIZATION,  # Best for bug fixes
        mode=CoordinationMode.MESH,  # Best performance (from optimization results)
        max_agents=8,  # Optimal agent count
        task_timeout=300,  # 5 minutes per instance
        output_directory="my-custom-results"
    )

    engine = OfficialSWEBenchEngine(config)

    # Load dataset
    await engine.load_dataset(use_lite=True)

    # Select specific instances
    instances = [inst for inst in engine.dataset
                 if inst['instance_id'] in ['django__django-11099', 'sympy__sympy-13437']]

    # Run each instance
    for instance in instances:
        result = await engine.run_instance(instance)

        if result['success']:
            print(f"✅ {instance['instance_id']}: {result['duration']:.1f}s")
            print(f"   Patch size: {len(result['patch'])} chars")
        else:
            print(f"❌ {instance['instance_id']}: {result['error']}")

    # Save predictions (automatically formatted for submission)
    await engine.validate_submission("my-custom-results/predictions.json")

asyncio.run(custom_benchmark())
```

**What the Engine Does Internally:**
```python
# From official_integration.py (lines 82-223):
# 1. Loads dataset from HuggingFace
# 2. Builds SWE-Bench prompt for each instance
# 3. Executes: ./claude-flow hive-mind spawn "<prompt>" --claude --non-interactive
# 4. Parses stream-json output format
# 5. Extracts patches from JSON stream
# 6. Stores in correct format for SWE-Bench submission
# 7. Validates submission format
```

---

## 🎯 Testing on SWE-Bench VERIFIED (The Hard One)

**Why test on Verified?**
- This is what Anthropic uses for official benchmarks
- Native Claude 3.5 Sonnet: 49%
- Claude 4: 72.7%
- This lets you directly compare to official numbers!

**How to run (using built-in infrastructure):**

```bash
cd /workspaces/claude-flow/benchmark

# Use the Python API (easiest way):
python3 << 'EOF'
import asyncio
from swarm_benchmark.swe_bench import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig

async def run_verified():
    config = BenchmarkConfig(
        name="Verified-Full-Test",
        max_agents=8,
        task_timeout=600,  # 10 minutes per instance (Verified is harder)
        output_directory="benchmark/swe-bench-official/verified-results"
    )

    engine = OfficialSWEBenchEngine(config)

    # Load Verified dataset (500 instances)
    print("📥 Loading SWE-bench Verified (500 instances)...")
    await engine.load_dataset(use_lite=False)  # use_lite=False for Verified

    # Run full evaluation
    report = await engine.run_evaluation(
        use_lite=False,          # Verified dataset
        instances_limit=None,    # Run ALL 500 instances
        save_predictions=True
    )

    print(f"\n{'='*60}")
    print(f"📊 FINAL RESULTS")
    print(f"{'='*60}")
    print(f"Success Rate: {report['success_rate']:.1%}")
    print(f"Instances Solved: {report['successful_patches']}/{report['instances_evaluated']}")
    print(f"Average Duration: {report['average_duration']:.1f}s")
    print(f"\n🎯 Baseline Comparison:")
    print(f"   Claude 3.5 Sonnet: 49%")
    print(f"   Your claude-flow:  {report['success_rate']:.1%}")
    print(f"\n{'='*60}")

    # Predictions saved automatically to:
    # benchmark/swe-bench-official/verified-results/predictions.json

asyncio.run(run_verified())
EOF

# After completion, you can submit predictions to SWE-Bench leaderboard!
# File: benchmark/swe-bench-official/verified-results/predictions.json
```

**Expected results if claims are true:**
- Claude-flow claims 85.2% on Lite
- Lite is easier than Verified
- So on Verified, claude-flow should get at least 60-70%
- If it gets 49% or less, it's no better than native Claude!

---

## 📊 What to Measure

### **Success Rate**
```bash
# After evaluation, check:
cat [run-id]/report.json | jq '{
  total: .total_instances,
  resolved: .resolved_instances,
  rate: .resolved_rate
}'
```

### **Cost Comparison**
```bash
# Track tokens used
# Native Claude: Check Claude Code usage dashboard
# Claude-flow: Check metrics at .claude-flow/metrics/task-metrics.json

# Compare:
# - Total tokens used
# - Cost per instance
# - Token efficiency (tokens per resolved issue)
```

### **Time Comparison**
```bash
# Native Claude: Manually track time per instance
# Claude-flow: Check duration in results

# Compare:
# - Average time per instance
# - Total time for full benchmark
# - Time variance (consistency)
```

### **Error Analysis**
```bash
# For failed instances, analyze:
cat [run-id]/failed_instances.json | jq '.[].error_type' | sort | uniq -c

# Compare error types:
# - Syntax errors
# - Test failures
# - Timeouts
# - Logic errors
```

---

## 🔍 Analyzing Results

### **What Counts as "Better"?**

**Scenario 1: Claude-flow is clearly better**
```
Metric               | Native Claude | Claude-Flow | Winner
---------------------|---------------|-------------|--------
Success Rate         | 45%           | 65%         | ✅ CF
Avg Time per Task    | 8 min         | 5 min       | ✅ CF
Cost per Task        | $0.50         | $0.35       | ✅ CF
```
**Verdict:** Claude-flow provides clear value!

**Scenario 2: Mixed results**
```
Metric               | Native Claude | Claude-Flow | Winner
---------------------|---------------|-------------|--------
Success Rate         | 48%           | 52%         | ⚠️ Slight CF edge
Avg Time per Task    | 6 min         | 9 min       | ❌ Native faster
Cost per Task        | $0.40         | $0.60       | ❌ Native cheaper
```
**Verdict:** Marginal improvement, not worth the complexity

**Scenario 3: Claude-flow is worse**
```
Metric               | Native Claude | Claude-Flow | Winner
---------------------|---------------|-------------|--------
Success Rate         | 50%           | 48%         | ❌ CF worse
Avg Time per Task    | 7 min         | 10 min      | ❌ CF slower
Cost per Task        | $0.45         | $0.65       | ❌ CF more expensive
```
**Verdict:** Stick with native Claude!

---

## 🚨 Common Pitfalls

### **Pitfall 1: Comparing Different Benchmarks**
```
❌ WRONG:
Claude-flow: 85% on Lite
Native Claude: 49% on Verified
Conclusion: Claude-flow is 73% better!

✅ RIGHT:
Test BOTH on the SAME benchmark (Lite OR Verified)
```

### **Pitfall 2: Cherry-Picking Instances**
```
❌ WRONG:
Test on 3 easy instances where claude-flow happens to work well

✅ RIGHT:
Random sample of at least 30 instances, or full benchmark
```

### **Pitfall 3: Not Controlling for Model Version**
```
❌ WRONG:
Native Claude: Using Claude 3.5 Sonnet
Claude-flow: Using Claude 4
Conclusion: Claude-flow is better!

✅ RIGHT:
Use SAME Claude model for both (configure in claude-flow)
```

### **Pitfall 4: Ignoring Setup Overhead**
```
❌ WRONG:
Just measure execution time

✅ RIGHT:
Include time for:
- Initial setup
- Memory database creation
- Hook configuration
- Learning curve for users
```

---

## 📝 Reporting Your Results

### **Template for Publishing Results**

```markdown
# Claude-Flow vs Native Claude: SWE-Bench Comparison

## Test Configuration
- **Date:** [date]
- **Benchmark:** SWE-Bench Verified (500 instances)
- **Claude Model:** Claude 3.5 Sonnet (2024-10-22)
- **Native Setup:** Task tool with manual coordination
- **Claude-Flow Setup:** v2.7.32, mesh topology, 8 agents

## Results

| Metric | Native Claude | Claude-Flow | Difference |
|--------|---------------|-------------|------------|
| Success Rate | X% | Y% | +Z% |
| Avg Time | X min | Y min | ±Z min |
| Total Cost | $X | $Y | ±$Z |
| Tokens per Task | X | Y | ±Z |

## Analysis
[Detailed analysis of what worked/didn't work]

## Conclusion
[Based on YOUR data, not claims]

## Raw Data
[Link to predictions.jsonl, reports, etc.]
```

### **Share Your Results**

```bash
# Upload to GitHub
git add results/
git commit -m "SWE-Bench comparison: Native vs Claude-Flow"
git push

# Submit to SWE-Bench leaderboard
# https://www.swebench.com/

# Share in Claude-Flow issues
# https://github.com/ruvnet/claude-flow/issues
```

---

## 💡 Quick Answer to Your Question

> "Why not just run the hard SWE bench for claude-flow?"

**You absolutely should! Here's the EASIEST way:**

```bash
# Claude-flow already has everything built-in!
cd /workspaces/claude-flow/benchmark

# Install if you haven't already
pip install -e .

# Run the ONE-LINE test (this does EVERYTHING):
python3 run_real_swe_bench.py

# This runs 3 quick instances. For the FULL Verified benchmark:
python3 << 'EOF'
import asyncio
from swarm_benchmark.swe_bench import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig

async def run_full_verified():
    config = BenchmarkConfig(
        name="SWE-Bench-Verified-Complete",
        max_agents=8,
        task_timeout=600,
        output_directory="benchmark/verified-results"
    )

    engine = OfficialSWEBenchEngine(config)
    report = await engine.run_evaluation(
        use_lite=False,        # Use Verified (the hard one!)
        instances_limit=None,  # ALL 500 instances
        save_predictions=True
    )

    verified_score = report['success_rate']
    print(f"\n{'='*60}")
    print(f"🎯 VERIFICATION RESULT:")
    print(f"   Claude-flow on Verified: {verified_score:.1%}")
    print(f"   Official baseline:       49%")
    print(f"   Claimed on Lite:         85.2%")
    print(f"{'='*60}")

    if verified_score >= 0.60:
        print("✅ Claims appear validated! (60%+ on Verified)")
    elif verified_score >= 0.50:
        print("⚠️  Similar to baseline (50-60% on Verified)")
    else:
        print("❌ Below baseline (< 50% on Verified)")

asyncio.run(run_full_verified())
EOF

# Results saved to: benchmark/verified-results/predictions.json
# Time: ~8-12 hours | Cost: ~$100-200 in API calls
```

**What This Does:**
1. ✅ Loads SWE-Bench Verified (500 hard instances)
2. ✅ Runs `./claude-flow hive-mind spawn` for each
3. ✅ Parses stream-json output automatically
4. ✅ Extracts git patches
5. ✅ Saves predictions.json (ready for leaderboard submission)
6. ✅ Generates detailed metrics report
7. ✅ Compares to official baselines

**Time:** 8-12 hours
**Cost:** ~$100-200
**Value:** Objective proof of whether claude-flow's claims are real!

---

## 🎯 Bottom Line

**The best way to know if claude-flow provides value:**
1. ✅ Run the tests yourself
2. ✅ Use the SAME benchmark (Verified)
3. ✅ Compare to native Claude baseline
4. ✅ Measure objectively (success rate, cost, time)
5. ✅ Share your results

**Don't trust claims - trust data!** 📊
