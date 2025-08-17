# User Input Handling System Technical Specification

## Overview

This document specifies the design for a unified user input handling system that seamlessly processes commands from both CLI and web UI interfaces while maintaining full compatibility with existing claude-flow operations.

## Architecture Goals

1. **Unified Processing**: Single input pipeline for CLI and web interfaces
2. **Backward Compatibility**: Existing CLI behavior unchanged
3. **Security**: Comprehensive input validation and sanitization
4. **File Support**: Seamless file upload and attachment handling
5. **Real-time Responsiveness**: Sub-100ms input processing latency
6. **Session Management**: Persistent context across interfaces

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Input Handling System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Input         │    │   Command       │    │   Security  │ │
│  │   Router        │───▶│   Parser        │───▶│   Validator │ │
│  │                 │    │                 │    │             │ │
│  │ • CLI input     │    │ • syntax parse  │    │ • injection │ │
│  │ • Web input     │    │ • arg parsing   │    │ • validation│ │
│  │ • file input    │    │ • flag parsing  │    │ • sanitize  │ │
│  │ • routing       │    │ • expansion     │    │ • authorize │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Session       │    │   File          │    │   Command   │ │
│  │   Manager       │    │   Handler       │    │   Executor  │ │
│  │                 │    │                 │    │             │ │
│  │ • context       │    │ • upload mgmt   │    │ • CLI exec  │ │
│  │ • persistence   │    │ • validation    │    │ • streaming │ │
│  │ • sync state    │    │ • storage       │    │ • result    │ │
│  │ • history       │    │ • access        │    │ • feedback  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Input Router

### Core Interface

The Input Router is the entry point for all user input, responsible for routing commands to appropriate handlers based on source and type.

```typescript
interface InputRouter {
  // Route input to appropriate handler
  route(input: UserInput): Promise<RoutingResult>;
  
  // Register input sources
  registerSource(source: InputSource): void;
  
  // Handle different input types
  handleCommand(input: CommandInput): Promise<CommandResult>;
  handleFile(input: FileInput): Promise<FileResult>;
  handleInterrupt(input: InterruptInput): Promise<InterruptResult>;
  
  // Input validation and preprocessing
  preprocessInput(input: UserInput): Promise<ProcessedInput>;
}

interface UserInput {
  type: 'command' | 'file' | 'interrupt' | 'paste' | 'shortcut';
  source: 'cli' | 'web' | 'api';
  content: string | File[] | Buffer;
  sessionId: string;
  timestamp: number;
  clientId?: string;
  metadata?: InputMetadata;
}

interface InputMetadata {
  workingDirectory?: string;
  environment?: Record<string, string>;
  userAgent?: string;
  ipAddress?: string;
  authentication?: AuthInfo;
}

interface RoutingResult {
  success: boolean;
  handlerType: 'command' | 'file' | 'special';
  processingTime: number;
  result?: any;
  error?: Error;
}
```

### Implementation

```typescript
class InputRouter {
  private sources = new Map<string, InputSource>();
  private handlers = new Map<string, InputHandler>();
  private securityValidator: SecurityValidator;
  private sessionManager: SessionManager;
  
  constructor(private config: InputRouterConfig) {
    this.securityValidator = new SecurityValidator(config.securityOptions);
    this.sessionManager = new SessionManager(config.sessionOptions);
    this.initializeHandlers();
  }
  
  async route(input: UserInput): Promise<RoutingResult> {
    const startTime = Date.now();
    
    try {
      // Preprocess input
      const processed = await this.preprocessInput(input);
      
      // Security validation
      const validated = await this.securityValidator.validate(processed);
      if (!validated.isValid) {
        throw new SecurityError(`Input validation failed: ${validated.reason}`);
      }
      
      // Route to appropriate handler
      const handler = this.getHandler(processed.type);
      const result = await handler.handle(processed);
      
      return {
        success: true,
        handlerType: processed.type,
        processingTime: Date.now() - startTime,
        result
      };
    } catch (error) {
      return {
        success: false,
        handlerType: input.type,
        processingTime: Date.now() - startTime,
        error: error as Error
      };
    }
  }
  
  async preprocessInput(input: UserInput): Promise<ProcessedInput> {
    // Get session context
    const session = await this.sessionManager.getSession(input.sessionId);
    
    // Apply session context
    const processed: ProcessedInput = {
      ...input,
      session,
      workingDirectory: session.workingDirectory,
      environment: { ...session.environment, ...input.metadata?.environment }
    };
    
    // Handle input type-specific preprocessing
    switch (input.type) {
      case 'command':
        return this.preprocessCommand(processed);
      case 'file':
        return this.preprocessFile(processed);
      case 'shortcut':
        return this.preprocessShortcut(processed);
      default:
        return processed;
    }
  }
  
  private async preprocessCommand(input: ProcessedInput): Promise<ProcessedInput> {
    const content = input.content as string;
    
    // Handle command aliases
    const expanded = this.expandAliases(content, input.session);
    
    // Handle environment variable expansion
    const withEnv = this.expandEnvironmentVariables(expanded, input.environment);
    
    return {
      ...input,
      content: withEnv,
      originalContent: content
    };
  }
}
```

