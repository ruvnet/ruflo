# Claude Flow - Advanced Workflow Designer

## Overview

The Claude Flow Workflow Designer is a comprehensive visual workflow builder that enables users to create, execute, and manage complex data processing pipelines through an intuitive drag-and-drop interface. It features real-time execution, AI integration, and advanced validation capabilities.

## Features

### 🎨 Visual Interface

- **Drag-and-Drop Canvas**: Intuitive node-based workflow construction
- **Zoom & Pan**: Navigate large workflows with ease
- **Grid Snap**: Precision alignment for professional layouts
- **Context Menus**: Right-click for quick actions
- **Responsive Design**: Works on desktop and mobile devices

### 🧩 Component Library

- **Input Components**: File Input, Text Input, URL Input, API Input
- **Processing Components**: Transform, Filter, Aggregate, Sort
- **Output Components**: File Output, Display, API Output, Notification
- **Control Flow**: Condition, Loop, Delay, Parallel execution
- **AI Operations**: AI Analyze, AI Generate, AI Classify, AI Summarize

### 🔗 Connection System

- **Visual Connections**: Drag between input/output ports
- **Type Validation**: Ensures compatible connections
- **Connection Management**: Easy editing and removal
- **Flow Visualization**: Clear data flow representation

### 🚀 Execution Engine

- **Real-time Execution**: Watch workflows run in real-time
- **Status Tracking**: Visual indicators for node states
- **Progress Monitoring**: Detailed execution logs
- **Error Handling**: Comprehensive error reporting

### ✅ Validation System

- **Workflow Validation**: Checks for errors and warnings
- **Circular Dependency Detection**: Prevents infinite loops
- **Required Property Validation**: Ensures complete configuration
- **Connection Validation**: Verifies proper data flow

### 📚 Template Gallery

- **Pre-built Workflows**: Common patterns and examples
- **Template Categories**: Organized by use case
- **Quick Start**: Load templates to get started quickly
- **Custom Templates**: Save and share your own workflows

## File Structure

```
/workspaces/claude-code-flow/src/ui/console/
├── js/
│   └── workflow-designer.js          # Main workflow designer class
├── styles/
│   └── workflow-designer.css         # Complete styling system
├── workflow-designer-demo.html       # Demo page with examples
└── WORKFLOW_DESIGNER_README.md      # This documentation
```

## Getting Started

### Basic Usage

1. **Open the Designer**

   ```html
   <div id="workflowDesigner"></div>
   <script src="js/workflow-designer.js"></script>
   <script>
     const designer = new WorkflowDesigner('workflowDesigner');
   </script>
   ```

2. **Add Components**

   - Drag components from the left palette
   - Drop them onto the canvas
   - Components automatically snap to grid

3. **Create Connections**

   - Click and drag from output ports (blue circles)
   - Connect to input ports (green circles)
   - Connections validate automatically

4. **Configure Properties**

   - Select any node to see its properties
   - Edit values in the right panel
   - Changes apply immediately

5. **Validate & Execute**
   - Click "Validate" to check for errors
   - Click "Execute" to run the workflow
   - Monitor progress in the execution log

### Advanced Features

#### Custom Node Types

```javascript
// Add custom node type
designer.nodeTypes.custom = {
  inputs: [{ name: 'data', type: 'any' }],
  outputs: [{ name: 'result', type: 'any' }],
  properties: { customProp: 'defaultValue' },
};
```

#### Event Handling

```javascript
// Listen for workflow events
designer.addEventListener('nodeAdded', (node) => {
  console.log('Node added:', node);
});

designer.addEventListener('executionComplete', (results) => {
  console.log('Execution complete:', results);
});
```

#### Save/Load Workflows

```javascript
// Save workflow
const workflow = designer.exportWorkflow();
localStorage.setItem('myWorkflow', JSON.stringify(workflow));

// Load workflow
const saved = JSON.parse(localStorage.getItem('myWorkflow'));
designer.importWorkflow(saved);
```

## Component Types

### Input Components

#### File Input

- **Purpose**: Read data from files
- **Properties**:
  - `path`: File path
  - `format`: File format (auto, json, csv, txt)
- **Outputs**: File data

#### Text Input

- **Purpose**: Manual text input
- **Properties**:
  - `value`: Text content
  - `multiline`: Single or multi-line input
- **Outputs**: Text string

#### URL Input

- **Purpose**: Fetch data from URLs
- **Properties**:
  - `url`: Target URL
  - `method`: HTTP method (GET, POST, etc.)
  - `headers`: HTTP headers
- **Outputs**: Response data

#### API Input

- **Purpose**: Connect to APIs
- **Properties**:
  - `endpoint`: API endpoint
  - `method`: HTTP method
  - `headers`: Request headers
  - `body`: Request body
- **Outputs**: API response

### Processing Components

#### Transform

- **Purpose**: Transform data using custom expressions
- **Properties**:
  - `expression`: JavaScript expression
  - `language`: Expression language
- **Inputs**: Data to transform
- **Outputs**: Transformed data

