# 開発方針とルール

このドキュメントでは、Search MCP Serverプロジェクトの開発方針、コーディング規約、およびベストプラクティスを定義します。

## 開発方針

### 1. 軽量性の維持

**原則**: サーバーのフットプリントを可能な限り小さく保つ

- 依存関係は最小限に抑える
- 必要な場合のみ新しいパッケージを追加
- バンドルサイズを定期的に確認

### 2. 高い検索性能

**原則**: ツールを素早く発見できるようにする

- ツールメタデータは明確で詳細に記述
- 命名は一貫性を持たせる
- ツールのカテゴリ分けを検討（将来）

### 3. 型安全性

**原則**: TypeScriptの型システムを最大限活用

- `any` 型の使用は最小限に
- すべてのインターフェースとタイプを明示的に定義
- 型推論を活用しつつも、重要な箇所では型注釈を明示

### 4. プログレッシブな開示

**原則**: 必要な情報だけを段階的に提供

- メタデータと実装を分離
- ツール一覧は軽量に保つ
- 実行時のみ詳細な処理を行う

### 5. 拡張性

**原則**: 新しい機能やツールを簡単に追加できる設計

- プラグインアーキテクチャを維持
- ツールの追加は最小限のコード変更で可能に
- 既存機能への影響を最小化

## コーディング規約

### TypeScript / JavaScript

#### コードスタイル

- **インデント**: スペース2つ
- **セミコロン**: 使用する
- **引用符**: シングルクォート（`'`）を優先（ただし、JSONではダブルクォート）
- **末尾カンマ**: オブジェクトと配列の最後の要素に付ける

```typescript
// Good
const config = {
  name: 'search-mcp',
  version: '1.0.0',
};

// Bad
const config = {
  name: "search-mcp",
  version: "1.0.0"
}
```

#### 命名規則

| 種類 | 規則 | 例 |
|-----|------|-----|
| ファイル | ケバブケース | `tool-registry.ts` |
| クラス | パスカルケース | `ToolRegistry` |
| 関数 | キャメルケース | `executeTool()` |
| 変数 | キャメルケース | `toolName` |
| 定数 | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| インターフェース | パスカルケース | `ToolMetadata` |
| 型エイリアス | パスカルケース | `ToolImplementation` |

#### インポート順序

1. Node.js組み込みモジュール
2. 外部ライブラリ
3. 内部モジュール（絶対パス）
4. 相対パス

```typescript
// Good
import { readFile } from 'fs/promises';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ToolRegistry } from './tool-registry.js';
import type { ToolMetadata } from './types.js';

// Bad
import { ToolRegistry } from './tool-registry.js';
import Fastify from 'fastify';
import { readFile } from 'fs/promises';
```

#### 型定義

- 型のインポートには `import type` を使用
- パブリックAPIはすべて型を明示
- プライベートな実装は型推論を活用可能

```typescript
// Good
import type { ToolMetadata } from './types.js';

export function register(metadata: ToolMetadata): void {
  // ...
}

// Bad
import { ToolMetadata } from './types.js';

export function register(metadata) {
  // ...
}
```

#### エラーハンドリング

- 明示的なエラーメッセージを提供
- カスタムエラークラスの使用を検討
- エラーは適切にキャッチし、ユーザーに分かりやすく伝える

```typescript
// Good
if (!name) {
  throw new Error('Tool name is required');
}

// Bad
if (!name) {
  throw new Error('Error');
}
```

### コメント

#### JSDoc

すべてのパブリック関数とクラスにJSDocコメントを付ける

```typescript
/**
 * ツールを名前で検索します
 * @param name - 検索するツール名
 * @returns ツールのメタデータと実装、見つからない場合はundefined
 */
get(name: string): { metadata: ToolMetadata; implementation: ToolImplementation } | undefined {
  return this.tools.get(name);
}
```

#### インラインコメント

- 複雑なロジックには説明コメントを追加
- コメントは「何を」ではなく「なぜ」を説明
- 明白なコードにはコメント不要

```typescript
// Good
// 0除算を防ぐため、事前にチェック
if (b === 0) {
  throw new Error('Division by zero is not allowed');
}

// Bad
// bが0かチェック
if (b === 0) {
  throw new Error('Division by zero is not allowed');
}
```

## Git ワークフロー

### ブランチ戦略

- `main`: 本番環境に対応する安定版
- `develop`: 開発中の最新コード（今後導入予定）
- `feature/*`: 新機能開発
- `fix/*`: バグ修正
- `docs/*`: ドキュメント更新

### コミットメッセージ

