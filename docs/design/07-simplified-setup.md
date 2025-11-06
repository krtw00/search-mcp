# セットアップ・設定管理設計

## 概要

Search MCP Serverを**MCPアグリゲーター**として使用する際の、シンプルなセットアップと設定管理の設計を記述します。

## ユースケース

### 現状の課題

```
Claude Desktop (またはCursor、Windsurf等)
├── filesystem MCP (50 tools)
├── brave-search MCP (20 tools)
├── database MCP (30 tools)
└── slack MCP (15 tools)

→ 合計 115 tools のメタデータを毎回読み込み
→ コンテキスト消費: 約23,000 tokens
```

### Search MCP導入後

```
Claude Desktop
└── search-mcp (アグリゲーター)
    ├── filesystem MCP
    ├── brave-search MCP
    ├── database MCP
    └── slack MCP

→ 軽量なメタデータのみ初期読み込み
→ コンテキスト消費: 約5,750 tokens (75% 削減)
```

## 設定方法

### 1. Search MCPの設定ファイル

**場所**: `~/.search-mcp/servers.json` または `./config/mcp-servers.json`

**形式**: Claude Desktopの設定と**ほぼ同じ**（コピペ可能）

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

**ポイント**:
- ✅ Claude Desktopの `mcpServers` セクションをそのままコピペ
- ✅ 環境変数 `${VAR_NAME}` を使用可能
- ✅ 最小構成は `command` と `args` のみ

### 2. オプション設定

より細かい制御が必要な場合：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "enabled": true,              // オプション: 有効/無効
      "metadata": {                 // オプション: 追加のメタデータ
        "description": "Local file operations",
        "category": "filesystem",
        "tags": ["files", "local"]
      }
    }
  },
  "settings": {                     // オプション: グローバル設定
    "autoStart": true,              // 自動起動
    "reconnectOnFailure": true,     // 自動再接続
    "healthCheckInterval": 60000,   // ヘルスチェック間隔（ミリ秒）
    "timeout": 30000                // タイムアウト（ミリ秒）
  }
}
```

### 3. Claude Desktop側の設定

Search MCPを使用するように変更：

**変更前** (`~/.config/claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "filesystem": { ... },
    "brave-search": { ... },
    "database": { ... }
  }
}
```

**変更後**:
```json
{
  "mcpServers": {
    "search-mcp": {
      "command": "node",
      "args": ["/path/to/search-mcp/dist/index.js"]
    }
  }
}
```

たった1つのエントリだけ！

## セットアップ手順

### 方法A: 自動セットアップ（推奨）

```bash
# Step 1: インストール
npm install -g search-mcp

# Step 2: 既存設定を自動移行
search-mcp migrate --from claude-desktop

# 出力例:
# ✅ Found 4 MCP servers in Claude Desktop config
# ✅ Migration completed!
# 📝 Config saved to: ~/.search-mcp/servers.json

# Step 3: Claude Desktop設定を自動更新
search-mcp setup --replace-all

# 出力例:
# ✅ Updated Claude Desktop config
# ✅ Backed up original config to: claude_desktop_config.json.backup
# ⚠️  Please restart Claude Desktop

# Step 4: Search MCPを起動
search-mcp start

# Step 5: 検証
search-mcp verify

# 出力例:
# ✅ Search MCP is running
# ✅ 4 MCP servers connected
# ✅ 115 tools available
```

### 方法B: 手動セットアップ

```bash
# Step 1: Search MCPをインストール
npm install -g search-mcp

# Step 2: 設定ファイルを作成
mkdir -p ~/.search-mcp
vi ~/.search-mcp/servers.json
# ← Claude Desktopの mcpServers をコピペ

# Step 3: Claude Desktop設定を手動編集
vi ~/.config/claude/claude_desktop_config.json
# ← search-mcp のみに変更

# Step 4: 起動
search-mcp start
```

## CLIコマンド

### 基本コマンド

```bash
# サーバー管理
search-mcp start              # Search MCPを起動
search-mcp stop               # Search MCPを停止
search-mcp restart            # Search MCPを再起動
search-mcp status             # 状態確認