#### Filter

- **Purpose**: Filter data based on conditions
- **Properties**:
  - `condition`: Filter condition
  - `language`: Condition language
- **Inputs**: Data to filter
- **Outputs**: Filtered data

#### Aggregate

- **Purpose**: Aggregate data collections
- **Properties**:
  - `operation`: Aggregation operation (sum, avg, count, etc.)
  - `field`: Field to aggregate
- **Inputs**: Data array
- **Outputs**: Aggregated result

#### Sort

- **Purpose**: Sort data collections
- **Properties**:
  - `field`: Sort field
  - `order`: Sort order (asc, desc)
- **Inputs**: Data array
- **Outputs**: Sorted array

### Output Components

#### File Output

- **Purpose**: Write data to files
- **Properties**:
  - `path`: Output file path
  - `format`: Output format
- **Inputs**: Data to write

#### Display

- **Purpose**: Display data in UI
- **Properties**:
  - `format`: Display format (table, json, text)
  - `title`: Display title
- **Inputs**: Data to display

#### API Output

- **Purpose**: Send data to APIs
- **Properties**:
  - `endpoint`: Target API endpoint
  - `method`: HTTP method
  - `headers`: Request headers
- **Inputs**: Data to send
- **Outputs**: API response

#### Notification

- **Purpose**: Show user notifications
- **Properties**:
  - `type`: Notification type (info, warning, error)
  - `title`: Notification title
- **Inputs**: Message content

### Control Flow Components

#### Condition

- **Purpose**: Conditional data routing
- **Properties**:
  - `expression`: Condition expression
  - `language`: Expression language
- **Inputs**: Condition value, data
- **Outputs**: True path, false path

#### Loop

- **Purpose**: Iterate over data
- **Properties**:
  - `type`: Loop type (forEach, while, for)
  - `condition`: Loop condition
- **Inputs**: Data to iterate
- **Outputs**: Iteration results

#### Delay

- **Purpose**: Add delays to workflow
- **Properties**:
  - `duration`: Delay duration
  - `unit`: Time unit (ms, s, m)
- **Inputs**: Data to delay
- **Outputs**: Delayed data

#### Parallel

- **Purpose**: Parallel execution
- **Properties**:
  - `maxConcurrency`: Maximum concurrent operations
- **Inputs**: Data array
- **Outputs**: Parallel results

### AI Components

#### AI Analyze

- **Purpose**: Analyze data using AI
- **Properties**:
  - `model`: AI model (gpt-4, claude, etc.)
  - `temperature`: Response creativity
- **Inputs**: Data to analyze
- **Outputs**: Analysis results

#### AI Generate

- **Purpose**: Generate content using AI
- **Properties**:
  - `model`: AI model
  - `temperature`: Response creativity
  - `maxTokens`: Maximum response length
- **Inputs**: Generation prompt
- **Outputs**: Generated content

#### AI Classify

- **Purpose**: Classify data using AI
- **Properties**:
  - `model`: AI model
  - `categories`: Classification categories
- **Inputs**: Data to classify
- **Outputs**: Classification results

#### AI Summarize

- **Purpose**: Summarize content using AI
- **Properties**:
  - `model`: AI model
  - `length`: Summary length (short, medium, long)
- **Inputs**: Content to summarize
- **Outputs**: Summary text

## API Reference

### WorkflowDesigner Class

#### Constructor

```javascript
new WorkflowDesigner(containerId, options);
```

#### Methods

##### Node Management

- `createNode(type, x, y)`: Create new node
- `deleteNode(node)`: Delete node
- `duplicateNode(node)`: Duplicate node
- `getNodeAt(x, y)`: Get node at coordinates

##### Connection Management

- `createConnection(start, end)`: Create connection
- `deleteConnection(connection)`: Delete connection
- `getConnectionPointAt(x, y)`: Get connection point

##### Workflow Operations

- `validateWorkflow()`: Validate workflow
- `executeWorkflow()`: Execute workflow
- `stopWorkflow()`: Stop execution
- `clearCanvas()`: Clear all nodes

##### Import/Export

- `exportWorkflow()`: Export workflow data
- `importWorkflow(data)`: Import workflow data
- `saveWorkflow()`: Save to localStorage
- `loadWorkflow()`: Load from localStorage

##### View Management

- `setZoom(zoom)`: Set zoom level
- `pan(x, y)`: Pan canvas
- `draw()`: Redraw canvas

### Events

#### Node Events

- `nodeAdded`: Node added to canvas
- `nodeDeleted`: Node deleted from canvas
- `nodeSelected`: Node selected
- `nodePropertyChanged`: Node property changed

#### Connection Events

- `connectionCreated`: Connection created
- `connectionDeleted`: Connection deleted

#### Workflow Events

- `workflowValidated`: Workflow validation complete
- `executionStarted`: Workflow execution started
- `executionComplete`: Workflow execution complete
- `executionError`: Workflow execution error

#### Canvas Events

