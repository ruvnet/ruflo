#!/bin/bash
echo "Testing MCP Server Startup..."
npx tsx src/mcp/server-with-wrapper.ts &
SERVER_PID=$!
sleep 2
if ps -p $SERVER_PID > /dev/null; then
  echo "✅ Server is running (PID: $SERVER_PID)"
  kill $SERVER_PID
  echo "✅ Server stopped successfully"
  exit 0
else
  echo "❌ Server failed to start"
  exit 1
fi
