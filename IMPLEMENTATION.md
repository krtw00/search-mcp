# Search MCP Implementation Guide

## 🚀 New Implementation (Bun-based MCP Aggregator)

This implementation uses **Bun** as the primary runtime for optimal performance and developer experience.

### Architecture

```
┌─────────────────────────────────────────────┐
│   AIクライアント (Claude/Cursor/Windsurf)   │
└──────────────────┬──────────────────────────┘
                   │ stdio (JSON-RPC 2.0)
                   ↓
┌─────────────────────────────────────────────┐
│       Search MCP Server (アグリゲーター)    │
│  ┌──────────────────────────────────────┐  │
│  │  MCP Client Manager                  │  │
│  │  - Aggregates multiple MCP servers   │  │
│  │  - Reduces context by 75%            │  │
│  └──────────────────────────────────────┘  │
└──────┬────────┬────────┬────────┬──────────┘
       │ stdio  │ stdio  │ stdio  │ stdio
       ↓        ↓        ↓        ↓
┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│filesystem│ │ brave  │ │database│ │ slack  │
│   MCP    │ │  MCP   │ │  MCP   │ │  MCP   │
└──────────┘ └────────┘ └────────┘ └────────┘
```

### Key Components

1. **MCP Client** (`src/mcp/mcp-client.ts`)
   - Manages communication with a single backend MCP server
   - Handles stdio communication and JSON-RPC 2.0 protocol
   - Spawns and manages child processes

2. **MCP Client Manager** (`src/mcp/mcp-client-manager.ts`)
   - Manages multiple MCP clients
   - Aggregates tools from all backend servers
   - Provides lightweight tool metadata (context reduction)

3. **Search MCP Server** (`src/index.ts`)
   - Main entry point
   - Communicates with AI clients via stdio
   - Proxies tool calls to appropriate backend servers

## 📋 Prerequisites

### Option 1: Bun (Recommended)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version
```

### Option 2: Node.js (Fallback)

```bash
# Node.js 18+ required
node --version
```

## 🔧 Setup

### 1. Install Dependencies

```bash
# With Bun (recommended)
bun install

# With Node.js
npm install
```

### 2. Configure MCP Servers

Copy the example configuration:

```bash
cp config/mcp-servers.example.json config/mcp-servers.json
```

Edit `config/mcp-servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"],
      "env": {},
      "enabled": true
    },
    "brave": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key-here"
      },
      "enabled": false
    }
  }
}
```

## 🏃 Running

### Development Mode

```bash
# With Bun (recommended)
bun run dev

# With Node.js
npm run dev:node
```

### Production Build

```bash
# Build with Bun
bun run build

# Build single binary
bun run build:binary

# Build with Node.js
npm run build:node
```

### Running the Binary

```bash
# After building binary
./search-mcp
```

## 🧪 Testing

### Manual Testing with stdio

Create a test script `test-stdin.js`:

```javascript
import { spawn } from 'child_process';

const server = spawn('bun', ['run', 'src/index.ts']);

// Send initialize request
server.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '1.0.0',
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }
}) + '\n');

// Listen for responses
server.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});

// List tools after 2 seconds
setTimeout(() => {
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  }) + '\n');
}, 2000);
```

Run:

```bash
node test-stdin.js
```

## 🔌 Integration with AI Clients

### Claude Desktop

Edit `~/.config/claude/config.json`:

```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/search-mcp/src/index.ts"],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/search-mcp/config/mcp-servers.json"
      }
    }
  }
}
```

Or use the binary:

```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "/path/to/search-mcp/search-mcp",
      "args": [],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/search-mcp/config/mcp-servers.json"
      }
    }
  }
}
```

### Cursor / Windsurf

Similar configuration in their respective config files.

## 📊 Context Reduction

### Before (Direct MCP connections)

```
filesystem MCP: 50 tools × 200 tokens = 10,000 tokens
brave MCP:      20 tools × 200 tokens = 4,000 tokens
database MCP:   30 tools × 200 tokens = 6,000 tokens
slack MCP:      15 tools × 200 tokens = 3,000 tokens
─────────────────────────────────────────────
Total: 23,000 tokens
```

### After (Search MCP aggregator)

```
Lightweight metadata: 115 tools × 50 tokens = 5,750 tokens
Tool execution (3 tools): 3 × 200 tokens = 600 tokens
─────────────────────────────────────────────
Total: 6,350 tokens (72% reduction)
```

## 🐛 Troubleshooting

### MCP Server Fails to Start

```bash
# Check if the command is available
npx -y @modelcontextprotocol/server-filesystem --version

# Check logs
# stderr will show in console.error
```

### Bun Not Found

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Or use Node.js fallback
npm run dev:node
```

### Config File Not Found

```bash
# Set custom config path
export MCP_CONFIG_PATH=/path/to/config/mcp-servers.json
bun run dev
```

## 📚 Additional Resources

- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [Bun Documentation](https://bun.sh/docs)
- [Design Documents](./docs/design/)

## 🎯 Next Steps

1. ✅ Basic MCP aggregator implementation
2. 🚧 Add tool search functionality
3. 🚧 Implement hot reload for config changes
4. 🚧 Add monitoring and statistics
5. 🚧 Build management UI (optional)

## 🤝 Contributing

Please see design documents in `docs/design/` for architecture details.
