#!/usr/bin/env python3
"""
Quick test of a single SWE-Bench instance using OfficialSWEBenchEngine.
"""
import asyncio
from pathlib import Path
import sys

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench.official_integration import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def test_single_instance():
    """Test a single SWE-Bench instance."""

    print("""
╔══════════════════════════════════════════════════════════════╗
║          Single Instance SWE-Bench Test                      ║
║     Testing Claude-Flow on Real GitHub Issue                 ║
╚══════════════════════════════════════════════════════════════╝
""")

    # Simple configuration for single test
    config = BenchmarkConfig(
        name="Single-Instance-Test",
        strategy=StrategyType.OPTIMIZATION,
        mode=CoordinationMode.MESH,
        max_agents=8,
        task_timeout=300,  # 5 minutes
        output_directory="benchmark/test-results"
    )

    print(f"Configuration:")
    print(f"  Mode: {config.mode.value}")
    print(f"  Strategy: {config.strategy.value}")
    print(f"  Agents: {config.max_agents}")
    print(f"  Timeout: {config.task_timeout}s")
    print()

    # Initialize engine
    engine = OfficialSWEBenchEngine(config)

    # Load dataset
    print("📥 Loading SWE-bench-Lite dataset...")
    if not await engine.load_dataset(use_lite=True):
        print("❌ Failed to load dataset")
        return

    print(f"✅ Loaded {len(engine.dataset)} instances")

    # Select first instance (usually django__django-11099)
    instance = engine.dataset[0]

    print(f"\n{'='*60}")
    print(f"Testing Instance:")
    print(f"{'='*60}")
    print(f"ID: {instance['instance_id']}")
    print(f"Repository: {instance['repo']}")
    print(f"Problem: {instance['problem_statement'][:200]}...")
    print(f"{'='*60}\n")

    # Run the instance
    print("🚀 Running claude-flow to generate fix...\n")
    result = await engine.run_instance(instance)

    # Display results
    print(f"\n{'='*60}")
    print(f"RESULTS")
    print(f"{'='*60}")

    if result['success']:
        print(f"✅ SUCCESS!")
        print(f"   Duration: {result['duration']:.1f}s")
        print(f"   Patch size: {len(result['patch'])} characters")
        print(f"\n📄 Generated Patch (first 500 chars):")
        print(f"{'─'*60}")
        print(result['patch'][:500])
        if len(result['patch']) > 500:
            print(f"... ({len(result['patch']) - 500} more characters)")
        print(f"{'─'*60}")
    else:
        print(f"❌ FAILED")
        print(f"   Error: {result['error']}")
        print(f"   Duration: {result['duration']:.1f}s")

    print(f"\n{'='*60}")
    print(f"Test Complete!")
    print(f"{'='*60}\n")

    # Save prediction
    if result['success']:
        predictions_file = Path(config.output_directory) / "predictions.json"
        predictions_file.parent.mkdir(parents=True, exist_ok=True)

        import json
        with open(predictions_file, 'w') as f:
            json.dump({
                instance['instance_id']: {
                    "model_patch": result['patch'],
                    "model_name_or_path": "claude-flow-test",
                    "instance_id": instance['instance_id']
                }
            }, f, indent=2)

        print(f"💾 Prediction saved to: {predictions_file}\n")


if __name__ == "__main__":
    asyncio.run(test_single_instance())
