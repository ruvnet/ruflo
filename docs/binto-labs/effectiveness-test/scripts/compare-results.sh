#!/bin/bash
# Compare Baseline vs Claude-Flow Results

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              A/B TEST RESULTS COMPARISON                     ║"
echo "║         Baseline vs Claude-Flow Effectiveness                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ ! -f ~/checkout-baseline/results-baseline.md ]; then
    echo "❌ Baseline results not found: ~/checkout-baseline/results-baseline.md"
    echo "   Run baseline test first!"
    exit 1
fi

if [ ! -f ~/checkout-claude-flow/results-claude-flow.md ]; then
    echo "❌ Claude-flow results not found: ~/checkout-claude-flow/results-claude-flow.md"
    echo "   Run claude-flow test first!"
    exit 1
fi

echo "📊 Generating comparison report..."
echo ""

cat > ~/comparison-report.md << 'EOF'
# A/B Test Results: Baseline vs Claude-Flow

## Executive Summary

| Metric | Baseline | Claude-Flow | Δ Improvement | Winner |
|--------|----------|-------------|---------------|--------|
| **Test Coverage (%)** | ____ | ____ | ____ pp | |
| **TypeScript Errors** | ____ | ____ | ____ | |
| **ESLint Issues** | ____ | ____ | ____ | |
| **Features Working (/9)** | ____ | ____ | ____ | |
| **Critical Bugs** | ____ | ____ | ____ | |
| **Total Bugs** | ____ | ____ | ____ | |
| **Time to Complete** | ____m | ____m | ____% | |
| **Coordination Failures** | ____ | ____ | ____ | |

## Detailed Analysis

### Code Quality

#### Test Coverage
- **Baseline**: ____%
- **Claude-Flow**: ____%
- **Analysis**:

#### Type Safety
- **Baseline**: ____ errors
- **Claude-Flow**: ____ errors
- **Analysis**:

#### Code Quality (ESLint)
- **Baseline**: ____ issues
- **Claude-Flow**: ____ issues
- **Analysis**:

### Functionality

#### Features Working
- **Baseline**: ____/9 features
- **Claude-Flow**: ____/9 features

| Feature | Baseline | Claude-Flow | Notes |
|---------|----------|-------------|-------|
| Add to cart | | | |
| Remove from cart | | | |
| Update quantity | | | |
| Calculate totals | | | |
| Apply discount | | | |
| Shipping address | | | |
| Payment method | | | |
| Stripe payment | | | |
| Order confirmation | | | |

#### Bugs Found
- **Baseline Critical**: ____
- **Claude-Flow Critical**: ____
- **Baseline Total**: ____
- **Claude-Flow Total**: ____

### Development Process

#### Time to Completion
- **Baseline**: ____ minutes
- **Claude-Flow**: ____ minutes
- **Efficiency**: ____% faster/slower

#### Coordination Issues (Claude-Flow Only)
- Duplicate work: ____
- Missing dependencies: ____
- Integration failures: ____
- Context loss: ____

#### Memory Usage (Claude-Flow Only)
- Memory entries created: ____
- API contracts published: ____
- Contracts consumed: ____

### Documentation

#### API Documentation
- **Baseline**: ____/4
- **Claude-Flow**: ____/4

#### Decision Documentation
- **Baseline**: ____/4
- **Claude-Flow**: ____/4

## Conclusion

### Was Claude-Flow Effective?

**Success Criteria** (from CLAUDE-FLOW-EFFECTIVENESS-TEST.md):
- [ ] Test coverage ≥5 percentage points higher
- [ ] Bugs ≤50% of baseline
- [ ] Coordination failures ≤50% of baseline
- [ ] Architecture score ≥20% higher
- [ ] Documentation score ≥50% higher
- [ ] Time to complete ≤80% of baseline

**Result**: ________ (EFFECTIVE / NEUTRAL / INEFFECTIVE)

### Key Findings

**What Worked Well**:
1.
2.
3.

**What Didn't Work**:
1.
2.
3.

**Recommendations**:
1.
2.
3.

### Next Steps

- [ ] Run test on different project type
- [ ] Optimize coordination patterns based on learnings
- [ ] Update guide with best practices discovered
- [ ] Document specific memory usage patterns that helped

---

**Generated**: $(date)
**Test Duration**: Baseline ____m, Claude-Flow ____m
EOF

echo "✅ Comparison template created: ~/comparison-report.md"
echo ""
echo "📋 Instructions:"
echo "  1. Fill in metrics from both results files"
echo "  2. Analyze differences"
echo "  3. Draw conclusions"
echo ""
echo "📂 Files:"
echo "  - Baseline results: ~/checkout-baseline/results-baseline.md"
echo "  - Claude-flow results: ~/checkout-claude-flow/results-claude-flow.md"
echo "  - Comparison: ~/comparison-report.md"