### Input Source Management

```typescript
interface InputSource {
  id: string;
  type: 'cli' | 'web' | 'api';
  
  // Initialize source
  initialize(): Promise<void>;
  
  // Listen for input
  listen(callback: (input: UserInput) => void): void;
  
  // Cleanup
  cleanup(): Promise<void>;
}

class WebInputSource implements InputSource {
  id = 'web';
  type = 'web' as const;
  
  constructor(
    private webSocketServer: WebSocketServer,
    private sessionManager: SessionManager
  ) {}
  
  async initialize(): Promise<void> {
    this.webSocketServer.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }
  
  listen(callback: (input: UserInput) => void): void {
    this.inputCallback = callback;
  }
  
  private handleConnection(socket: WebSocket): void {
    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const input = this.parseWebInput(message, socket);
        this.inputCallback(input);
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Invalid input format'
        }));
      }
    });
  }
}
```

## Command Parser

### Parsing Engine

The Command Parser converts user input into structured commands that can be executed by the CLI.

```typescript
interface CommandParser {
  // Parse command string into structured format
  parse(command: string, context: ParseContext): Promise<ParsedCommand>;
  
  // Validate command syntax
  validateSyntax(command: string): SyntaxValidationResult;
  
  // Handle special web UI commands
  parseSpecialCommand(command: string): SpecialCommand | null;
  
  // Expand shortcuts and aliases
  expandCommand(command: string, aliases: Record<string, string>): string;
}

interface ParsedCommand {
  executable: string;
  subcommand?: string;
  args: string[];
  flags: Map<string, string | boolean>;
  files: AttachedFile[];
  
  // Metadata
  originalCommand: string;
  parsedAt: Date;
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedDuration?: number;
}

interface ParseContext {
  sessionId: string;
  workingDirectory: string;
  environment: Record<string, string>;
  aliases: Record<string, string>;
  history: string[];
}
```

### Implementation

```typescript
class CommandParser {
  private aliasRegistry: AliasRegistry;
  private syntaxValidator: SyntaxValidator;
  private specialCommands: Map<string, SpecialCommandHandler>;
  
  constructor(private config: ParserConfig) {
    this.aliasRegistry = new AliasRegistry();
    this.syntaxValidator = new SyntaxValidator();
    this.initializeSpecialCommands();
  }
  
  async parse(command: string, context: ParseContext): Promise<ParsedCommand> {
    // Check for special commands first
    const special = this.parseSpecialCommand(command);
    if (special) {
      return this.convertSpecialToParsed(special, command);
    }
    
    // Expand aliases
    const expanded = this.expandCommand(command, context.aliases);
    
    // Validate syntax
    const syntaxResult = this.validateSyntax(expanded);
    if (!syntaxResult.isValid) {
      throw new ParseError(`Syntax error: ${syntaxResult.errors.join(', ')}`);
    }
    
    // Parse components
    const tokens = this.tokenize(expanded);
    const parsed = this.parseTokens(tokens, context);
    
    return {
      ...parsed,
      originalCommand: command,
      parsedAt: new Date(),
      complexity: this.assessComplexity(parsed)
    };
  }
  
  private parseTokens(tokens: string[], context: ParseContext): Partial<ParsedCommand> {
    const result: Partial<ParsedCommand> = {
      args: [],
      flags: new Map(),
      files: []
    };
    
    let currentToken = 0;
    
    // Parse executable
    if (tokens.length === 0) {
      throw new ParseError('Empty command');
    }
    result.executable = tokens[currentToken++];
    
    // Parse subcommand (if exists)
    if (currentToken < tokens.length && !tokens[currentToken].startsWith('-')) {
      const potentialSubcommand = tokens[currentToken];
      if (this.isKnownSubcommand(result.executable!, potentialSubcommand)) {
        result.subcommand = potentialSubcommand;
        currentToken++;
      }
    }
    
    // Parse flags and arguments
    while (currentToken < tokens.length) {
      const token = tokens[currentToken];
      
      if (token.startsWith('--')) {
        // Long flag
        const [flag, value] = this.parseLongFlag(token, tokens, currentToken);
        result.flags!.set(flag, value);
        currentToken += value === true ? 1 : 2;
      } else if (token.startsWith('-') && token.length > 1) {
        // Short flag(s)
        const flags = this.parseShortFlags(token, tokens, currentToken);
        for (const [flag, value] of flags) {
          result.flags!.set(flag, value);
        }
        currentToken += flags.length > 0 && typeof flags[0][1] === 'string' ? 2 : 1;
      } else {
        // Argument or file
        if (this.isFilePath(token)) {
          result.files!.push(this.parseFile(token, context));
        } else {
          result.args!.push(token);
        }
        currentToken++;
      }
    }
    
    return result;
  }
  
  private initializeSpecialCommands(): void {
    this.specialCommands.set('upload', new FileUploadHandler());
    this.specialCommands.set('paste', new PasteHandler());
    this.specialCommands.set('shortcut', new ShortcutHandler());
    this.specialCommands.set('macro', new MacroHandler());
  }
}
```

