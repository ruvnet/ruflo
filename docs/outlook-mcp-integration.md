# Microsoft Outlook MCP Integration Guide

## Overview

The Outlook MCP (Model Context Protocol) server enables Claude Code to interact with Microsoft Outlook and Microsoft 365 services through the standardized MCP interface. This integration provides access to email, calendar, contacts, tasks, and file management capabilities.

## Installation

### Option 1: CLI for Microsoft 365 MCP Server (Recommended)

```bash
claude mcp add outlook npx @pnp/cli-microsoft365-mcp-server
```

**Features:**
- Full Microsoft 365 integration
- Outlook mail, calendar, and contacts
- SharePoint and OneDrive access
- Microsoft Teams integration
- PowerShell-based automation

### Option 2: Outlook MCP (ryaker)

```bash
npm install -g outlook-mcp
claude mcp add outlook npx outlook-mcp
```

**Features:**
- Focused Outlook integration
- Microsoft Graph API access
- OAuth authentication
- Certified by MCPHub

### Option 3: MS-365 MCP Server (Softeria)

```bash
npm install -g @softeria/ms-365-mcp-server
claude mcp add outlook npx @softeria/ms-365-mcp-server
```

**Features:**
- Comprehensive Microsoft 365 support
- Advanced contact management
- Custom Graph API queries

## Authentication

### CLI for Microsoft 365 Authentication

```bash
# Install CLI for Microsoft 365
npm install -g @pnp/cli-microsoft365

# Login to Microsoft 365
m365 login

# Verify authentication
m365 status
```

### Azure AD App Registration (for Graph API)