- `canvasPan`: Canvas panned
- `canvasZoom`: Canvas zoomed
- `canvasClick`: Canvas clicked

## Styling

### CSS Classes

#### Layout

- `.workflow-designer`: Main container
- `.toolbar`: Top toolbar
- `.designer-body`: Main body area
- `.node-palette`: Left component palette
- `.canvas-container`: Canvas area
- `.properties-panel`: Right properties panel
- `.bottom-panel`: Bottom panel with tabs

#### Components

- `.palette-item`: Draggable palette items
- `.btn`: Button styling
- `.tab-button`: Tab navigation buttons
- `.context-menu`: Right-click context menu

#### States

- `.selected`: Selected node state
- `.executing`: Executing node state
- `.error`: Error state
- `.completed`: Completed state

### Customization

#### Custom Themes

```css
/* Dark theme example */
.workflow-designer.dark-theme {
  background: #1a1a1a;
  color: #ffffff;
}

.workflow-designer.dark-theme .node-palette {
  background: #2d2d2d;
  border-color: #444444;
}
```

#### Custom Node Styles

```css
/* Custom node type styling */
.palette-item[data-node-type='custom'] {
  border-color: #purple;
  background: #f3e5f5;
}

.palette-item[data-node-type='custom'] i {
  color: #purple;
}
```

## Examples

### Basic Data Processing

```javascript
// Create a simple data processing workflow
const fileInput = designer.createNode('file-input', 100, 150);
const transform = designer.createNode('transform', 300, 150);
const display = designer.createNode('display', 500, 150);

// Configure properties
fileInput.properties.path = 'data.json';
transform.properties.expression = 'data.map(item => item.value * 2)';
display.properties.format = 'table';

// Connect nodes
designer.createConnection(
  { node: fileInput, type: 'output', index: 0 },
  { node: transform, type: 'input', index: 0 },
);
designer.createConnection(
  { node: transform, type: 'output', index: 0 },
  { node: display, type: 'input', index: 0 },
);
```

### AI Content Pipeline

```javascript
// Create an AI content processing workflow
const textInput = designer.createNode('text-input', 100, 150);
const aiAnalyze = designer.createNode('ai-analyze', 300, 150);
const condition = designer.createNode('condition', 500, 150);
const aiGenerate = designer.createNode('ai-generate', 700, 100);
const aiSummarize = designer.createNode('ai-summarize', 700, 200);

// Configure AI properties
aiAnalyze.properties.model = 'gpt-4';
aiAnalyze.properties.temperature = 0.7;
condition.properties.expression = 'data.confidence > 0.8';
aiGenerate.properties.prompt = 'Expand on: {{data}}';
aiSummarize.properties.length = 'short';
```

### API Integration

```javascript
// Create an API integration workflow
const apiInput = designer.createNode('api-input', 100, 150);
const filter = designer.createNode('filter', 300, 150);
const aggregate = designer.createNode('aggregate', 500, 150);
const apiOutput = designer.createNode('api-output', 700, 150);

// Configure API properties
apiInput.properties.endpoint = 'https://api.example.com/data';
apiInput.properties.method = 'GET';
filter.properties.condition = 'item.status === "active"';
aggregate.properties.operation = 'sum';
aggregate.properties.field = 'value';
apiOutput.properties.endpoint = 'https://api.example.com/results';
```

## Best Practices

### Workflow Design

1. **Start Simple**: Begin with basic workflows and add complexity gradually
2. **Use Templates**: Leverage pre-built templates for common patterns
3. **Validate Early**: Validate workflows before execution
4. **Handle Errors**: Always include error handling in workflows
5. **Document**: Use descriptive names and comments

### Performance

1. **Minimize Connections**: Reduce unnecessary data passing
2. **Use Parallel**: Leverage parallel processing where possible
3. **Cache Results**: Cache expensive operations
4. **Optimize AI**: Use appropriate AI models for tasks
5. **Monitor Resources**: Watch memory and CPU usage

### Security

1. **Validate Inputs**: Always validate external data
2. **Sanitize**: Clean user inputs before processing
3. **Secure APIs**: Use proper authentication
4. **Limit Access**: Restrict file system access
5. **Audit Logs**: Keep execution logs for security

## Troubleshooting

### Common Issues

#### Nodes Not Connecting

- Check port compatibility
- Ensure proper drag direction
- Verify node positions

#### Execution Errors

- Validate workflow first
- Check node properties
- Review execution logs

#### Performance Issues

- Reduce workflow complexity
- Use parallel processing
- Optimize AI calls

#### UI Problems

- Clear browser cache
- Check browser compatibility
- Verify CSS/JS loading

### Debug Mode

```javascript
// Enable debug mode
designer.debug = true;

// View debug information
console.log(designer.getDebugInfo());
```

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## License

This component is part of the Claude Flow system and follows the project's licensing terms.

## Contributing

Contributions are welcome! Please follow the project's contribution guidelines and ensure all tests pass before submitting pull requests.

## Support

For support, please create an issue in the project repository or contact the development team.
