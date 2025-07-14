#!/bin/bash

# Hive Mind Resume Feature Test Coverage Report
# Runs all tests related to session persistence and resume functionality

echo "🧪 Running Hive Mind Resume Feature Tests..."
echo "============================================"

# Set test environment
export NODE_ENV=test

# Run unit tests
echo ""
echo "📋 Unit Tests:"
echo "--------------"
echo "Running HiveMindSessionManager tests..."
npm test -- tests/hive-mind/unit/session-manager.test.js --coverage

echo ""
echo "Running AutoSaveMiddleware tests..."
npm test -- tests/hive-mind/unit/auto-save-middleware.test.js --coverage

# Run integration tests
echo ""
echo "🔗 Integration Tests:"
echo "--------------------"
echo "Running Resume Command integration tests..."
npm test -- tests/hive-mind/integration/resume-command.test.js --coverage

# Run E2E tests
echo ""
echo "🌐 End-to-End Tests:"
echo "--------------------"
echo "Running Hive Mind Resume E2E tests..."
npm test -- tests/hive-mind/e2e/hive-mind-resume.test.js --coverage

# Generate combined coverage report
echo ""
echo "📊 Generating Coverage Report..."
echo "--------------------------------"
npm test -- \
  tests/hive-mind/unit/session-manager.test.js \
  tests/hive-mind/unit/auto-save-middleware.test.js \
  tests/hive-mind/integration/resume-command.test.js \
  tests/hive-mind/e2e/hive-mind-resume.test.js \
  --coverage \
  --coverageReporters=text \
  --coverageReporters=html \
  --coverageDirectory=coverage/hive-mind-resume

echo ""
echo "✅ Test coverage report generated at: coverage/hive-mind-resume/index.html"
echo ""
echo "📈 Test Summary:"
echo "----------------"
echo "- Unit Tests: session-manager.test.js, auto-save-middleware.test.js"
echo "- Integration Tests: resume-command.test.js"
echo "- E2E Tests: hive-mind-resume.test.js"
echo ""
echo "🎯 Features Tested:"
echo "-------------------"
echo "✓ Session creation and persistence"
echo "✓ Checkpoint saving and restoration"
echo "✓ Session pause/resume functionality"
echo "✓ Auto-save during operations"
echo "✓ Interrupt handling (Ctrl+C)"
echo "✓ Multi-session management"
echo "✓ Error recovery and corruption handling"
echo "✓ Claude Code integration"
echo "✓ Progress tracking across sessions"
echo "✓ Session archival"