### Alias and Shortcut System

```typescript
interface AliasRegistry {
  // Register command aliases
  register(alias: string, command: string): void;
  
  // Expand alias to full command
  expand(alias: string): string | null;
  
  // List all aliases
  list(): Map<string, string>;
  
  // Import aliases from configuration
  importFromConfig(config: AliasConfig): void;
}

class AliasRegistry {
  private aliases = new Map<string, string>();
  
  constructor(defaultAliases?: Record<string, string>) {
    this.loadDefaultAliases();
    if (defaultAliases) {
      this.importAliases(defaultAliases);
    }
  }
  
  private loadDefaultAliases(): void {
    // Common shortcuts for claude-flow commands
    this.aliases.set('cf', 'claude-flow');
    this.aliases.set('start', 'claude-flow start');
    this.aliases.set('status', 'claude-flow status');
    this.aliases.set('agents', 'claude-flow agent list');
    this.aliases.set('tasks', 'claude-flow task list');
    this.aliases.set('mem', 'claude-flow memory');
    this.aliases.set('cfg', 'claude-flow config');
    
    // Development shortcuts
    this.aliases.set('dev', 'claude-flow start --mode development');
    this.aliases.set('test', 'claude-flow start --mode testing');
    this.aliases.set('prod', 'claude-flow start --mode production');
    
    // File operation shortcuts
    this.aliases.set('upload', 'special:upload');
    this.aliases.set('attach', 'special:attach');
  }
}
```

## Security Validator

### Input Validation

The Security Validator ensures all user input is safe and authorized before processing.

```typescript
interface SecurityValidator {
  // Validate input security
  validate(input: ProcessedInput): Promise<ValidationResult>;
  
  // Check for injection attacks
  checkInjection(input: string): InjectionCheck;
  
  // Validate file uploads
  validateFile(file: File): FileValidationResult;
  
  // Check user permissions
  checkPermissions(userId: string, command: string): Promise<boolean>;
}

interface ValidationResult {
  isValid: boolean;
  reason?: string;
  warnings: string[];
  sanitizedInput?: ProcessedInput;
}

interface InjectionCheck {
  safe: boolean;
  threats: ThreatType[];
  sanitized?: string;
}

type ThreatType = 'command_injection' | 'path_traversal' | 'script_injection' | 'sql_injection';
```

### Implementation

