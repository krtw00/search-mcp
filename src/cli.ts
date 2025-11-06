#!/usr/bin/env node

/**
 * Search MCP CLI - Command-line interface for managing the Search MCP Server
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { resolve } from 'path';

const COMMANDS = {
  start: 'Start the Search MCP Server',
  stop: 'Stop the Search MCP Server',
  status: 'Check server status',
  migrate: 'Migrate existing MCP configuration',
  help: 'Show help information',
};

const PID_FILE = resolve(process.cwd(), '.search-mcp.pid');
const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'config/mcp-servers.json');

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
Search MCP Server - CLI Tool

Usage:
  search-mcp <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([cmd, desc]) => `  ${cmd.padEnd(12)} ${desc}`)
  .join('\n')}

Options:
  --config <path>    Path to configuration file (default: ./config/mcp-servers.json)
  --daemon           Run in daemon mode (start command only)
  --help             Show this help message

Examples:
  search-mcp start --config ./my-config.json
  search-mcp stop
  search-mcp status
  search-mcp migrate --from ~/.config/claude/config.json
`);
}

/**
 * Start the Search MCP Server
 */
async function startServer(options: { config?: string; daemon?: boolean }): Promise<void> {
  // Check if already running
  if (isServerRunning()) {
    console.error('Error: Server is already running');
    console.error(`PID file exists at: ${PID_FILE}`);
    process.exit(1);
  }

  const configPath = options.config || DEFAULT_CONFIG_PATH;

  if (!existsSync(configPath)) {
    console.error(`Error: Configuration file not found: ${configPath}`);
    console.error('Run "search-mcp migrate" to create a configuration file');
    process.exit(1);
  }

  console.log(`Starting Search MCP Server...`);
  console.log(`Configuration: ${configPath}`);

  if (options.daemon) {
    // Start in daemon mode
    const child = spawn(
      process.execPath,
      [resolve(__dirname, 'index.js')],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          MCP_CONFIG_PATH: configPath,
        },
      }
    );

    child.unref();

    // Save PID
    writeFileSync(PID_FILE, child.pid?.toString() || '');

    console.log(`Server started in daemon mode (PID: ${child.pid})`);
    console.log(`Use "search-mcp stop" to stop the server`);
  } else {
    // Start in foreground
    const child = spawn(
      process.execPath,
      [resolve(__dirname, 'index.js')],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          MCP_CONFIG_PATH: configPath,
        },
      }
    );

    // Save PID
    writeFileSync(PID_FILE, child.pid?.toString() || '');

    console.log(`Server started (PID: ${child.pid})`);

    // Clean up PID file on exit
    child.on('exit', () => {
      if (existsSync(PID_FILE)) {
        try {
          const pidInFile = readFileSync(PID_FILE, 'utf-8').trim();
          if (pidInFile === child.pid?.toString()) {
            require('fs').unlinkSync(PID_FILE);
          }
        } catch (error) {
          // Ignore errors
        }
      }
    });

    process.on('SIGINT', () => {
      child.kill();
      process.exit(0);
    });
  }
}

/**
 * Stop the Search MCP Server
 */
async function stopServer(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.error('Error: Server is not running (PID file not found)');
    process.exit(1);
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);

  if (isNaN(pid)) {
    console.error('Error: Invalid PID in PID file');
    process.exit(1);
  }

  console.log(`Stopping server (PID: ${pid})...`);

  try {
    // Try to kill the process
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds

    const checkInterval = setInterval(() => {
      attempts++;

      try {
        // Check if process is still running
        process.kill(pid, 0);

        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          console.error('Error: Server did not stop gracefully, forcing...');
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            // Process already dead
          }
          cleanup();
        }
      } catch (error) {
        // Process is dead
        clearInterval(checkInterval);
        cleanup();
        console.log('Server stopped successfully');
      }
    }, 1000);
  } catch (error) {
    if ((error as any).code === 'ESRCH') {
      console.log('Server was not running');
      cleanup();
    } else {
      console.error('Error stopping server:', error);
      process.exit(1);
    }
  }
}

