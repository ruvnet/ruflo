# Claude Code Web Console

A modern web-based terminal interface for Claude Code, providing an authentic console experience with real-time communication to the backend MCP server.

## Features

### Terminal Emulation

- **Authentic Terminal Experience**: Console-style dark theme with monospace fonts
- **Real-time Output**: Live streaming of command output with proper formatting
- **Command History**: Navigate through previous commands with arrow keys
- **Input Handling**: Full keyboard support including Ctrl+L (clear), Ctrl+C (interrupt), Tab (autocomplete)
- **ANSI Color Support**: Processes ANSI escape codes for colored output

### WebSocket Communication

- **Real-time Bidirectional Communication**: Connects to Claude Code MCP server via WebSocket
- **Auto-reconnection**: Automatic reconnection with exponential backoff
- **Message Queuing**: Queues messages when disconnected and sends when reconnected
- **Heartbeat Mechanism**: Monitors connection health with ping/pong
- **Session Management**: Handles MCP protocol initialization and session state

### Settings Management

- **Connection Settings**: Server URL, authentication tokens, auto-connect
- **Appearance Customization**: Multiple themes (dark, light, classic, matrix), font size, line height
- **Behavior Options**: Auto-scroll, timestamps, sound notifications, history limits
- **Claude Flow Configuration**: Default SPARC modes, swarm strategies, coordination modes
- **Persistent Storage**: Settings saved to localStorage with import/export capabilities

### Claude Flow Integration

- **Built-in Commands**: Support for all major Claude Flow commands
- **SPARC Mode Support**: Integration with all 17 specialized SPARC modes
- **Swarm Management**: Web interface for swarm coordination and monitoring
- **Real-time Status**: Live updates of agent status, memory usage, and system metrics

## Architecture

### Component Structure

```
src/ui/console/
├── index.html              # Main HTML structure
├── styles/
│   ├── console.css         # Core console styling
│   ├── settings.css        # Settings panel styling
│   └── responsive.css      # Mobile/tablet responsive design
└── js/
    ├── console.js          # Main application coordinator
    ├── websocket-client.js # WebSocket communication layer
    ├── terminal-emulator.js # Terminal behavior and display
    ├── command-handler.js  # Command processing and execution
    └── settings.js         # Configuration management
```

### Integration Points

- **HTTP Transport**: Web console served at `/console` endpoint
- **WebSocket Endpoint**: Real-time communication via `/ws` endpoint
- **MCP Protocol**: Full JSON-RPC 2.0 compliant communication
- **Static Files**: CSS, JavaScript, and assets served via Express static middleware

## Usage

### Starting the Web Console

1. Start Claude Code with HTTP transport enabled:

   ```bash
   claude-flow start --transport http --port 3000
   ```

2. Open web browser and navigate to:

   ```
   http://localhost:3000/console
   ```

3. The console will automatically attempt to connect to the WebSocket endpoint

### Basic Commands

- `help` - Show all available commands
- `connect [url] [token]` - Connect to Claude Code server
- `status` - Show connection and system status
- `clear` - Clear console output (or Ctrl+L)
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

### Settings Panel

Access via the ⚙️ Settings button to configure:

- Server connection details
- Visual appearance and themes
- Console behavior preferences
- Claude Flow default settings

## Themes

### Available Themes

1. **Dark** (default) - Modern dark theme with blue accents
2. **Light** - Clean light theme for bright environments
3. **Classic** - Traditional green-on-black terminal
4. **Matrix** - Matrix-inspired green glow effect

### Custom Styling

The console uses CSS custom properties for easy theming:

```css
:root {
  --bg-primary: #0d1117;
  --text-primary: #c9d1d9;
  --console-prompt: #58a6ff;
  --accent-primary: #1f6feb;
}
```

## Mobile Support

### Responsive Design

- **Tablet Landscape**: Optimized layout with condensed controls
- **Tablet Portrait**: Settings panel adapts to smaller screens
- **Mobile Landscape**: Minimized header and status bar
- **Mobile Portrait**: Full-screen overlay for settings, touch-optimized controls

### Touch Interactions

- Minimum 44px touch targets for accessibility
- 16px font size on inputs to prevent iOS zoom
- Gesture-friendly scrolling and selection
- Swipe gestures for panel management

## Accessibility

### Features

- **Semantic HTML**: Proper ARIA labels and roles
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: Live regions for output updates
- **High Contrast**: Support for high contrast preferences
- **Reduced Motion**: Respects prefers-reduced-motion settings
- **Focus Management**: Clear focus indicators and logical tab order

## Browser Compatibility

### Supported Browsers

- **Chrome/Chromium** 88+
- **Firefox** 85+
- **Safari** 14+
- **Edge** 88+

### Required Features

- ES2020 modules
- WebSocket API
- CSS Custom Properties
- localStorage API
- Fetch API

## Development

### Local Development

1. Ensure Claude Code backend is running with HTTP transport
2. Open `src/ui/console/index.html` in a web browser
3. Modify settings to point to your local server URL

### Building for Production

The console is designed to be served as static files:

```bash
# Copy console files to web server
cp -r src/ui/console/* /var/www/claude-console/

# Or serve via Node.js/Express
app.use('/console', express.static('src/ui/console'));
```

### Customization

- Modify CSS custom properties for theming
- Extend command handlers for new functionality
- Add new WebSocket message handlers for custom notifications
- Customize settings panel for additional configuration options

## Security Considerations

### Authentication

- Bearer token authentication support
- Secure WebSocket connections (WSS) in production
- CORS configuration for cross-origin requests
- Input validation and sanitization

### Best Practices

- Use HTTPS in production environments
- Configure proper CORS origins
- Implement rate limiting for WebSocket connections
- Validate all user inputs before processing

## Performance

### Optimizations

- **Message Queuing**: Efficient handling of high-frequency messages
- **Output Limiting**: Configurable maximum lines to prevent memory issues
- **Lazy Loading**: Components loaded only when needed
- **Debounced Updates**: Status updates batched for performance

### Memory Management

- Automatic cleanup of old output lines
- Proper event listener cleanup on disconnect
- Garbage collection friendly object creation
- Minimal DOM manipulation for smooth scrolling

## Troubleshooting

### Common Issues

1. **Connection Failed**: Check server URL and ensure Claude Code is running with HTTP transport
2. **WebSocket Errors**: Verify firewall settings and proxy configuration
3. **Authentication Issues**: Check bearer token format and validity
4. **Mobile Display Issues**: Ensure viewport meta tag is present
5. **Theme Not Loading**: Check CSS file paths and custom property support

### Debug Mode

Enable debug logging in browser developer tools:

```javascript
// Access global console instance
window.claudeConsole.wsClient.debugMode = true;
```

## License

Part of the Claude Code project. See main project LICENSE for details.