```typescript
class SecurityValidator {
  private injectionDetector: InjectionDetector;
  private permissionChecker: PermissionChecker;
  private fileValidator: FileValidator;
  
  constructor(private config: SecurityConfig) {
    this.injectionDetector = new InjectionDetector(config.injectionRules);
    this.permissionChecker = new PermissionChecker(config.permissions);
    this.fileValidator = new FileValidator(config.fileValidation);
  }
  
  async validate(input: ProcessedInput): Promise<ValidationResult> {
    const warnings: string[] = [];
    
    // Check basic input format
    if (!this.isValidFormat(input)) {
      return {
        isValid: false,
        reason: 'Invalid input format',
        warnings
      };
    }
    
    // Check for injection attacks
    const injectionCheck = this.checkInjection(input.content as string);
    if (!injectionCheck.safe) {
      return {
        isValid: false,
        reason: `Security threat detected: ${injectionCheck.threats.join(', ')}`,
        warnings
      };
    }
    
    // Validate command permissions
    if (input.type === 'command') {
      const hasPermission = await this.checkPermissions(
        input.session.userId,
        input.content as string
      );
      if (!hasPermission) {
        return {
          isValid: false,
          reason: 'Insufficient permissions',
          warnings
        };
      }
    }
    
    // Validate files
    if (input.type === 'file') {
      const files = input.content as File[];
      for (const file of files) {
        const fileValidation = this.validateFile(file);
        if (!fileValidation.isValid) {
          return {
            isValid: false,
            reason: `File validation failed: ${fileValidation.reason}`,
            warnings
          };
        }
        warnings.push(...fileValidation.warnings);
      }
    }
    
    return {
      isValid: true,
      warnings,
      sanitizedInput: injectionCheck.sanitized ? {
        ...input,
        content: injectionCheck.sanitized
      } : input
    };
  }
  
  checkInjection(input: string): InjectionCheck {
    const threats: ThreatType[] = [];
    let sanitized = input;
    
    // Command injection detection
    if (this.hasCommandInjection(input)) {
      threats.push('command_injection');
    }
    
    // Path traversal detection
    if (this.hasPathTraversal(input)) {
      threats.push('path_traversal');
    }
    
    // Script injection detection
    if (this.hasScriptInjection(input)) {
      threats.push('script_injection');
    }
    
    // Sanitize if threats found but recoverable
    if (threats.length > 0 && this.config.autoSanitize) {
      sanitized = this.sanitizeInput(input, threats);
    }
    
    return {
      safe: threats.length === 0 || (this.config.autoSanitize && sanitized !== input),
      threats,
      sanitized: sanitized !== input ? sanitized : undefined
    };
  }
  
  private hasCommandInjection(input: string): boolean {
    const patterns = [
      /[;&|`$(){}]/,  // Shell metacharacters
      /\$\([^)]*\)/,  // Command substitution
      /`[^`]*`/,      // Backtick execution
      /\|\s*\w+/,     // Pipe to command
      /&&|\|\|/       // Command chaining
    ];
    
    return patterns.some(pattern => pattern.test(input));
  }
  
  private hasPathTraversal(input: string): boolean {
    const patterns = [
      /\.\.[\/\\]/,   // Parent directory traversal
      /[\/\\]\.\./,   // Reverse traversal
      /%2e%2e/i,      // URL encoded traversal
      /\.\.%2f/i      // Mixed encoding traversal
    ];
    
    return patterns.some(pattern => pattern.test(input));
  }
}
```

## Session Manager

### Session State Management

The Session Manager maintains consistent state across CLI and web interfaces.

```typescript
interface SessionManager {
  // Create new session
  createSession(userId: string, options?: SessionOptions): Promise<Session>;
  
  // Get existing session
  getSession(sessionId: string): Promise<Session>;
  
  // Update session state
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  
  // Synchronize with CLI state
  syncWithCLI(sessionId: string): Promise<void>;
  
  // Persist session data
  persistSession(session: Session): Promise<void>;
  
  // Clean up expired sessions
  cleanupSessions(): Promise<void>;
}

interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  
  // Working context
  workingDirectory: string;
  environment: Record<string, string>;
  
  // Command history
  history: CommandHistoryEntry[];
  
  // File attachments
  attachments: AttachedFile[];
  
  // CLI process info
  cliProcess?: {
    pid: number;
    status: 'running' | 'completed' | 'failed';
    startTime: Date;
  };
  
  // Web client info
  webClients: WebClient[];
  
  // Session state
  state: SessionState;
}

interface CommandHistoryEntry {
  command: string;
  timestamp: Date;
  duration: number;
  exitCode: number;
  output?: string;
}

interface SessionState {
  agents: AgentInfo[];
  tasks: TaskInfo[];
  memory: MemoryInfo;
  config: ConfigInfo;
}
```

### Implementation

