# ツール開発ガイド

このガイドでは、Search MCP Serverに新しいツールを追加する方法を説明します。

## ツールの構造

各ツールは2つの主要な要素で構成されます：

1. **メタデータ (Metadata)**: ツールの名前、説明、パラメータ定義
2. **実装 (Implementation)**: 実際の処理ロジック

## ツール作成の手順

### 1. 新しいツールファイルを作成

`src/tools/` ディレクトリに新しいファイルを作成します。

```bash
touch src/tools/your-tool.ts
```

### 2. メタデータを定義

ツールのメタデータを定義します。これにより、AIエージェントがツールを発見し、どのように使用するかを理解できます。

```typescript
import type { ToolMetadata, ToolImplementation } from '../types.js';

export const yourToolMetadata: ToolMetadata = {
  name: 'your-tool',
  description: 'ツールの簡潔な説明',
  parameters: [
    {
      name: 'param1',
      type: 'string',
      description: 'パラメータの説明',
      required: true
    },
    {
      name: 'param2',
      type: 'number',
      description: 'オプションパラメータの説明',
      required: false
    }
  ]
};
```

**メタデータのベストプラクティス:**

- **name**: 小文字とハイフンを使用（例: `calculate-sum`, `fetch-data`）
- **description**: 1-2文で簡潔に。AIが理解しやすいように
- **parameters**: すべての必須パラメータを明確に定義

### 3. 実装を定義

ツールの実際の処理ロジックを実装します。

```typescript
export const yourToolImplementation: ToolImplementation = async (parameters) => {
  // パラメータの取得とデフォルト値の設定
  const { param1, param2 = 10 } = parameters;

  // 必須パラメータのバリデーション
  if (!param1) {
    throw new Error('param1 parameter is required');
  }

  // ビジネスロジック
  const result = performSomeOperation(param1, param2);

  // 結果を返す
  return {
    success: true,
    data: result,
    timestamp: new Date().toISOString()
  };
};
```

**実装のベストプラクティス:**

- **非同期関数**: すべてのツールは `async` 関数として実装
- **エラーハンドリング**: 適切なエラーメッセージを投げる
- **型安全**: TypeScriptの型を活用
- **レスポンス形式**: 一貫したレスポンス構造を返す

### 4. サーバーに登録

`src/index.ts` でツールをインポートし、レジストリに登録します。

```typescript
import { yourToolMetadata, yourToolImplementation } from './tools/your-tool.js';

// ツールレジストリに登録
toolRegistry.register(yourToolMetadata, yourToolImplementation);
```

### 5. ビルドとテスト

```bash
# ビルド
npm run build

# 開発モードで起動
npm run dev
```

ツールが正しく登録されているか確認：

```bash
curl http://localhost:3000/tools
```

ツールを実行：

```bash
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "your-tool",
    "parameters": {
      "param1": "test value"
    }
  }'
```

## 実装例

### 例1: 簡単な計算ツール

```typescript
// src/tools/calculate.ts
import type { ToolMetadata, ToolImplementation } from '../types.js';

export const calculateMetadata: ToolMetadata = {
  name: 'calculate',
  description: '2つの数値の加算、減算、乗算、除算を実行します',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: '実行する演算（add, subtract, multiply, divide）',
      required: true
    },
    {
      name: 'a',
      type: 'number',
      description: '最初の数値',
      required: true
    },
    {
      name: 'b',
      type: 'number',
      description: '2番目の数値',
      required: true
    }
  ]
};

export const calculateImplementation: ToolImplementation = async (parameters) => {
  const { operation, a, b } = parameters;

  // バリデーション
  if (!operation || a === undefined || b === undefined) {
    throw new Error('operation, a, and b parameters are required');
  }

  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('a and b must be numbers');
  }

  // 演算実行
  let result: number;
  switch (operation) {
    case 'add':
      result = a + b;
      break;
    case 'subtract':
      result = a - b;
      break;
    case 'multiply':
      result = a * b;
      break;
    case 'divide':
      if (b === 0) {
        throw new Error('Division by zero is not allowed');
      }
      result = a / b;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  return {
    operation,
    a,
    b,
    result,
    timestamp: new Date().toISOString()
  };
};
```

### 例2: 外部APIを呼び出すツール