# 設定管理
search-mcp migrate --from claude-desktop   # 既存設定を移行
search-mcp setup --replace-all             # Claude設定を自動更新
search-mcp verify                          # 接続を検証

# MCP管理
search-mcp mcp list           # 登録済みMCPサーバー一覧
search-mcp mcp status         # 各MCPの状態確認
search-mcp mcp enable <name>  # MCPサーバーを有効化
search-mcp mcp disable <name> # MCPサーバーを無効化

# ツール管理
search-mcp tools list         # すべてのツール一覧
search-mcp tools search <query>  # ツール検索
search-mcp tools info <name>  # ツール詳細情報
```

### MCP追加

```bash
# 新しいMCPサーバーを追加
search-mcp mcp add github \
  --command npx \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=${GITHUB_TOKEN}"

# または手動で編集
vi ~/.search-mcp/servers.json
search-mcp restart
```

### ステータス確認

```bash
$ search-mcp status

Search MCP Server Status
━━━━━━━━━━━━━━━━━━━━━━
Status:     ● Running
Port:       3000
Uptime:     2h 34m

Connected MCP Servers:
├── filesystem     ✓ (50 tools)
├── brave-search   ✓ (20 tools)
├── database       ✓ (30 tools)
└── slack          ✗ (connection failed)

Total Tools: 100 / 115
```

## 設定ファイルの管理

### 設定ファイルの場所

優先順位（上から順に読み込み）:
1. `./config/mcp-servers.json` （プロジェクトローカル）
2. `~/.search-mcp/servers.json` （ユーザーグローバル）
3. `/etc/search-mcp/servers.json` （システムグローバル）

### 設定の検証

```bash
# 設定ファイルの妥当性をチェック
search-mcp config validate

# 出力例:
✅ Configuration is valid
✅ All environment variables are set
⚠️  Warning: SLACK_TOKEN is not set

# 設定を表示（環境変数展開済み）
search-mcp config show

# 出力例:
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"]
    },
    ...
  }
}
```

### バックアップ

```bash
# 現在の設定をバックアップ
search-mcp config backup

# 出力例:
✅ Config backed up to: ~/.search-mcp/servers.json.backup-20250106

# バックアップから復元
search-mcp config restore ~/.search-mcp/servers.json.backup-20250106
```

## トラブルシューティング

### 問題1: MCPサーバーに接続できない

```bash
# 詳細ログを有効化して診断
search-mcp start --log-level debug

# 特定のMCPサーバーをテスト
search-mcp mcp test filesystem

# 出力例:
Testing MCP server: filesystem
✓ Process started
✓ Initialize message sent
✓ Tools list received (50 tools)
✗ Tool execution failed: read_file
  Error: Permission denied
```

### 問題2: 環境変数が読み込まれない

```bash
# 環境変数を確認
search-mcp config show --raw  # 展開前
search-mcp config show        # 展開後

# 環境変数を設定
export BRAVE_API_KEY="your-key"
search-mcp restart
```

### 問題3: ツールが見つからない

```bash
# キャッシュをクリア
search-mcp cache clear

# 全MCPサーバーを再起動
search-mcp restart --force

# ツールリストを更新
search-mcp tools refresh
```

## 実装優先順位

### Phase 1: 基本機能
- [ ] 設定ファイルの読み込み
- [ ] 環境変数の展開
- [ ] 基本CLIコマンド（start, stop, status）
- [ ] MCPClientManagerの実装

### Phase 2: 移行ツール
- [ ] migrate コマンド
- [ ] setup コマンド（Claude Desktop設定更新）
- [ ] verify コマンド

### Phase 3: 管理機能
- [ ] mcp list/status/enable/disable
- [ ] config validate/show/backup/restore
- [ ] tools list/search/info

### Phase 4: 高度な機能
- [ ] ホットリロード
- [ ] 自動再接続
- [ ] ヘルスチェック

## 次のステップ

1. [MCPアグリゲーター設計](./08-mcp-aggregator.md)を確認
2. 設定ファイルフォーマットの実装
3. migrate コマンドの実装
4. MCPClientManagerの実装

[戻る: 設計概要](./00-overview.md) | [次へ: MCPアグリゲーター設計](./08-mcp-aggregator.md)
