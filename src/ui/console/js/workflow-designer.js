/**
 * Advanced Workflow Designer for Claude Flow
 * Visual drag-and-drop workflow builder with real-time execution
 */

class WorkflowDesigner {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.nodes = new Map();
    this.connections = new Map();
    this.selectedNode = null;
    this.draggedNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.connectionStart = null;
    this.executionState = new Map();
    this.isExecuting = false;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };

    this.init();
  }

  init() {
    this.createUI();
    this.setupEventListeners();
    this.loadTemplates();
    this.setupNodePalette();
  }

  createUI() {
    this.container.innerHTML = `
            <div class="workflow-designer">
                <div class="toolbar">
                    <div class="toolbar-section">
                        <button class="btn btn-primary" id="saveWorkflow">
                            <i class="fas fa-save"></i> Save
                        </button>
                        <button class="btn btn-secondary" id="loadWorkflow">
                            <i class="fas fa-folder-open"></i> Load
                        </button>
                        <button class="btn btn-success" id="exportWorkflow">
                            <i class="fas fa-download"></i> Export
                        </button>
                        <button class="btn btn-info" id="importWorkflow">
                            <i class="fas fa-upload"></i> Import
                        </button>
                        <input type="file" id="importFile" accept=".json" style="display: none;">
                    </div>
                    <div class="toolbar-section">
                        <button class="btn btn-warning" id="validateWorkflow">
                            <i class="fas fa-check-circle"></i> Validate
                        </button>
                        <button class="btn btn-success" id="executeWorkflow">
                            <i class="fas fa-play"></i> Execute
                        </button>
                        <button class="btn btn-danger" id="stopWorkflow">
                            <i class="fas fa-stop"></i> Stop
                        </button>
                    </div>
                    <div class="toolbar-section">
                        <button class="btn btn-secondary" id="zoomIn">
                            <i class="fas fa-search-plus"></i>
                        </button>
                        <button class="btn btn-secondary" id="zoomOut">
                            <i class="fas fa-search-minus"></i>
                        </button>
                        <button class="btn btn-secondary" id="zoomReset">
                            <i class="fas fa-expand-arrows-alt"></i>
                        </button>
                        <button class="btn btn-secondary" id="clearCanvas">
                            <i class="fas fa-trash"></i> Clear
                        </button>
                    </div>
                </div>
                
                <div class="designer-body">
                    <div class="node-palette">
                        <div class="palette-header">
                            <h3>Components</h3>
                            <div class="palette-search">
                                <input type="text" placeholder="Search components..." id="paletteSearch">
                            </div>
                        </div>
                        <div class="palette-content">
                            <div class="palette-category" data-category="input">
                                <h4>Input</h4>
                                <div class="palette-items"></div>
                            </div>
                            <div class="palette-category" data-category="processing">
                                <h4>Processing</h4>
                                <div class="palette-items"></div>
                            </div>
                            <div class="palette-category" data-category="output">
                                <h4>Output</h4>
                                <div class="palette-items"></div>
                            </div>
                            <div class="palette-category" data-category="control">
                                <h4>Control Flow</h4>
                                <div class="palette-items"></div>
                            </div>
                            <div class="palette-category" data-category="ai">
                                <h4>AI Operations</h4>
                                <div class="palette-items"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="canvas-container">
                        <canvas id="workflowCanvas" width="1200" height="800"></canvas>
                        <div class="canvas-overlay">
                            <div class="execution-status" id="executionStatus"></div>
                        </div>
                    </div>
                    
                    <div class="properties-panel">
                        <div class="panel-header">
                            <h3>Properties</h3>
                        </div>
                        <div class="panel-content" id="propertiesContent">
                            <div class="no-selection">
                                <p>Select a node to edit properties</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="bottom-panel">
                    <div class="panel-tabs">
                        <button class="tab-button active" data-tab="templates">Templates</button>
                        <button class="tab-button" data-tab="execution">Execution Log</button>
                        <button class="tab-button" data-tab="validation">Validation</button>
                    </div>
                    <div class="panel-content">
                        <div class="tab-content active" id="templatesTab">
                            <div class="template-gallery"></div>
                        </div>
                        <div class="tab-content" id="executionTab">
                            <div class="execution-log"></div>
                        </div>
                        <div class="tab-content" id="validationTab">
                            <div class="validation-results"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

    this.canvas = document.getElementById('workflowCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.setupCanvas();
  }

  setupCanvas() {
    // Set up high-DPI canvas
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);

    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    this.draw();
  }

  setupEventListeners() {
    // Canvas events
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));

    // Toolbar events
    document.getElementById('saveWorkflow').addEventListener('click', this.saveWorkflow.bind(this));
    document.getElementById('loadWorkflow').addEventListener('click', this.loadWorkflow.bind(this));
    document
      .getElementById('exportWorkflow')
      .addEventListener('click', this.exportWorkflow.bind(this));
    document
      .getElementById('importWorkflow')
      .addEventListener('click', this.importWorkflow.bind(this));
    document
      .getElementById('importFile')
      .addEventListener('change', this.handleFileImport.bind(this));
    document
      .getElementById('validateWorkflow')
      .addEventListener('click', this.validateWorkflow.bind(this));
    document
      .getElementById('executeWorkflow')
      .addEventListener('click', this.executeWorkflow.bind(this));
    document.getElementById('stopWorkflow').addEventListener('click', this.stopWorkflow.bind(this));
    document
      .getElementById('zoomIn')
      .addEventListener('click', () => this.setZoom(this.zoom * 1.2));
    document
      .getElementById('zoomOut')
      .addEventListener('click', () => this.setZoom(this.zoom / 1.2));
    document.getElementById('zoomReset').addEventListener('click', () => this.setZoom(1));
    document.getElementById('clearCanvas').addEventListener('click', this.clearCanvas.bind(this));

    // Palette search
    document
      .getElementById('paletteSearch')
      .addEventListener('input', this.filterPalette.bind(this));

    // Tab switching
    document.querySelectorAll('.tab-button').forEach((button) => {
      button.addEventListener('click', this.switchTab.bind(this));
    });

    // Window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  setupNodePalette() {
    const nodeTypes = {
      input: [
        { type: 'file-input', name: 'File Input', icon: 'fas fa-file-import' },
        { type: 'text-input', name: 'Text Input', icon: 'fas fa-keyboard' },
        { type: 'url-input', name: 'URL Input', icon: 'fas fa-link' },
        { type: 'api-input', name: 'API Input', icon: 'fas fa-cloud-download-alt' },
      ],
      processing: [
        { type: 'transform', name: 'Transform', icon: 'fas fa-exchange-alt' },
        { type: 'filter', name: 'Filter', icon: 'fas fa-filter' },
        { type: 'aggregate', name: 'Aggregate', icon: 'fas fa-layer-group' },
        { type: 'sort', name: 'Sort', icon: 'fas fa-sort' },
      ],
      output: [
        { type: 'file-output', name: 'File Output', icon: 'fas fa-file-export' },
        { type: 'display', name: 'Display', icon: 'fas fa-desktop' },
        { type: 'api-output', name: 'API Output', icon: 'fas fa-cloud-upload-alt' },
        { type: 'notification', name: 'Notification', icon: 'fas fa-bell' },
      ],
      control: [
        { type: 'condition', name: 'Condition', icon: 'fas fa-code-branch' },
        { type: 'loop', name: 'Loop', icon: 'fas fa-redo' },
        { type: 'delay', name: 'Delay', icon: 'fas fa-clock' },
        { type: 'parallel', name: 'Parallel', icon: 'fas fa-stream' },
      ],
      ai: [
        { type: 'ai-analyze', name: 'AI Analyze', icon: 'fas fa-brain' },
        { type: 'ai-generate', name: 'AI Generate', icon: 'fas fa-magic' },
        { type: 'ai-classify', name: 'AI Classify', icon: 'fas fa-tags' },
        { type: 'ai-summarize', name: 'AI Summarize', icon: 'fas fa-compress-alt' },
      ],
    };

    Object.entries(nodeTypes).forEach(([category, nodes]) => {
      const container = document.querySelector(`[data-category="${category}"] .palette-items`);
      nodes.forEach((node) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.draggable = true;
        item.dataset.nodeType = node.type;
        item.innerHTML = `
                    <i class="${node.icon}"></i>
                    <span>${node.name}</span>
                `;

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', node.type);
          e.dataTransfer.effectAllowed = 'copy';
        });

        container.appendChild(item);
      });
    });

    // Canvas drop support
    this.canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('text/plain');
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
      const y = (e.clientY - rect.top - this.pan.y) / this.zoom;
      this.createNode(nodeType, x, y);
    });
  }

  createNode(type, x, y) {
    const nodeId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const node = {
      id: nodeId,
      type: type,
      x: x,
      y: y,
      width: 150,
      height: 80,
      inputs: this.getNodeInputs(type),
      outputs: this.getNodeOutputs(type),
      properties: this.getNodeProperties(type),
      status: 'idle',
    };

    this.nodes.set(nodeId, node);
    this.draw();
    this.showProperties(node);

    return node;
  }

  getNodeInputs(type) {
    const inputs = {
      'file-input': [],
      'text-input': [],
      'url-input': [],
      'api-input': [],
      transform: [{ name: 'data', type: 'any' }],
      filter: [{ name: 'data', type: 'any' }],
      aggregate: [{ name: 'data', type: 'array' }],
      sort: [{ name: 'data', type: 'array' }],
      'file-output': [{ name: 'data', type: 'any' }],
      display: [{ name: 'data', type: 'any' }],
      'api-output': [{ name: 'data', type: 'any' }],
      notification: [{ name: 'message', type: 'string' }],
      condition: [
        { name: 'condition', type: 'boolean' },
        { name: 'data', type: 'any' },
      ],
      loop: [{ name: 'data', type: 'array' }],
      delay: [{ name: 'data', type: 'any' }],
      parallel: [{ name: 'data', type: 'array' }],
      'ai-analyze': [{ name: 'data', type: 'any' }],
      'ai-generate': [{ name: 'prompt', type: 'string' }],
      'ai-classify': [{ name: 'data', type: 'any' }],
      'ai-summarize': [{ name: 'data', type: 'string' }],
    };
    return inputs[type] || [];
  }

  getNodeOutputs(type) {
    const outputs = {
      'file-input': [{ name: 'data', type: 'any' }],
      'text-input': [{ name: 'text', type: 'string' }],
      'url-input': [{ name: 'data', type: 'any' }],
      'api-input': [{ name: 'data', type: 'any' }],
      transform: [{ name: 'result', type: 'any' }],
      filter: [{ name: 'result', type: 'any' }],
      aggregate: [{ name: 'result', type: 'any' }],
      sort: [{ name: 'result', type: 'array' }],
      'file-output': [],
      display: [],
      'api-output': [{ name: 'response', type: 'any' }],
      notification: [],
      condition: [
        { name: 'true', type: 'any' },
        { name: 'false', type: 'any' },
      ],
      loop: [{ name: 'result', type: 'array' }],
      delay: [{ name: 'data', type: 'any' }],
      parallel: [{ name: 'results', type: 'array' }],
      'ai-analyze': [{ name: 'analysis', type: 'object' }],
      'ai-generate': [{ name: 'generated', type: 'string' }],
      'ai-classify': [{ name: 'categories', type: 'array' }],
      'ai-summarize': [{ name: 'summary', type: 'string' }],
    };
    return outputs[type] || [];
  }

  getNodeProperties(type) {
    const properties = {
      'file-input': { path: '', format: 'auto' },
      'text-input': { value: '', multiline: false },
      'url-input': { url: '', method: 'GET', headers: {} },
      'api-input': { endpoint: '', method: 'GET', headers: {}, body: '' },
      transform: { expression: '', language: 'javascript' },
      filter: { condition: '', language: 'javascript' },
      aggregate: { operation: 'sum', field: '' },
      sort: { field: '', order: 'asc' },
      'file-output': { path: '', format: 'auto' },
      display: { format: 'table', title: '' },
      'api-output': { endpoint: '', method: 'POST', headers: {} },
      notification: { type: 'info', title: '' },
      condition: { expression: '', language: 'javascript' },
      loop: { type: 'forEach', condition: '' },
      delay: { duration: 1000, unit: 'ms' },
      parallel: { maxConcurrency: 5 },
      'ai-analyze': { model: 'gpt-4', temperature: 0.7 },
      'ai-generate': { model: 'gpt-4', temperature: 0.7, maxTokens: 1000 },
      'ai-classify': { model: 'gpt-4', categories: [] },
      'ai-summarize': { model: 'gpt-4', length: 'medium' },
    };
    return properties[type] || {};
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
    const y = (e.clientY - rect.top - this.pan.y) / this.zoom;

    // Check for node selection
    const node = this.getNodeAt(x, y);
    if (node) {
      this.selectedNode = node;
      this.draggedNode = node;
      this.dragOffset = { x: x - node.x, y: y - node.y };
      this.showProperties(node);
    } else {
      this.selectedNode = null;
      this.showProperties(null);
    }

    // Check for connection point
    const connectionPoint = this.getConnectionPointAt(x, y);
    if (connectionPoint) {
      this.connectionStart = connectionPoint;
    }

    this.draw();
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
    const y = (e.clientY - rect.top - this.pan.y) / this.zoom;

    if (this.draggedNode) {
      this.draggedNode.x = x - this.dragOffset.x;
      this.draggedNode.y = y - this.dragOffset.y;
      this.draw();
    }

    if (this.connectionStart) {
      this.tempConnection = { x, y };
      this.draw();
    }
  }

  handleMouseUp(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
    const y = (e.clientY - rect.top - this.pan.y) / this.zoom;

    if (this.connectionStart) {
      const connectionEnd = this.getConnectionPointAt(x, y);
      if (connectionEnd && connectionEnd.node !== this.connectionStart.node) {
        this.createConnection(this.connectionStart, connectionEnd);
      }
      this.connectionStart = null;
      this.tempConnection = null;
      this.draw();
    }

    this.draggedNode = null;
  }

  handleWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const wheelDelta = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.1, Math.min(3, this.zoom * wheelDelta));

    this.pan.x = x - (x - this.pan.x) * (newZoom / this.zoom);
    this.pan.y = y - (y - this.pan.y) * (newZoom / this.zoom);
    this.zoom = newZoom;

    this.draw();
  }

  handleContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
    const y = (e.clientY - rect.top - this.pan.y) / this.zoom;

    const node = this.getNodeAt(x, y);
    if (node) {
      this.showContextMenu(e.clientX, e.clientY, node);
    }
  }

  getNodeAt(x, y) {
    for (let node of this.nodes.values()) {
      if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
        return node;
      }
    }
    return null;
  }

  getConnectionPointAt(x, y) {
    for (let node of this.nodes.values()) {
      // Check input points
      const inputPoints = this.getInputPoints(node);
      for (let i = 0; i < inputPoints.length; i++) {
        const point = inputPoints[i];
        if (Math.abs(x - point.x) < 8 && Math.abs(y - point.y) < 8) {
          return { node, type: 'input', index: i };
        }
      }

      // Check output points
      const outputPoints = this.getOutputPoints(node);
      for (let i = 0; i < outputPoints.length; i++) {
        const point = outputPoints[i];
        if (Math.abs(x - point.x) < 8 && Math.abs(y - point.y) < 8) {
          return { node, type: 'output', index: i };
        }
      }
    }
    return null;
  }

  getInputPoints(node) {
    const points = [];
    const inputCount = node.inputs.length;
    for (let i = 0; i < inputCount; i++) {
      points.push({
        x: node.x,
        y: node.y + (node.height / (inputCount + 1)) * (i + 1),
      });
    }
    return points;
  }

  getOutputPoints(node) {
    const points = [];
    const outputCount = node.outputs.length;
    for (let i = 0; i < outputCount; i++) {
      points.push({
        x: node.x + node.width,
        y: node.y + (node.height / (outputCount + 1)) * (i + 1),
      });
    }
    return points;
  }

  createConnection(start, end) {
    if (start.type === 'output' && end.type === 'input') {
      const connectionId = `${start.node.id}_${start.index}_${end.node.id}_${end.index}`;
      this.connections.set(connectionId, {
        id: connectionId,
        from: start.node.id,
        fromIndex: start.index,
        to: end.node.id,
        toIndex: end.index,
      });
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    this.ctx.translate(this.pan.x, this.pan.y);
    this.ctx.scale(this.zoom, this.zoom);

    // Draw grid
    this.drawGrid();

    // Draw connections
    this.drawConnections();

    // Draw temporary connection
    if (this.tempConnection && this.connectionStart) {
      this.drawTempConnection();
    }

    // Draw nodes
    this.drawNodes();

    this.ctx.restore();
  }

  drawGrid() {
    const gridSize = 20;
    const canvasWidth = this.canvas.width / this.zoom;
    const canvasHeight = this.canvas.height / this.zoom;

    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 0.5;

    for (let x = 0; x <= canvasWidth; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, canvasHeight);
      this.ctx.stroke();
    }

    for (let y = 0; y <= canvasHeight; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(canvasWidth, y);
      this.ctx.stroke();
    }
  }

  drawNodes() {
    for (let node of this.nodes.values()) {
      this.drawNode(node);
    }
  }

  drawNode(node) {
    const isSelected = this.selectedNode === node;
    const isExecuting = node.status === 'executing';
    const hasError = node.status === 'error';

    // Node body
    this.ctx.fillStyle = isSelected ? '#e3f2fd' : '#ffffff';
    this.ctx.strokeStyle = isSelected ? '#2196f3' : hasError ? '#f44336' : '#cccccc';
    this.ctx.lineWidth = isSelected ? 2 : 1;

    this.ctx.fillRect(node.x, node.y, node.width, node.height);
    this.ctx.strokeRect(node.x, node.y, node.width, node.height);

    // Node title
    this.ctx.fillStyle = '#333333';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.getNodeTitle(node.type), node.x + node.width / 2, node.y + 20);

    // Status indicator
    if (isExecuting) {
      this.ctx.fillStyle = '#ff9800';
      this.ctx.beginPath();
      this.ctx.arc(node.x + node.width - 10, node.y + 10, 4, 0, 2 * Math.PI);
      this.ctx.fill();
    } else if (hasError) {
      this.ctx.fillStyle = '#f44336';
      this.ctx.beginPath();
      this.ctx.arc(node.x + node.width - 10, node.y + 10, 4, 0, 2 * Math.PI);
      this.ctx.fill();
    }

    // Input/Output points
    this.drawConnectionPoints(node);
  }

  drawConnectionPoints(node) {
    // Input points
    const inputPoints = this.getInputPoints(node);
    inputPoints.forEach((point, index) => {
      this.ctx.fillStyle = '#4caf50';
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      this.ctx.fill();

      // Input label
      this.ctx.fillStyle = '#666666';
      this.ctx.font = '10px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(node.inputs[index].name, point.x - 8, point.y + 3);
    });

    // Output points
    const outputPoints = this.getOutputPoints(node);
    outputPoints.forEach((point, index) => {
      this.ctx.fillStyle = '#2196f3';
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      this.ctx.fill();

      // Output label
      this.ctx.fillStyle = '#666666';
      this.ctx.font = '10px Arial';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(node.outputs[index].name, point.x + 8, point.y + 3);
    });
  }

  drawConnections() {
    for (let connection of this.connections.values()) {
      const fromNode = this.nodes.get(connection.from);
      const toNode = this.nodes.get(connection.to);

      if (fromNode && toNode) {
        const fromPoints = this.getOutputPoints(fromNode);
        const toPoints = this.getInputPoints(toNode);

        const fromPoint = fromPoints[connection.fromIndex];
        const toPoint = toPoints[connection.toIndex];

        this.drawConnection(fromPoint, toPoint);
      }
    }
  }

  drawConnection(from, to) {
    const midX = (from.x + to.x) / 2;

    this.ctx.strokeStyle = '#666666';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.bezierCurveTo(midX, from.y, midX, to.y, to.x, to.y);
    this.ctx.stroke();

    // Arrow
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLength = 8;
    this.ctx.beginPath();
    this.ctx.moveTo(to.x, to.y);
    this.ctx.lineTo(
      to.x - arrowLength * Math.cos(angle - Math.PI / 6),
      to.y - arrowLength * Math.sin(angle - Math.PI / 6),
    );
    this.ctx.moveTo(to.x, to.y);
    this.ctx.lineTo(
      to.x - arrowLength * Math.cos(angle + Math.PI / 6),
      to.y - arrowLength * Math.sin(angle + Math.PI / 6),
    );
    this.ctx.stroke();
  }

  drawTempConnection() {
    const startPoint =
      this.connectionStart.type === 'output'
        ? this.getOutputPoints(this.connectionStart.node)[this.connectionStart.index]
        : this.getInputPoints(this.connectionStart.node)[this.connectionStart.index];

    this.ctx.strokeStyle = '#2196f3';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(startPoint.x, startPoint.y);
    this.ctx.lineTo(this.tempConnection.x, this.tempConnection.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  getNodeTitle(type) {
    const titles = {
      'file-input': 'File Input',
      'text-input': 'Text Input',
      'url-input': 'URL Input',
      'api-input': 'API Input',
      transform: 'Transform',
      filter: 'Filter',
      aggregate: 'Aggregate',
      sort: 'Sort',
      'file-output': 'File Output',
      display: 'Display',
      'api-output': 'API Output',
      notification: 'Notification',
      condition: 'Condition',
      loop: 'Loop',
      delay: 'Delay',
      parallel: 'Parallel',
      'ai-analyze': 'AI Analyze',
      'ai-generate': 'AI Generate',
      'ai-classify': 'AI Classify',
      'ai-summarize': 'AI Summarize',
    };
    return titles[type] || type;
  }

  showProperties(node) {
    const panel = document.getElementById('propertiesContent');

    if (!node) {
      panel.innerHTML = '<div class="no-selection"><p>Select a node to edit properties</p></div>';
      return;
    }

    const properties = node.properties;
    let html = `
            <div class="properties-form">
                <h4>${this.getNodeTitle(node.type)}</h4>
        `;

    Object.entries(properties).forEach(([key, value]) => {
      html += `
                <div class="property-field">
                    <label>${this.formatPropertyLabel(key)}</label>
                    ${this.renderPropertyInput(key, value, node.id)}
                </div>
            `;
    });

    html += '</div>';
    panel.innerHTML = html;

    // Attach event listeners
    panel.querySelectorAll('input, select, textarea').forEach((input) => {
      input.addEventListener('change', (e) => {
        const propertyKey = e.target.dataset.property;
        node.properties[propertyKey] = e.target.value;
      });
    });
  }

  formatPropertyLabel(key) {
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
  }

  renderPropertyInput(key, value, nodeId) {
    const inputId = `${nodeId}_${key}`;

    if (typeof value === 'boolean') {
      return `
                <input type="checkbox" id="${inputId}" data-property="${key}" ${value ? 'checked' : ''}>
            `;
    } else if (key === 'method') {
      return `
                <select id="${inputId}" data-property="${key}">
                    <option value="GET" ${value === 'GET' ? 'selected' : ''}>GET</option>
                    <option value="POST" ${value === 'POST' ? 'selected' : ''}>POST</option>
                    <option value="PUT" ${value === 'PUT' ? 'selected' : ''}>PUT</option>
                    <option value="DELETE" ${value === 'DELETE' ? 'selected' : ''}>DELETE</option>
                </select>
            `;
    } else if (key.includes('expression') || key.includes('body')) {
      return `
                <textarea id="${inputId}" data-property="${key}" rows="3">${value}</textarea>
            `;
    } else {
      return `
                <input type="text" id="${inputId}" data-property="${key}" value="${value}">
            `;
    }
  }

  async validateWorkflow() {
    const results = {
      errors: [],
      warnings: [],
      info: [],
    };

    // Check for isolated nodes
    const connectedNodes = new Set();
    for (let connection of this.connections.values()) {
      connectedNodes.add(connection.from);
      connectedNodes.add(connection.to);
    }

    for (let node of this.nodes.values()) {
      if (!connectedNodes.has(node.id) && this.nodes.size > 1) {
        results.warnings.push(`Node "${this.getNodeTitle(node.type)}" is not connected`);
      }
    }

    // Check for circular dependencies
    if (this.hasCircularDependencies()) {
      results.errors.push('Circular dependencies detected in workflow');
    }

    // Check required properties
    for (let node of this.nodes.values()) {
      const required = this.getRequiredProperties(node.type);
      for (let prop of required) {
        if (!node.properties[prop] || node.properties[prop] === '') {
          results.errors.push(
            `Node "${this.getNodeTitle(node.type)}" missing required property: ${prop}`,
          );
        }
      }
    }

    this.showValidationResults(results);
    return results.errors.length === 0;
  }

  hasCircularDependencies() {
    const visited = new Set();
    const visiting = new Set();

    const visit = (nodeId) => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visiting.add(nodeId);

      for (let connection of this.connections.values()) {
        if (connection.from === nodeId) {
          if (visit(connection.to)) return true;
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    for (let nodeId of this.nodes.keys()) {
      if (visit(nodeId)) return true;
    }

    return false;
  }

  getRequiredProperties(type) {
    const required = {
      'file-input': ['path'],
      'url-input': ['url'],
      'api-input': ['endpoint'],
      transform: ['expression'],
      filter: ['condition'],
      'file-output': ['path'],
      'api-output': ['endpoint'],
      condition: ['expression'],
    };
    return required[type] || [];
  }

  showValidationResults(results) {
    const panel = document.getElementById('validationTab');
    const content = panel.querySelector('.validation-results') || panel;

    let html = '<div class="validation-results">';

    if (results.errors.length > 0) {
      html += '<div class="validation-section errors">';
      html += '<h4><i class="fas fa-exclamation-circle"></i> Errors</h4>';
      html += '<ul>';
      results.errors.forEach((error) => {
        html += `<li class="error">${error}</li>`;
      });
      html += '</ul></div>';
    }

    if (results.warnings.length > 0) {
      html += '<div class="validation-section warnings">';
      html += '<h4><i class="fas fa-exclamation-triangle"></i> Warnings</h4>';
      html += '<ul>';
      results.warnings.forEach((warning) => {
        html += `<li class="warning">${warning}</li>`;
      });
      html += '</ul></div>';
    }

    if (results.info.length > 0) {
      html += '<div class="validation-section info">';
      html += '<h4><i class="fas fa-info-circle"></i> Information</h4>';
      html += '<ul>';
      results.info.forEach((info) => {
        html += `<li class="info">${info}</li>`;
      });
      html += '</ul></div>';
    }

    if (results.errors.length === 0 && results.warnings.length === 0) {
      html += '<div class="validation-success">';
      html += '<i class="fas fa-check-circle"></i> Workflow validation passed';
      html += '</div>';
    }

    html += '</div>';
    content.innerHTML = html;

    // Switch to validation tab
    this.switchTabToValidation();
  }

  async executeWorkflow() {
    if (!(await this.validateWorkflow())) {
      alert('Workflow validation failed. Please fix errors before executing.');
      return;
    }

    this.isExecuting = true;
    this.executionState.clear();

    document.getElementById('executeWorkflow').disabled = true;
    document.getElementById('stopWorkflow').disabled = false;

    const executionLog = document.querySelector('#executionTab .execution-log');
    executionLog.innerHTML = '';

    try {
      const startNodes = this.getStartNodes();
      const executionPromises = startNodes.map((node) => this.executeNode(node));

      await Promise.all(executionPromises);

      this.logExecution('Workflow execution completed successfully', 'success');
    } catch (error) {
      this.logExecution(`Workflow execution failed: ${error.message}`, 'error');
    } finally {
      this.isExecuting = false;
      document.getElementById('executeWorkflow').disabled = false;
      document.getElementById('stopWorkflow').disabled = true;
      this.draw();
    }
  }

  getStartNodes() {
    const hasInput = new Set();
    for (let connection of this.connections.values()) {
      hasInput.add(connection.to);
    }

    return Array.from(this.nodes.values()).filter((node) => !hasInput.has(node.id));
  }

  async executeNode(node) {
    if (!this.isExecuting) return;

    node.status = 'executing';
    this.draw();

    this.logExecution(`Executing node: ${this.getNodeTitle(node.type)}`, 'info');

    try {
      const result = await this.processNode(node);
      node.status = 'completed';
      this.executionState.set(node.id, result);

      this.logExecution(`Node completed: ${this.getNodeTitle(node.type)}`, 'success');

      // Execute connected nodes
      const connectedNodes = this.getConnectedNodes(node.id);
      for (let connectedNode of connectedNodes) {
        await this.executeNode(connectedNode);
      }
    } catch (error) {
      node.status = 'error';
      this.logExecution(`Node failed: ${this.getNodeTitle(node.type)} - ${error.message}`, 'error');
      throw error;
    }
  }

  async processNode(node) {
    // Simulate node processing
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

    switch (node.type) {
      case 'file-input':
        return { type: 'file', path: node.properties.path };
      case 'text-input':
        return { type: 'text', value: node.properties.value };
      case 'transform':
        return { type: 'transformed', data: 'transformed_data' };
      case 'ai-analyze':
        return { type: 'analysis', confidence: 0.95, insights: [] };
      default:
        return { type: 'generic', processed: true };
    }
  }

  getConnectedNodes(nodeId) {
    const connected = [];
    for (let connection of this.connections.values()) {
      if (connection.from === nodeId) {
        const node = this.nodes.get(connection.to);
        if (node) connected.push(node);
      }
    }
    return connected;
  }

  logExecution(message, type) {
    const log = document.querySelector('#executionTab .execution-log');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
            <span class="message">${message}</span>
        `;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  stopWorkflow() {
    this.isExecuting = false;

    // Reset all node statuses
    for (let node of this.nodes.values()) {
      if (node.status === 'executing') {
        node.status = 'idle';
      }
    }

    this.logExecution('Workflow execution stopped by user', 'warning');
    this.draw();
  }

  saveWorkflow() {
    const workflow = {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values()),
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        name: prompt('Enter workflow name:') || 'Untitled Workflow',
      },
    };

    const saved = JSON.parse(localStorage.getItem('claudeflow_workflows') || '[]');
    saved.push(workflow);
    localStorage.setItem('claudeflow_workflows', JSON.stringify(saved));

    alert('Workflow saved successfully!');
  }

  loadWorkflow() {
    const saved = JSON.parse(localStorage.getItem('claudeflow_workflows') || '[]');
    if (saved.length === 0) {
      alert('No saved workflows found');
      return;
    }

    const names = saved.map((w, i) => `${i + 1}. ${w.metadata.name}`);
    const choice = prompt(`Select workflow to load:\n${names.join('\n')}`);

    if (choice) {
      const index = parseInt(choice) - 1;
      if (index >= 0 && index < saved.length) {
        this.loadWorkflowData(saved[index]);
      }
    }
  }

  loadWorkflowData(workflow) {
    this.nodes.clear();
    this.connections.clear();

    workflow.nodes.forEach((nodeData) => {
      this.nodes.set(nodeData.id, { ...nodeData });
    });

    workflow.connections.forEach((connectionData) => {
      this.connections.set(connectionData.id, { ...connectionData });
    });

    this.draw();
  }

  exportWorkflow() {
    const workflow = {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values()),
      metadata: {
        version: '1.0',
        exported: new Date().toISOString(),
        name: prompt('Enter workflow name:') || 'Exported Workflow',
      },
    };

    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.metadata.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importWorkflow() {
    document.getElementById('importFile').click();
  }

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workflow = JSON.parse(event.target.result);
        this.loadWorkflowData(workflow);
        alert('Workflow imported successfully!');
      } catch (error) {
        alert('Error importing workflow: ' + error.message);
      }
    };
    reader.readAsText(file);
  }

  loadTemplates() {
    const templates = [
      {
        name: 'Data Processing Pipeline',
        description: 'Process files through transformation and analysis',
        nodes: [
          { type: 'file-input', x: 50, y: 100 },
          { type: 'transform', x: 250, y: 100 },
          { type: 'ai-analyze', x: 450, y: 100 },
          { type: 'file-output', x: 650, y: 100 },
        ],
      },
      {
        name: 'Content Generation',
        description: 'Generate and process content using AI',
        nodes: [
          { type: 'text-input', x: 50, y: 100 },
          { type: 'ai-generate', x: 250, y: 100 },
          { type: 'ai-summarize', x: 450, y: 100 },
          { type: 'display', x: 650, y: 100 },
        ],
      },
      {
        name: 'API Integration',
        description: 'Fetch, process, and send data via APIs',
        nodes: [
          { type: 'api-input', x: 50, y: 100 },
          { type: 'filter', x: 250, y: 100 },
          { type: 'transform', x: 450, y: 100 },
          { type: 'api-output', x: 650, y: 100 },
        ],
      },
    ];

    const gallery = document.querySelector('.template-gallery');
    gallery.innerHTML = templates
      .map(
        (template) => `
            <div class="template-card" data-template="${template.name}">
                <h4>${template.name}</h4>
                <p>${template.description}</p>
                <button class="btn btn-primary load-template">Load Template</button>
            </div>
        `,
      )
      .join('');

    // Add event listeners
    gallery.querySelectorAll('.load-template').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const templateName = e.target.closest('.template-card').dataset.template;
        const template = templates.find((t) => t.name === templateName);
        if (template) {
          this.loadTemplate(template);
        }
      });
    });
  }

  loadTemplate(template) {
    this.clearCanvas();

    const nodeMap = new Map();

    // Create nodes
    template.nodes.forEach((nodeData, index) => {
      const node = this.createNode(nodeData.type, nodeData.x, nodeData.y);
      nodeMap.set(index, node);
    });

    // Create connections (if defined in template)
    if (template.connections) {
      template.connections.forEach((conn) => {
        const fromNode = nodeMap.get(conn.from);
        const toNode = nodeMap.get(conn.to);
        if (fromNode && toNode) {
          this.createConnection(
            { node: fromNode, type: 'output', index: conn.fromIndex || 0 },
            { node: toNode, type: 'input', index: conn.toIndex || 0 },
          );
        }
      });
    }

    this.draw();
  }

  filterPalette(e) {
    const filter = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.palette-item');

    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(filter) ? 'block' : 'none';
    });
  }

  switchTab(e) {
    const targetTab = e.target.dataset.tab;

    // Update button states
    document.querySelectorAll('.tab-button').forEach((btn) => {
      btn.classList.remove('active');
    });
    e.target.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach((content) => {
      content.classList.remove('active');
    });
    document.getElementById(targetTab + 'Tab').classList.add('active');
  }

  switchTabToValidation() {
    document.querySelectorAll('.tab-button').forEach((btn) => {
      btn.classList.remove('active');
    });
    document.querySelector('[data-tab="validation"]').classList.add('active');

    document.querySelectorAll('.tab-content').forEach((content) => {
      content.classList.remove('active');
    });
    document.getElementById('validationTab').classList.add('active');
  }

  setZoom(newZoom) {
    this.zoom = Math.max(0.1, Math.min(3, newZoom));
    this.draw();
  }

  clearCanvas() {
    if (confirm('Are you sure you want to clear the canvas?')) {
      this.nodes.clear();
      this.connections.clear();
      this.selectedNode = null;
      this.draw();
    }
  }

  showContextMenu(x, y, node) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
            <div class="context-menu-item" data-action="duplicate">
                <i class="fas fa-copy"></i> Duplicate
            </div>
            <div class="context-menu-item" data-action="delete">
                <i class="fas fa-trash"></i> Delete
            </div>
            <div class="context-menu-item" data-action="properties">
                <i class="fas fa-cog"></i> Properties
            </div>
        `;

    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      switch (action) {
        case 'duplicate':
          this.duplicateNode(node);
          break;
        case 'delete':
          this.deleteNode(node);
          break;
        case 'properties':
          this.showProperties(node);
          break;
      }
      document.body.removeChild(menu);
    });

    // Remove menu when clicking elsewhere
    setTimeout(() => {
      document.addEventListener('click', function removeMenu() {
        if (menu.parentNode) {
          document.body.removeChild(menu);
        }
        document.removeEventListener('click', removeMenu);
      });
    }, 100);
  }

  duplicateNode(node) {
    const newNode = this.createNode(node.type, node.x + 50, node.y + 50);
    newNode.properties = { ...node.properties };
    this.draw();
  }

  deleteNode(node) {
    // Remove connections
    const connectionsToRemove = [];
    for (let [id, connection] of this.connections) {
      if (connection.from === node.id || connection.to === node.id) {
        connectionsToRemove.push(id);
      }
    }
    connectionsToRemove.forEach((id) => this.connections.delete(id));

    // Remove node
    this.nodes.delete(node.id);

    if (this.selectedNode === node) {
      this.selectedNode = null;
      this.showProperties(null);
    }

    this.draw();
  }

  handleResize() {
    this.setupCanvas();
  }
}

// Initialize the workflow designer when the page loads
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('workflowDesigner')) {
    window.workflowDesigner = new WorkflowDesigner('workflowDesigner');
  }
});

// Export for external use
window.WorkflowDesigner = WorkflowDesigner;