Conventional Commitsスタイルを推奨：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type:**
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント
- `style`: コードスタイル（フォーマット、セミコロンなど）
- `refactor`: リファクタリング
- `test`: テスト追加・修正
- `chore`: ビルドプロセスや補助ツールの変更

**例:**

```
feat(tools): add calculate tool

Add a new calculate tool that supports basic arithmetic operations
(addition, subtraction, multiplication, division).

Closes #123
```

```
fix(registry): prevent duplicate tool registration

Previously, registering a tool with the same name would overwrite
the existing tool without warning. Now it throws an error.
```

```
docs: update tool development guide

Add examples for database query tools and external API integration.
```

## テスト方針

### テストレベル

1. **ユニットテスト**: 個別のツールや関数
2. **統合テスト**: APIエンドポイント
3. **E2Eテスト**: 実際のクライアントからの操作（将来）

### テストの配置

```
src/
├── tools/
│   ├── echo.ts
│   ├── search.ts
│   └── __tests__/
│       ├── echo.test.ts
│       └── search.test.ts
└── __tests__/
    ├── tool-registry.test.ts
    └── integration.test.ts
```

### テストの実行

```bash
npm test
```

## パフォーマンス

### ベンチマーク

- 新しいツールを追加する際は、パフォーマンスへの影響を確認
- 重い処理は非同期で実行
- 必要に応じてキャッシュを活用

### メモリ管理

- 大きなデータはストリーミング処理を検討
- 不要になったオブジェクトは適切に解放
- メモリリークに注意

## セキュリティ

### 入力バリデーション

- すべての外部入力をバリデート
- SQLインジェクション、XSSなどの脆弱性に注意
- パラメータのサニタイゼーション

### 依存関係

- 定期的に依存関係を更新
- 既知の脆弱性がないかチェック（`npm audit`）
- 最小権限の原則を適用

### 環境変数

- 機密情報は環境変数で管理
- `.env` ファイルは `.gitignore` に追加
- `.env.example` で必要な環境変数を文書化

## ドキュメント

### 更新タイミング

- 新機能追加時
- API変更時
- 重要なバグ修正時

### ドキュメントの種類

1. **README.md**: プロジェクト概要、クイックスタート
2. **docs/architecture.md**: アーキテクチャ設計
3. **docs/api.md**: API仕様
4. **docs/tool-development.md**: ツール開発ガイド
5. **docs/development.md**: 開発方針（このドキュメント）

### コード内ドキュメント

- JSDocで関数・クラスを文書化
- 複雑なロジックにはインラインコメント
- 型定義自体が自己文書化となるよう心がける

## レビュープロセス

### プルリクエスト

1. 機能ブランチから `main` へのPR作成
2. コードレビュー（1名以上）
3. CI/CDパス確認
4. マージ

### レビュー観点

- [ ] コーディング規約に従っているか
- [ ] テストが追加されているか
- [ ] ドキュメントが更新されているか
- [ ] パフォーマンスへの影響はないか
- [ ] セキュリティ上の懸念はないか

## CI/CD

### 継続的インテグレーション（将来実装予定）

- コミット時に自動テスト実行
- リントチェック
- 型チェック
- ビルド確認

### 継続的デリバリー（将来実装予定）

- `main` ブランチへのマージで自動デプロイ
- バージョンタグの自動作成
- リリースノートの生成

## ツール・エディタ設定

### 推奨エディタ

- Visual Studio Code
- WebStorm

### VSCode拡張機能

- ESLint
- Prettier
- TypeScript and JavaScript Language Features

### エディタ設定（`.vscode/settings.json`）

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## トラブルシューティング

### よくある問題

#### ビルドエラー

```bash
npm run build
```

型エラーを確認し、`tsconfig.json` の設定を見直す。

#### ポート競合

サーバー起動時に `EADDRINUSE` エラーが出る場合：

```bash
# 使用中のプロセスを確認
lsof -i :3000

# 環境変数でポートを変更
PORT=3001 npm start
```

#### 依存関係の問題

```bash
# node_modules を削除して再インストール
rm -rf node_modules package-lock.json
npm install
```

## 参考リソース

- [TypeScript公式ドキュメント](https://www.typescriptlang.org/docs/)
- [Fastify公式ドキュメント](https://www.fastify.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)

## 今後の改善項目

- [ ] ESLintの導入
- [ ] Prettierの導入
- [ ] CI/CDパイプラインの構築
- [ ] 本格的なテストフレームワーク（Jest、Vitest）の導入
- [ ] パフォーマンスモニタリングツールの統合
- [ ] ロギング戦略の改善