```typescript
class SessionManager {
  private sessions = new Map<string, Session>();
  private persistence: SessionPersistence;
  private cliSync: CLISync;
  
  constructor(private config: SessionConfig) {
    this.persistence = new SessionPersistence(config.persistenceOptions);
    this.cliSync = new CLISync(config.cliSyncOptions);
    this.startCleanupTimer();
  }
  
  async createSession(userId: string, options?: SessionOptions): Promise<Session> {
    const session: Session = {
      id: generateSessionId(),
      userId,
      createdAt: new Date(),
      lastActivity: new Date(),
      workingDirectory: options?.workingDirectory || process.cwd(),
      environment: { ...process.env, ...options?.environment },
      history: [],
      attachments: [],
      webClients: [],
      state: {
        agents: [],
        tasks: [],
        memory: { banks: [], totalSize: 0 },
        config: { loaded: false, valid: false }
      }
    };
    
    this.sessions.set(session.id, session);
    await this.persistence.save(session);
    
    return session;
  }
  
  async syncWithCLI(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Get latest state from CLI process
    const cliState = await this.cliSync.getState(sessionId);
    
    // Merge states
    session.state = this.mergeStates(session.state, cliState);
    session.lastActivity = new Date();
    
    // Notify web clients of state change
    this.notifyWebClients(session, 'state_updated', session.state);
    
    // Persist updated session
    await this.persistence.save(session);
  }
  
  private notifyWebClients(session: Session, event: string, data: any): void {
    for (const client of session.webClients) {
      if (client.socket && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({
          type: 'session_event',
          event,
          data,
          timestamp: Date.now()
        }));
      }
    }
  }
}
```

## File Handler

### File Upload and Management

The File Handler manages file uploads, validation, and access for both CLI and web interfaces.

```typescript
interface FileHandler {
  // Handle file uploads
  uploadFile(file: File, sessionId: string): Promise<AttachedFile>;
  
  // Validate file upload
  validateFile(file: File): FileValidationResult;
  
  // Store file temporarily
  storeFile(file: File, metadata: FileMetadata): Promise<string>;
  
  // Get file for CLI access
  getFileForCLI(fileId: string): Promise<string>;
  
  // Clean up temporary files
  cleanupFiles(sessionId: string): Promise<void>;
}

interface AttachedFile {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
  
  // Storage info
  storagePath: string;
  tempPath?: string;
  
  // Validation info
  validated: boolean;
  virusScan?: VirusScanResult;
  
  // Access info
  accessibleToCLI: boolean;
  permissions: FilePermissions;
}

interface FileValidationResult {
  isValid: boolean;
  reason?: string;
  warnings: string[];
  allowedOperations: FileOperation[];
}

type FileOperation = 'read' | 'write' | 'execute' | 'delete';
```

### Implementation

```typescript
class FileHandler {
  private storage: FileStorage;
  private validator: FileValidator;
  private virusScanner?: VirusScanner;
  
  constructor(private config: FileHandlerConfig) {
    this.storage = new FileStorage(config.storageOptions);
    this.validator = new FileValidator(config.validationRules);
    
    if (config.virusScanning.enabled) {
      this.virusScanner = new VirusScanner(config.virusScanning);
    }
  }
  
  async uploadFile(file: File, sessionId: string): Promise<AttachedFile> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.isValid) {
      throw new FileValidationError(`File validation failed: ${validation.reason}`);
    }
    
    // Generate file ID
    const fileId = generateFileId();
    
    // Store file
    const storagePath = await this.storage.store(file, {
      fileId,
      sessionId,
      originalName: file.name,
      mimeType: file.type
    });
    
    // Virus scan if enabled
    let virusScan: VirusScanResult | undefined;
    if (this.virusScanner) {
      virusScan = await this.virusScanner.scan(storagePath);
      if (!virusScan.clean) {
        await this.storage.delete(storagePath);
        throw new SecurityError(`File failed virus scan: ${virusScan.threat}`);
      }
    }
    
    // Create attached file record
    const attachedFile: AttachedFile = {
      id: fileId,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
      uploadedAt: new Date(),
      storagePath,
      validated: true,
      virusScan,
      accessibleToCLI: true,
      permissions: this.determinePermissions(file, validation)
    };
    
    return attachedFile;
  }
  
  async getFileForCLI(fileId: string): Promise<string> {
    const file = await this.storage.getMetadata(fileId);
    if (!file) {
      throw new Error(`File ${fileId} not found`);
    }
    
    if (!file.accessibleToCLI) {
      throw new SecurityError(`File ${fileId} not accessible to CLI`);
    }
    
    // Create symlink in CLI-accessible location
    const cliPath = path.join(this.config.cliAccessPath, fileId);
    await fs.symlink(file.storagePath, cliPath);
    
    return cliPath;
  }
  
  private determinePermissions(file: File, validation: FileValidationResult): FilePermissions {
    const permissions: FilePermissions = {
      read: true,
      write: false,
      execute: false,
      delete: true
    };
    
    // Determine based on file type and validation
    if (validation.allowedOperations.includes('execute')) {
      // Only allow execution for verified safe file types
      const safeExecutableTypes = ['.sh', '.py', '.js', '.ts'];
      const ext = path.extname(file.name).toLowerCase();
      permissions.execute = safeExecutableTypes.includes(ext);
    }
    
    return permissions;
  }
}
```