1. Go to Azure Portal (https://portal.azure.com)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Click "New registration"
4. Configure:
   - Name: "Claude Outlook MCP"
   - Supported account types: "Accounts in this organizational directory only"
   - Redirect URI: Leave blank for now
5. Note the Application (client) ID
6. Create a client secret under "Certificates & secrets"
7. Add API permissions:
   - Microsoft Graph > Delegated permissions
   - Mail.Read, Mail.Send
   - Calendars.ReadWrite
   - Contacts.ReadWrite

## Available MCP Tools

### Email Management

```javascript
// List recent emails
mcp__outlook__list_messages({ folder: 'inbox', limit: 10 })

// Send an email
mcp__outlook__send_message({
  to: 'recipient@example.com',
  subject: 'Hello from Claude',
  body: 'Email content here',
  importance: 'high'
})

// Search emails
mcp__outlook__search_messages({
  query: 'from:sender@example.com',
  folder: 'inbox'
})
```

### Calendar Management

```javascript
// List calendar events
mcp__outlook__list_events({
  startDate: '2025-01-01',
  endDate: '2025-01-31'
})

// Create a meeting
mcp__outlook__create_event({
  subject: 'Team Standup',
  start: '2025-01-15T10:00:00',
  end: '2025-01-15T10:30:00',
  attendees: ['team@example.com'],
  isOnlineMeeting: true
})

// Find available time slots
mcp__outlook__find_meeting_times({
  attendees: ['user1@example.com', 'user2@example.com'],
  duration: 60,
  startDate: '2025-01-15',
  endDate: '2025-01-20'
})
```

### Contact Management

```javascript
// List contacts
mcp__outlook__list_contacts()

// Create a contact
mcp__outlook__create_contact({
  givenName: 'John',
  surname: 'Doe',
  emailAddresses: ['john.doe@example.com'],
  businessPhones: ['+1-555-0123']
})

// Update a contact
mcp__outlook__update_contact({
  contactId: 'AAMk...',
  mobilePhone: '+1-555-9876'
})
```

### Task Management

```javascript
// List tasks
mcp__outlook__list_tasks({ listId: 'default' })

// Create a task
mcp__outlook__create_task({
  title: 'Complete project documentation',
  dueDate: '2025-01-20',
  importance: 'high',
  status: 'notStarted'
})
```

## Integration with Claude Flow Swarms

### Email Processing Agent

```javascript
// Use Claude Code Task tool to spawn email processing agent
Task("Email Processor", `
  Process unread emails from Outlook inbox:
  1. Use mcp__outlook__list_messages to get unread emails
  2. Categorize by priority and sender
  3. Generate response drafts for routine inquiries
  4. Flag important emails for manual review
  5. Store processing results in memory
`, "coder")
```

### Calendar Assistant Agent

```javascript
// Spawn calendar management agent
Task("Calendar Assistant", `
  Manage calendar efficiently:
  1. Check mcp__outlook__list_events for today's schedule
  2. Find conflicts and suggest reschedules
  3. Use mcp__outlook__find_meeting_times for new meetings
  4. Send meeting invites via mcp__outlook__create_event
  5. Coordinate with team via memory hooks
`, "backend-dev")
```

### Contact Sync Agent

```javascript
// Contact synchronization agent
Task("Contact Sync", `
  Synchronize contacts across systems:
  1. Fetch contacts via mcp__outlook__list_contacts
  2. Compare with CRM database
  3. Update outdated information
  4. Create new contacts as needed
  5. Log sync results to memory
`, "coder")
```

## Environment Configuration

Create a `.env` file for configuration:

```bash
# Microsoft 365 Configuration
M365_TENANT_ID=your-tenant-id
M365_CLIENT_ID=your-client-id
M365_CLIENT_SECRET=your-client-secret

# Optional: Outlook specific settings
OUTLOOK_EMAIL=your-email@company.com
OUTLOOK_TIMEZONE=America/New_York
```

## Best Practices

### Security
- Never commit credentials to git
- Use environment variables for sensitive data
- Rotate client secrets regularly
- Implement least-privilege access

### Performance
- Batch email operations when possible
- Use date filters to limit results
- Cache frequently accessed data
- Implement rate limiting

### Error Handling
```javascript
try {
  const emails = await mcp__outlook__list_messages({ folder: 'inbox' })
  // Process emails
} catch (error) {
  if (error.code === 'EAUTH') {
    // Re-authenticate
    console.log('Authentication expired, please run: m365 login')
  } else {
    // Handle other errors
    console.error('Error fetching emails:', error.message)
  }
}
```

## Example Use Cases

### 1. Automated Email Triage

```javascript
// Spawn swarm for email processing
[Single Message - Email Triage]:
  Task("Email Analyzer", "Analyze unread emails and categorize by urgency", "code-analyzer")
  Task("Response Generator", "Generate draft responses for routine emails", "coder")
  Task("Priority Flagging", "Flag high-priority emails for immediate attention", "reviewer")
```

### 2. Meeting Scheduler

```javascript
// Intelligent meeting scheduling
Task("Meeting Scheduler", `
  Schedule team meeting:
  1. Check availability for all attendees
  2. Find optimal time slot
  3. Create meeting with agenda
  4. Send calendar invites
  5. Store meeting details in memory
`, "backend-dev")
```

### 3. Contact Enrichment

```javascript
// Enrich contact information from multiple sources
Task("Contact Enrichment", `
  Enhance contact database:
  1. Fetch Outlook contacts
  2. Search for additional information
  3. Update contact records
  4. Sync back to Outlook
`, "researcher")
```

## Troubleshooting

### Authentication Issues

```bash
# Clear authentication cache
m365 logout
m365 login

# Verify permissions
m365 status --verbose
```

### MCP Server Not Starting

```bash
# Reinstall the MCP server
npm install -g @pnp/cli-microsoft365-mcp-server

# Verify installation
npx @pnp/cli-microsoft365-mcp-server --version

# Check Claude MCP configuration
claude mcp list
```

### Rate Limiting

```javascript
// Implement exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error.code === 'RATE_LIMIT' && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000))
      } else {
        throw error
      }
    }
  }
}
```

## Additional Resources

- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/api/overview)
- [CLI for Microsoft 365 Documentation](https://pnp.github.io/cli-microsoft365/)
- [Outlook MCP GitHub Repository](https://github.com/ryaker/outlook-mcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)

## Support

For issues specific to:
- **Outlook MCP**: Report at respective GitHub repositories
- **Claude Flow Integration**: https://github.com/ruvnet/claude-flow/issues
- **Microsoft 365 Services**: Microsoft Support Portal
