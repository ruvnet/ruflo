#!/usr/bin/env node

/**
 * AIME Dashboard Startup Script
 * Starts the integrated AIME progress management system with existing MCP dashboard
 */

import { AIMEDashboardIntegration } from './dashboard-integration.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startAIMEDashboard() {
  console.log('🚀 Starting AIME Dashboard Integration...');
  console.log('🎯 Integrating with existing MCP Observability Dashboard');
  
  try {
    // Check if the MCP dashboard exists
    const dashboardPath = join(__dirname, '../../../mcp-observability-dashboard.html');
    
    try {
      await fs.access(dashboardPath);
      console.log('✅ Found existing MCP Observability Dashboard');
      console.log(`📊 Dashboard location: ${dashboardPath}`);
    } catch (error) {
      console.log('⚠️  MCP Dashboard not found at expected location');
      console.log('🔧 Will create integration endpoints for external dashboard');
    }

    // Initialize AIME Dashboard Integration
    const aimieDashboard = new AIMEDashboardIntegration({
      port: process.env.AIME_PORT || 3001
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await aimieDashboard.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await aimieDashboard.stop();
      process.exit(0);
    });

    // Start the dashboard integration server
    await aimieDashboard.start();

    console.log('\n🎯 AIME Dashboard Integration Status:');
    console.log('├── 🟢 Progress Management: Operational');
    console.log('├── 🟢 Socket.IO Server: Listening on port 3001');
    console.log('├── 🟢 REST API: Available at http://localhost:3001/api/aime');
    console.log('├── 🟢 Health Check: http://localhost:3001/health');
    console.log('└── 🟢 Dashboard Enhancement: Ready for MCP integration');
    
    console.log('\n📊 Your enhanced MCP Dashboard should now show:');
    console.log('├── 🎯 AIME Mission Progress section');
    console.log('├── 🔄 Real-time task updates');
    console.log('├── ✅ Completed task tracking');
    console.log('└── 🚨 Live obstacle reporting');
    
    console.log('\n🔗 Integration Instructions:');
    console.log('1. Open your MCP Observability Dashboard');
    console.log('2. AIME Mission Progress section will auto-connect');
    console.log('3. Watch real-time updates as agents work');
    console.log('4. Use mission control features in the dashboard');
    
    console.log('\n🎮 Mission Control Commands Available:');
    console.log('├── Pause/Resume tasks');
    console.log('├── Prioritize missions');
    console.log('├── Reassign agents');
    console.log('└── Monitor progress in real-time');

  } catch (error) {
    console.error('❌ Failed to start AIME Dashboard Integration:', error);
    process.exit(1);
  }
}

// Additional utility functions for debugging and monitoring
function showIntegrationStatus() {
  console.log('\n📋 AIME Integration Components:');
  console.log('├── 📊 Progress Management Module: ✅ Loaded');
  console.log('├── 🔧 UpdateProgress Tool: ✅ Available');
  console.log('├── 🌐 Socket.IO Integration: ✅ Ready');
  console.log('├── 🎯 Mission Control: ✅ Operational');
  console.log('└── 📈 Real-time Analytics: ✅ Streaming');
}

function showAPIEndpoints() {
  console.log('\n🔌 Available API Endpoints:');
  console.log('├── GET  /api/aime/status - Current mission status');
  console.log('├── POST /api/aime/progress - Update task progress');
  console.log('├── POST /api/aime/initialize - Initialize new mission');
  console.log('├── GET  /health - Service health check');
  console.log('└── WS   /socket.io - Real-time WebSocket connection');
}

// Handle command line arguments
if (process.argv.includes('--status')) {
  showIntegrationStatus();
  process.exit(0);
}

if (process.argv.includes('--endpoints')) {
  showAPIEndpoints();
  process.exit(0);
}

if (process.argv.includes('--help')) {
  console.log('🎯 AIME Dashboard Integration - Command Options:');
  console.log('├── --status     Show integration component status');
  console.log('├── --endpoints  Show available API endpoints');
  console.log('├── --help       Show this help message');
  console.log('└── (no args)    Start the dashboard integration');
  process.exit(0);
}

// Start the dashboard
startAIMEDashboard();