## Command Executor

### Unified Execution Pipeline

The Command Executor processes validated commands through a unified pipeline for both CLI and web interfaces.

```typescript
interface CommandExecutor {
  // Execute command
  execute(command: ParsedCommand, session: Session): Promise<ExecutionResult>;
  
  // Stream execution output
  streamExecution(command: ParsedCommand, session: Session): AsyncIterable<ExecutionUpdate>;
  
  // Handle command interruption
  interrupt(executionId: string): Promise<void>;
  
  // Get execution status
  getStatus(executionId: string): ExecutionStatus;
}

interface ExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  errorOutput?: string;
  duration: number;
  
  // Metadata
  executionId: string;
  command: ParsedCommand;
  startTime: Date;
  endTime: Date;
}

interface ExecutionUpdate {
  type: 'output' | 'error' | 'status' | 'complete';
  data: string;
  timestamp: number;
  executionId: string;
}
```

### Implementation

```typescript
class CommandExecutor {
  private executions = new Map<string, ExecutionContext>();
  private outputCapture: OutputCapture;
  
  constructor(private config: ExecutorConfig) {
    this.outputCapture = new OutputCapture(config.captureOptions);
  }
  
  async execute(command: ParsedCommand, session: Session): Promise<ExecutionResult> {
    const executionId = generateExecutionId();
    const startTime = new Date();
    
    try {
      // Prepare execution context
      const context = this.createExecutionContext(command, session, executionId);
      this.executions.set(executionId, context);
      
      // Build CLI command
      const cliCommand = this.buildCLICommand(command, session);
      
      // Execute with output capture
      const result = await this.executeCLICommand(cliCommand, context);
      
      // Create execution result
      const executionResult: ExecutionResult = {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output: result.stdout,
        errorOutput: result.stderr,
        duration: Date.now() - startTime.getTime(),
        executionId,
        command,
        startTime,
        endTime: new Date()
      };
      
      // Update session history
      await this.updateSessionHistory(session, command, executionResult);
      
      return executionResult;
    } finally {
      this.executions.delete(executionId);
    }
  }
  
  async *streamExecution(command: ParsedCommand, session: Session): AsyncIterable<ExecutionUpdate> {
    const executionId = generateExecutionId();
    const context = this.createExecutionContext(command, session, executionId);
    
    try {
      const cliCommand = this.buildCLICommand(command, session);
      const process = this.launchCLIProcess(cliCommand, context);
      
      // Stream stdout
      const stdoutStream = this.outputCapture.captureStream(process.stdout, 'stdout');
      for await (const chunk of stdoutStream) {
        yield {
          type: 'output',
          data: chunk.toString(),
          timestamp: Date.now(),
          executionId
        };
      }
      
      // Stream stderr
      const stderrStream = this.outputCapture.captureStream(process.stderr, 'stderr');
      for await (const chunk of stderrStream) {
        yield {
          type: 'error',
          data: chunk.toString(),
          timestamp: Date.now(),
          executionId
        };
      }
      
      // Wait for completion
      const exitCode = await process.wait();
      yield {
        type: 'complete',
        data: JSON.stringify({ exitCode }),
        timestamp: Date.now(),
        executionId
      };
    } finally {
      this.executions.delete(executionId);
    }
  }
  
  private buildCLICommand(command: ParsedCommand, session: Session): string[] {
    const args = [command.executable];
    
    if (command.subcommand) {
      args.push(command.subcommand);
    }
    
    // Add flags
    for (const [flag, value] of command.flags) {
      if (flag.length === 1) {
        args.push(`-${flag}`);
      } else {
        args.push(`--${flag}`);
      }
      
      if (typeof value === 'string') {
        args.push(value);
      }
    }
    
    // Add arguments
    args.push(...command.args);
    
    // Add file paths
    for (const file of command.files) {
      const cliPath = this.getFilePathForCLI(file);
      args.push(cliPath);
    }
    
    return args;
  }
}
```