/**
 * Check server status
 */
async function checkStatus(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('Status: Not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);

  if (isNaN(pid)) {
    console.log('Status: Not running (invalid PID file)');
    return;
  }

  try {
    // Check if process is running
    process.kill(pid, 0);
    console.log(`Status: Running (PID: ${pid})`);

    // Try to get additional info if possible
    // This is platform-specific and may not work everywhere
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'linux' || process.platform === 'darwin') {
        const info = execSync(`ps -p ${pid} -o etime,rss`).toString().split('\n')[1];
        if (info) {
          const [uptime, memory] = info.trim().split(/\s+/);
          console.log(`Uptime: ${uptime}`);
          console.log(`Memory: ${Math.round(parseInt(memory) / 1024)}MB`);
        }
      }
    } catch (error) {
      // Ignore if we can't get additional info
    }
  } catch (error) {
    if ((error as any).code === 'ESRCH') {
      console.log('Status: Not running (stale PID file)');
      cleanup();
    } else {
      console.log('Status: Unknown');
    }
  }
}

/**
 * Migrate existing MCP configuration
 */
async function migrateConfig(options: { from?: string }): Promise<void> {
  console.log('Configuration Migration Tool');
  console.log('============================\n');

  if (!options.from) {
    console.error('Error: --from option is required');
    console.error('Example: search-mcp migrate --from ~/.config/claude/config.json');
    process.exit(1);
  }

  const sourcePath = resolve(options.from);

  if (!existsSync(sourcePath)) {
    console.error(`Error: Source configuration file not found: ${sourcePath}`);
    process.exit(1);
  }

  console.log(`Reading configuration from: ${sourcePath}`);

  try {
    const sourceConfig = JSON.parse(readFileSync(sourcePath, 'utf-8'));

    // Extract MCP servers configuration
    let mcpServers = sourceConfig.mcpServers || {};

    // If the config is in Claude's format, extract it
    if (sourceConfig.globalShortcut || sourceConfig.appearance) {
      // This is Claude's config format
      mcpServers = sourceConfig.mcpServers || {};
    }

    if (Object.keys(mcpServers).length === 0) {
      console.error('Error: No MCP servers found in the configuration file');
      process.exit(1);
    }

    console.log(`Found ${Object.keys(mcpServers).length} MCP server(s)`);

    // Create new configuration
    const newConfig = {
      mcpServers,
    };

    // Ensure config directory exists
    const { mkdirSync } = require('fs');
    const configDir = resolve(process.cwd(), 'config');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Write configuration
    const targetPath = DEFAULT_CONFIG_PATH;
    writeFileSync(targetPath, JSON.stringify(newConfig, null, 2));

    console.log(`\nConfiguration migrated successfully!`);
    console.log(`Output: ${targetPath}`);
    console.log(`\nYou can now start the server with:`);
    console.log(`  search-mcp start`);
  } catch (error) {
    console.error('Error migrating configuration:', error);
    process.exit(1);
  }
}

/**
 * Check if server is running
 */
function isServerRunning(): boolean {
  if (!existsSync(PID_FILE)) {
    return false;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);

  if (isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Clean up PID file
 */
function cleanup(): void {
  if (existsSync(PID_FILE)) {
    try {
      require('fs').unlinkSync(PID_FILE);
    } catch (error) {
      // Ignore errors
    }
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs(args: string[]): { command: string; options: Record<string, any> } {
  const command = args[0] || 'help';
  const options: Record<string, any> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);

      if (key === 'help') {
        options.help = true;
      } else if (key === 'daemon') {
        options.daemon = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  if (options.help || command === 'help') {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case 'start':
        await startServer(options);
        break;

      case 'stop':
        await stopServer();
        break;

      case 'status':
        await checkStatus();
        break;

      case 'migrate':
        await migrateConfig(options);
        break;

      default:
        console.error(`Error: Unknown command: ${command}`);
        console.error('Run "search-mcp help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main();
}
