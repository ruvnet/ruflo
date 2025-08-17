# Claude Code Web UI Access Instructions

## 🌐 How to Access the Web-Based UI

The Claude Code Web UI from v1.0.72 has been successfully ported and is now fully functional! Here's how to access it:

### Method 1: Using the Start Command (Recommended)
```bash
# Start the web server
claude-flow start --web

# Or with custom port
claude-flow start --web --port 8080
```

### Method 2: Direct Script Execution
```bash
# Using the startup script
node start-web-ui.js

# Or with custom port
node start-web-ui.js 8080
```

### Method 3: Direct Server Import
```bash
# Start directly via web server module
node src/cli/simple-commands/web-server.js 3000
```

## 📍 Accessing the UI

Once started, open your web browser and navigate to:
- **Main Console**: `http://localhost:3000/console`
- **Health Check**: `http://localhost:3000/health`
- **Status API**: `http://localhost:3000/api/status`

## ✨ Features

### Web Console Features
- 🖥️ **Full Terminal Emulation**: Authentic console experience
- 🔄 **Real-time Communication**: WebSocket-based bidirectional communication
- 🎨 **Multiple Themes**: Dark, Light, Classic Terminal, Matrix
- 📱 **Mobile Responsive**: Works on tablets and phones
- ⚙️ **Customizable Settings**: Font size, themes, behavior options
- 🤖 **Claude Flow Integration**: Built-in support for all commands

### Advanced Capabilities
- 🐝 **Swarm Orchestration**: Real-time swarm management
- 💾 **Persistent Settings**: Configuration saved to localStorage
- 🔔 **Live Notifications**: Real-time system updates
- 📊 **System Monitoring**: Live metrics and status displays
- 🔧 **Command History**: Navigate previous commands with arrow keys
- ⌨️ **Keyboard Shortcuts**: Full keyboard navigation support

## 🎮 Usage Instructions

### Basic Navigation
- **Connect**: Settings panel → Enter server URL → Click Connect
- **Commands**: Type in the console input field and press Enter
- **History**: Use ↑/↓ arrow keys to navigate command history
- **Clear**: Ctrl+L or click the Clear button
- **Settings**: Click the ⚙️ gear icon to open settings panel

### Available Commands
- `help` - Show all available commands
- `connect [url] [token]` - Connect to Claude Code server
- `status` - Show connection and system status
- `clear` - Clear console output
- `claude-flow <command>` - Execute Claude Flow commands
- `swarm <action>` - Manage swarms
- `tools` - List available tools

### Keyboard Shortcuts
- **Enter** - Execute command
- **Tab** - Autocomplete command
- **↑/↓** - Navigate command history
- **Ctrl+L** - Clear console
- **Ctrl+C** - Send interrupt signal
- **ESC** - Close settings panel

## 🎨 Themes

Choose from 4 built-in themes:
1. **Dark** (default) - Modern dark theme with blue accents
2. **Light** - Clean light theme for bright environments
3. **Classic** - Traditional green-on-black terminal
4. **Matrix** - Matrix-inspired green glow effect

## 📱 Mobile Support

The UI is fully responsive and works on:
- Desktop browsers (Chrome, Firefox, Safari, Edge)
- Tablets (iPad, Android tablets)
- Mobile phones (with optimized touch controls)

## 🔧 Configuration

### Connection Settings
- **Server URL**: WebSocket endpoint (default: `ws://localhost:3000/ws`)
- **Auth Token**: Bearer token for authentication (optional)
- **Auto-connect**: Automatically connect on page load (✅ **enabled by default**)

### Appearance Settings
- **Font Size**: 12px to 20px
- **Line Height**: 1.2 to 1.8
- **Theme**: Dark, Light, Classic, Matrix

### Behavior Settings
- **Auto-scroll**: Automatically scroll to bottom on new output
- **Show Timestamps**: Display timestamps on log entries
- **Enable Sounds**: Sound notifications for events
- **Max History**: Maximum number of lines to keep (100-10000)

## 🚀 Advanced Features

### Claude Flow Integration
The web UI includes full integration with Claude Flow's swarm orchestration:

- **SPARC Mode Selection**: Choose from 10+ specialized modes
- **Swarm Strategy**: Configure coordination approaches
- **Real-time Agent Status**: Monitor active agents and tasks
- **Memory Management**: View and manage persistent memory

### WebSocket Communication
- **Real-time Updates**: Live streaming of command output
- **Auto-reconnection**: Automatic reconnection with exponential backoff
- **Message Queuing**: Commands queued during disconnection
- **Heartbeat Monitoring**: Connection health monitoring

## 🔧 Troubleshooting

### Common Issues

**Connection Failed**
- Ensure the server is running with `claude-flow start --web`
- Check the server URL in settings (default: `ws://localhost:3000/ws`)
- Verify firewall settings allow connections to the port

**WebSocket Errors**
- Check browser console for detailed error messages
- Ensure WebSocket support in your browser
- Try refreshing the page

**UI Not Loading**
- Clear browser cache and reload
- Check browser developer tools for JavaScript errors
- Ensure all required files are accessible

**✅ Recent Fixes Applied:**
- Fixed 404 errors for CSS and JavaScript files
- Corrected path resolution for `/console/` endpoint
- Added favicon to prevent browser errors
- Improved static file serving
- **✅ Enabled auto-connect by default** - Console automatically connects on startup
- **✅ Fixed duplicate welcome messages** - No more duplicate ASCII art
- **✅ Fixed unhandled notifications** - Connection events handled properly
- **✅ Added auto-connect setting** - Checkbox in settings panel for easy control

**Mobile Display Issues**
- Ensure you're using a supported browser
- Try switching to landscape orientation on phones
- Clear browser cache if layout appears broken

### Debug Mode
Enable detailed logging in browser developer tools:
```javascript
// Access global console instance for debugging
window.claudeConsole.wsClient.debugMode = true;
```

## 🔒 Security Notes

- Use HTTPS in production environments
- Configure proper CORS origins for security
- Implement authentication tokens for sensitive environments
- Consider rate limiting for WebSocket connections

## 📚 Browser Compatibility

**Supported Browsers:**
- Chrome/Chromium 88+
- Firefox 85+
- Safari 14+
- Edge 88+

**Required Features:**
- ES2020 modules
- WebSocket API
- CSS Custom Properties
- localStorage API
- Fetch API

## 🎉 Getting Started

1. **Start the server**:
   ```bash
   claude-flow start --web
   ```

2. **Open your browser** to: `http://localhost:3000/console`

3. **Configure connection** in the settings panel if needed

4. **Start using Claude Flow** commands in the web console!

---

**Enjoy the fully functional Claude Code Web UI v1.0.72!** 🚀

The web interface provides all the power of Claude Flow with the convenience of a modern web application, featuring real-time communication, responsive design, and comprehensive swarm orchestration capabilities.