```typescript
// src/tools/fetch-weather.ts
import type { ToolMetadata, ToolImplementation } from '../types.js';

export const fetchWeatherMetadata: ToolMetadata = {
  name: 'fetch-weather',
  description: '指定した都市の天気情報を取得します',
  parameters: [
    {
      name: 'city',
      type: 'string',
      description: '都市名',
      required: true
    },
    {
      name: 'units',
      type: 'string',
      description: '温度の単位（metric または imperial）',
      required: false
    }
  ]
};

export const fetchWeatherImplementation: ToolImplementation = async (parameters) => {
  const { city, units = 'metric' } = parameters;

  if (!city) {
    throw new Error('city parameter is required');
  }

  try {
    // 外部APIを呼び出し（例）
    const apiKey = process.env.WEATHER_API_KEY;
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=${units}&appid=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      city: data.name,
      temperature: data.main.temp,
      description: data.weather[0].description,
      units,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch weather: ${error.message}`);
    }
    throw error;
  }
};
```

### 例3: データベース操作ツール

```typescript
// src/tools/db-query.ts
import type { ToolMetadata, ToolImplementation } from '../types.js';
// import { db } from '../database.js'; // 仮想のDB接続

export const dbQueryMetadata: ToolMetadata = {
  name: 'db-query',
  description: 'データベースにクエリを実行します',
  parameters: [
    {
      name: 'table',
      type: 'string',
      description: 'クエリ対象のテーブル名',
      required: true
    },
    {
      name: 'filter',
      type: 'object',
      description: 'フィルタ条件',
      required: false
    },
    {
      name: 'limit',
      type: 'number',
      description: '取得する最大件数',
      required: false
    }
  ]
};

export const dbQueryImplementation: ToolImplementation = async (parameters) => {
  const { table, filter = {}, limit = 100 } = parameters;

  if (!table) {
    throw new Error('table parameter is required');
  }

  try {
    // データベースクエリの実行（疑似コード）
    // const results = await db.select(table).where(filter).limit(limit);

    // プロトタイプとしてダミーデータを返す
    const results = [
      { id: 1, data: 'sample data 1' },
      { id: 2, data: 'sample data 2' }
    ];

    return {
      table,
      count: results.length,
      results,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Database query failed: ${error.message}`);
    }
    throw error;
  }
};
```

## テスト

### ユニットテストの作成

ツールのテストは `src/test.ts` または専用のテストファイルで行います。

```typescript
// src/tools/__tests__/calculate.test.ts
import { calculateImplementation } from '../calculate.js';

async function testCalculate() {
  // 加算のテスト
  const addResult = await calculateImplementation({
    operation: 'add',
    a: 5,
    b: 3
  });
  console.assert(addResult.result === 8, 'Addition test failed');

  // 除算のテスト
  const divideResult = await calculateImplementation({
    operation: 'divide',
    a: 10,
    b: 2
  });
  console.assert(divideResult.result === 5, 'Division test failed');

  // エラーケースのテスト
  try {
    await calculateImplementation({
      operation: 'divide',
      a: 10,
      b: 0
    });
    console.assert(false, 'Should have thrown error for division by zero');
  } catch (error) {
    console.assert(error instanceof Error, 'Error handling test failed');
  }

  console.log('All calculate tests passed!');
}

testCalculate();
```

## ツール開発のチェックリスト

- [ ] メタデータが明確で分かりやすい
- [ ] すべての必須パラメータが定義されている
- [ ] パラメータのバリデーションが実装されている
- [ ] エラーハンドリングが適切に行われている
- [ ] 非同期処理が正しく実装されている
- [ ] レスポンス形式が一貫している
- [ ] テストが作成されている
- [ ] `src/index.ts` に登録されている
- [ ] ドキュメントが更新されている（必要に応じて）

## よくある質問

### Q: ツール名の命名規則は？

A: ケバブケース（小文字とハイフン）を使用してください。例: `fetch-data`, `calculate-sum`

### Q: パラメータの型には何が使える？

A: TypeScriptの基本型（`string`, `number`, `boolean`, `object`, `array`）が使用できます。

### Q: 複雑なバリデーションはどうすればいい？

A: 実装関数内でカスタムバリデーションロジックを追加してください。必要に応じて、外部のバリデーションライブラリ（Zod, Yupなど）も使用できます。

### Q: 非同期処理が必要ない場合も `async` は必須？

A: はい。すべてのツールは `async` 関数として実装してください。これにより、APIの一貫性が保たれます。

### Q: ツールの削除方法は？

A: ツールファイルを削除し、`src/index.ts` から登録を削除してください。

## 参考リソース

- [TypeScript公式ドキュメント](https://www.typescriptlang.org/docs/)
- [Fastify公式ドキュメント](https://www.fastify.io/)
- [Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)