## Integration Points

### Web UI Integration

```typescript
interface WebUIIntegration {
  // Handle input from web interface
  handleWebInput(input: WebInputMessage): Promise<void>;
  
  // Send updates to web clients
  sendToWebClients(sessionId: string, update: any): void;
  
  // Manage web client connections
  manageConnections(): void;
}

interface WebInputMessage {
  type: 'command' | 'file' | 'interrupt';
  sessionId: string;
  clientId: string;
  payload: any;
}
```

### CLI Integration

```typescript
interface CLIIntegration {
  // Check if running in web mode
  isWebMode(): boolean;
  
  // Get session information
  getSessionInfo(): SessionInfo | null;
  
  // Send state updates
  sendStateUpdate(state: any): Promise<void>;
  
  // Handle web client commands
  handleWebCommand(command: string): Promise<any>;
}
```

## Error Handling

### Comprehensive Error Management

```typescript
interface ErrorHandler {
  // Handle input errors
  handleInputError(error: Error, input: UserInput): Promise<ErrorResponse>;
  
  // Handle parsing errors
  handleParseError(error: ParseError, command: string): ErrorResponse;
  
  // Handle execution errors
  handleExecutionError(error: Error, execution: ExecutionContext): Promise<ErrorResponse>;
  
  // Handle file errors
  handleFileError(error: FileError, operation: FileOperation): ErrorResponse;
}

interface ErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    code: string;
    details?: any;
  };
  recovery?: RecoveryAction[];
}

interface RecoveryAction {
  type: 'retry' | 'fix' | 'ignore' | 'escalate';
  description: string;
  action: () => Promise<void>;
}
```

## Performance Optimizations

### Input Processing Optimizations

```typescript
interface PerformanceOptimizer {
  // Cache parsed commands
  cacheCommand(command: string, parsed: ParsedCommand): void;
  
  // Batch input validation
  batchValidate(inputs: UserInput[]): Promise<ValidationResult[]>;
  
  // Optimize file operations
  optimizeFileOps(files: File[]): Promise<OptimizedFileOps>;
  
  // Preload session data
  preloadSession(sessionId: string): Promise<void>;
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('InputRouter', () => {
  test('should route command input correctly', async () => {
    const router = new InputRouter(mockConfig);
    const input: UserInput = {
      type: 'command',
      source: 'web',
      content: 'claude-flow status',
      sessionId: 'test-session',
      timestamp: Date.now()
    };
    
    const result = await router.route(input);
    
    expect(result.success).toBe(true);
    expect(result.handlerType).toBe('command');
  });
  
  test('should reject malicious input', async () => {
    const router = new InputRouter(mockConfig);
    const input: UserInput = {
      type: 'command',
      source: 'web',
      content: 'rm -rf / && malicious-command',
      sessionId: 'test-session',
      timestamp: Date.now()
    };
    
    const result = await router.route(input);
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Security threat detected');
  });
});
```

### Integration Tests

```typescript
describe('End-to-End Input Processing', () => {
  test('should process web command and return CLI output', async () => {
    const system = new InputHandlingSystem(testConfig);
    await system.initialize();
    
    const session = await system.createSession('test-user');
    const result = await system.processInput({
      type: 'command',
      source: 'web',
      content: 'claude-flow --version',
      sessionId: session.id,
      timestamp: Date.now()
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

## Summary

This user input handling system provides:

1. **Unified Processing**: Single pipeline for CLI and web inputs
2. **Security First**: Comprehensive validation and sanitization
3. **File Support**: Seamless file upload and attachment handling
4. **Session Management**: Persistent context across interfaces
5. **Real-time Processing**: Sub-100ms input processing latency
6. **Backward Compatibility**: Existing CLI behavior unchanged
7. **Error Recovery**: Robust error handling and user guidance

The architecture ensures that users can interact with claude-flow through both CLI and web interfaces seamlessly, with full security and performance optimization while maintaining complete compatibility with existing CLI operations.