# 検索機能設計

## 概要

Search MCP Serverの最も重要な機能の一つが、ツールの効率的な検索です。このドキュメントでは、以下の検索機能の詳細設計を記述します：

1. テキスト検索（ツール名・説明）
2. タグベースの検索
3. カテゴリフィルタリング
4. 検索結果のランキング
5. セマンティック検索（Phase 5）

## 1. テキスト検索

### 1.1 概要

ツール名と説明文に対するテキスト検索機能を提供します。部分一致、前方一致、完全一致をサポートします。

### 1.2 実装設計

#### 1.2.1 検索インターフェース

```typescript
// src/search/text-search.ts

export interface SearchOptions {
  query: string;
  matchType?: 'partial' | 'prefix' | 'exact';
  fields?: ('name' | 'description')[];
  caseSensitive?: boolean;
  limit?: number;
}

export interface SearchResult {
  tool: ToolMetadata;
  score: number;        // 関連度スコア (0-1)
  matches: {
    field: string;
    positions: number[]; // マッチした位置
  }[];
}

export class TextSearch {
  search(tools: ToolMetadata[], options: SearchOptions): SearchResult[] {
    const {
      query,
      matchType = 'partial',
      fields = ['name', 'description'],
      caseSensitive = false,
      limit = 20
    } = options;

    if (!query || query.trim() === '') {
      return [];
    }

    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    const results: SearchResult[] = [];

    for (const tool of tools) {
      const result = this.matchTool(tool, normalizedQuery, matchType, fields, caseSensitive);
      if (result) {
        results.push(result);
      }
    }

    // スコアでソート
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  private matchTool(
    tool: ToolMetadata,
    query: string,
    matchType: string,
    fields: string[],
    caseSensitive: boolean
  ): SearchResult | null {
    const matches: SearchResult['matches'] = [];
    let totalScore = 0;

    for (const field of fields) {
      const fieldValue = tool[field as keyof ToolMetadata] as string;
      if (!fieldValue) continue;

      const normalizedValue = caseSensitive ? fieldValue : fieldValue.toLowerCase();
      const match = this.matchField(normalizedValue, query, matchType);

      if (match) {
        matches.push({
          field,
          positions: match.positions
        });
        totalScore += match.score * this.getFieldWeight(field);
      }
    }

    if (matches.length === 0) {
      return null;
    }

    return {
      tool,
      score: Math.min(totalScore, 1.0),
      matches
    };
  }

  private matchField(
    value: string,
    query: string,
    matchType: string
  ): { positions: number[]; score: number } | null {
    let positions: number[] = [];
    let score = 0;

    switch (matchType) {
      case 'exact':
        if (value === query) {
          positions = [0];
          score = 1.0;
        }
        break;

      case 'prefix':
        if (value.startsWith(query)) {
          positions = [0];
          score = 0.9;
        }
        break;

      case 'partial':
      default:
        const index = value.indexOf(query);
        if (index !== -1) {
          positions = [index];
          // スコアは位置とマッチ長に基づく
          score = this.calculatePartialScore(value, query, index);
        }
        break;
    }

    return positions.length > 0 ? { positions, score } : null;
  }

  private calculatePartialScore(value: string, query: string, position: number): number {
    // 前方一致ほど高スコア
    const positionScore = 1 - (position / value.length);
    // マッチ長が長いほど高スコア
    const lengthScore = query.length / value.length;
    // 重み付き平均
    return positionScore * 0.7 + lengthScore * 0.3;
  }

  private getFieldWeight(field: string): number {
    const weights: Record<string, number> = {
      name: 1.0,        // ツール名が最も重要
      description: 0.7,
      category: 0.5,
      tags: 0.6
    };
    return weights[field] || 0.5;
  }
}
```

#### 1.2.2 APIエンドポイント

```typescript
// src/index.ts

import { TextSearch } from './search/text-search.js';

const textSearch = new TextSearch();

server.post<{ Body: SearchToolsRequest }>('/v1/tools/search', {
  schema: {
    body: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        matchType: { type: 'string', enum: ['partial', 'prefix', 'exact'] },
        fields: {
          type: 'array',
          items: { type: 'string', enum: ['name', 'description', 'category'] }
        },
        caseSensitive: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    }
  }
}, async (request, reply) => {
  const { query, matchType, fields, caseSensitive, limit } = request.body;

  const allTools = toolRegistry.list();
  const results = textSearch.search(allTools, {
    query,
    matchType,
    fields,
    caseSensitive,
    limit
  });

  return {
    query,
    matchType: matchType || 'partial',
    results: results.map(r => ({
      tool: r.tool,
      score: r.score,
      matches: r.matches
    })),
    total: results.length
  };
});
```

## 2. タグベースの検索

### 2.1 概要

ツールにタグを付与し、タグで検索・フィルタリングできる機能を提供します。

### 2.2 実装設計

#### 2.2.1 タグ管理

```typescript
// src/search/tag-search.ts

export class TagSearch {
  /**
   * タグで完全一致検索
   */
  searchByTag(tools: ToolMetadata[], tag: string): ToolMetadata[] {
    return tools.filter(tool =>
      tool.tags && tool.tags.includes(tag)
    );
  }

  /**
   * 複数タグでAND検索
   */
  searchByTagsAnd(tools: ToolMetadata[], tags: string[]): ToolMetadata[] {
    return tools.filter(tool =>
      tool.tags && tags.every(tag => tool.tags!.includes(tag))
    );
  }

  /**
   * 複数タグでOR検索
   */
  searchByTagsOr(tools: ToolMetadata[], tags: string[]): ToolMetadata[] {
    return tools.filter(tool =>
      tool.tags && tags.some(tag => tool.tags!.includes(tag))
    );
  }

  /**
   * すべてのタグを取得（統計情報付き）
   */
  getAllTags(tools: ToolMetadata[]): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const tool of tools) {
      if (!tool.tags) continue;
      for (const tag of tool.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 関連タグの提案
   */
  suggestRelatedTags(tools: ToolMetadata[], selectedTags: string[]): string[] {
    // 選択されたタグを持つツールを取得
    const relevantTools = this.searchByTagsOr(tools, selectedTags);

    // それらのツールが持つ他のタグを集計
    const tagCounts = new Map<string, number>();
    for (const tool of relevantTools) {
      if (!tool.tags) continue;
      for (const tag of tool.tags) {
        if (!selectedTags.includes(tag)) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }

    // 出現頻度でソートして返す
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .slice(0, 10);
  }
}
```

#### 2.2.2 APIエンドポイント

```typescript
// タグ一覧取得
server.get('/v1/tags', async (request, reply) => {
  const tagSearch = new TagSearch();
  const allTools = toolRegistry.list();
  const tags = tagSearch.getAllTags(allTools);

  return {
    tags,
    total: tags.length
  };
});

// タグで検索
server.post<{ Body: { tags: string[]; operator?: 'and' | 'or' } }>(
  '/v1/tools/search/by-tags',
  {
    schema: {
      body: {
        type: 'object',
        required: ['tags'],
        properties: {
          tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
          operator: { type: 'string', enum: ['and', 'or'] }
        }
      }
    }
  },
  async (request, reply) => {
    const { tags, operator = 'or' } = request.body;
    const tagSearch = new TagSearch();
    const allTools = toolRegistry.list();

    const results = operator === 'and'
      ? tagSearch.searchByTagsAnd(allTools, tags)
      : tagSearch.searchByTagsOr(allTools, tags);

    return {
      tags,
      operator,
      results,
      total: results.length
    };
  }
);

// 関連タグの提案
server.post<{ Body: { tags: string[] } }>(
  '/v1/tags/suggest',
  async (request, reply) => {
    const { tags } = request.body;
    const tagSearch = new TagSearch();
    const allTools = toolRegistry.list();
    const suggestions = tagSearch.suggestRelatedTags(allTools, tags);

    return {
      selectedTags: tags,
      suggestions
    };
  }
);
```

## 3. カテゴリフィルタリング

### 3.1 概要

ツールをカテゴリで分類し、カテゴリでフィルタリングする機能を提供します。

### 3.2 実装設計

```typescript
// src/search/category-search.ts

export class CategorySearch {
  /**
   * カテゴリで検索
   */
  searchByCategory(tools: ToolMetadata[], category: string): ToolMetadata[] {
    return tools.filter(tool => tool.category === category);
  }

  /**
   * すべてのカテゴリを取得
   */
  getAllCategories(tools: ToolMetadata[]): Array<{ category: string; count: number }> {
    const categoryCounts = new Map<string, number>();

    for (const tool of tools) {
      if (!tool.category) continue;
      categoryCounts.set(
        tool.category,
        (categoryCounts.get(tool.category) || 0) + 1
      );
    }

    return Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  /**
   * カテゴリの階層構造をサポート（将来の拡張）
   */
  searchByCategoryPath(tools: ToolMetadata[], categoryPath: string[]): ToolMetadata[] {
    // 例: ["data", "processing", "transform"] -> "data/processing/transform"
    const fullPath = categoryPath.join('/');
    return tools.filter(tool =>
      tool.category && tool.category.startsWith(fullPath)
    );
  }
}
```

#### 3.2.1 APIエンドポイント

```typescript
// カテゴリ一覧取得
server.get('/v1/categories', async (request, reply) => {
  const categorySearch = new CategorySearch();
  const allTools = toolRegistry.list();
  const categories = categorySearch.getAllCategories(allTools);

  return {
    categories,
    total: categories.length
  };
});

// カテゴリで検索
server.get<{ Querystring: { category: string } }>(
  '/v1/tools/by-category/:category',
  async (request, reply) => {
    const { category } = request.params;
    const categorySearch = new CategorySearch();
    const allTools = toolRegistry.list();
    const results = categorySearch.searchByCategory(allTools, category);

    return {
      category,
      results,
      total: results.length
    };
  }
);
```

## 4. 複合検索

### 4.1 概要

テキスト検索、タグ、カテゴリを組み合わせた複合検索を提供します。

### 4.2 実装設計

```typescript
// src/search/composite-search.ts

export interface CompositeSearchOptions {
  query?: string;
  tags?: string[];
  tagOperator?: 'and' | 'or';
  category?: string;
  matchType?: 'partial' | 'prefix' | 'exact';
  fields?: ('name' | 'description')[];
  caseSensitive?: boolean;
  sortBy?: 'relevance' | 'name' | 'category';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export class CompositeSearch {
  constructor(
    private textSearch: TextSearch,
    private tagSearch: TagSearch,
    private categorySearch: CategorySearch
  ) {}

  search(tools: ToolMetadata[], options: CompositeSearchOptions): {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
  } {
    let filteredTools = [...tools];

    // 1. カテゴリでフィルタ
    if (options.category) {
      filteredTools = this.categorySearch.searchByCategory(
        filteredTools,
        options.category
      );
    }

    // 2. タグでフィルタ
    if (options.tags && options.tags.length > 0) {
      filteredTools = options.tagOperator === 'and'
        ? this.tagSearch.searchByTagsAnd(filteredTools, options.tags)
        : this.tagSearch.searchByTagsOr(filteredTools, options.tags);
    }

    // 3. テキスト検索
    let results: SearchResult[];
    if (options.query) {
      results = this.textSearch.search(filteredTools, {
        query: options.query,
        matchType: options.matchType,
        fields: options.fields,
        caseSensitive: options.caseSensitive,
        limit: 9999 // 後でページネーション
      });
    } else {
      // クエリがない場合は全ツールを返す（スコアは1.0）
      results = filteredTools.map(tool => ({
        tool,
        score: 1.0,
        matches: []
      }));
    }

    // 4. ソート
    results = this.sortResults(results, options.sortBy, options.sortOrder);

    // 5. ページネーション
    const offset = options.offset || 0;
    const limit = options.limit || 20;
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      results: paginatedResults,
      total,
      hasMore
    };
  }

  private sortResults(
    results: SearchResult[],
    sortBy: string = 'relevance',
    sortOrder: string = 'desc'
  ): SearchResult[] {
    const sorted = [...results];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
        break;

      case 'category':
        sorted.sort((a, b) =>
          (a.tool.category || '').localeCompare(b.tool.category || '')
        );
        break;

      case 'relevance':
      default:
        sorted.sort((a, b) => b.score - a.score);
        break;
    }

    if (sortOrder === 'asc') {
      sorted.reverse();
    }

    return sorted;
  }
}
```

#### 4.2.1 APIエンドポイント

```typescript
// 複合検索エンドポイント
server.post<{ Body: CompositeSearchOptions }>(
  '/v1/search',
  {
    schema: {
      body: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          tagOperator: { type: 'string', enum: ['and', 'or'] },
          category: { type: 'string' },
          matchType: { type: 'string', enum: ['partial', 'prefix', 'exact'] },
          fields: {
            type: 'array',
            items: { type: 'string', enum: ['name', 'description'] }
          },
          caseSensitive: { type: 'boolean' },
          sortBy: { type: 'string', enum: ['relevance', 'name', 'category'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 }
        }
      }
    }
  },
  async (request, reply) => {
    const compositeSearch = new CompositeSearch(
      new TextSearch(),
      new TagSearch(),
      new CategorySearch()
    );

    const allTools = toolRegistry.list();
    const searchResult = compositeSearch.search(allTools, request.body);

    return {
      query: request.body.query,
      filters: {
        tags: request.body.tags,
        category: request.body.category
      },
      results: searchResult.results.map(r => ({
        tool: r.tool,
        score: r.score,
        matches: r.matches
      })),
      pagination: {
        offset: request.body.offset || 0,
        limit: request.body.limit || 20,
        total: searchResult.total,
        hasMore: searchResult.hasMore
      }
    };
  }
);
```

## 5. セマンティック検索（Phase 5）

### 5.1 概要

ベクトル埋め込みを使用した意味的な検索を提供します。ツールの説明文をベクトル化し、クエリとの類似度で検索します。

### 5.2 実装設計

```typescript
// src/search/semantic-search.ts

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class SemanticSearch {
  private vectorStore: Map<string, number[]>;

  constructor(private embeddingProvider: EmbeddingProvider) {
    this.vectorStore = new Map();
  }

  /**
   * ツールのインデックス作成
   */
  async indexTools(tools: ToolMetadata[]): Promise<void> {
    const texts = tools.map(tool =>
      `${tool.name} ${tool.description}`
    );

    const embeddings = await this.embeddingProvider.embedBatch(texts);

    tools.forEach((tool, index) => {
      this.vectorStore.set(tool.name, embeddings[index]);
    });
  }

  /**
   * セマンティック検索
   */
  async search(
    query: string,
    tools: ToolMetadata[],
    limit: number = 20
  ): Promise<SearchResult[]> {
    // クエリのベクトル化
    const queryVector = await this.embeddingProvider.embed(query);

    // 各ツールとの類似度を計算
    const results: SearchResult[] = [];
    for (const tool of tools) {
      const toolVector = this.vectorStore.get(tool.name);
      if (!toolVector) continue;

      const similarity = this.cosineSimilarity(queryVector, toolVector);
      if (similarity > 0.5) { // 閾値
        results.push({
          tool,
          score: similarity,
          matches: []
        });
      }
    }

    // スコアでソート
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * コサイン類似度の計算
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

/**
 * OpenAI Embeddings実装例
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  constructor(private apiKey: string) {}

  async embed(text: string): Promise<number[]> {
    // OpenAI API呼び出し
    // 実装省略
    throw new Error('Not implemented');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // OpenAI API呼び出し（バッチ）
    // 実装省略
    throw new Error('Not implemented');
  }
}
```

#### 5.2.1 APIエンドポイント

```typescript
// セマンティック検索エンドポイント（Phase 5）
server.post<{ Body: { query: string; limit?: number } }>(
  '/v1/search/semantic',
  async (request, reply) => {
    const { query, limit = 20 } = request.body;

    if (!query || query.trim() === '') {
      return reply.code(400).send({
        error: 'Query is required'
      });
    }

    const allTools = toolRegistry.list();
    const results = await semanticSearch.search(query, allTools, limit);

    return {
      query,
      type: 'semantic',
      results: results.map(r => ({
        tool: r.tool,
        score: r.score
      })),
      total: results.length
    };
  }
);
```

## 6. 検索パフォーマンスの最適化

### 6.1 インデックス構築

```typescript
// src/search/search-index.ts

export class SearchIndex {
  private nameIndex: Map<string, ToolMetadata>;
  private descriptionTokens: Map<string, Set<string>>;
  private tagIndex: Map<string, Set<string>>;
  private categoryIndex: Map<string, Set<string>>;

  constructor() {
    this.nameIndex = new Map();
    this.descriptionTokens = new Map();
    this.tagIndex = new Map();
    this.categoryIndex = new Map();
  }

  /**
   * ツールのインデックス作成
   */
  buildIndex(tools: ToolMetadata[]): void {
    for (const tool of tools) {
      // 名前インデックス
      this.nameIndex.set(tool.name, tool);

      // 説明文のトークン化
      const tokens = this.tokenize(tool.description);
      tokens.forEach(token => {
        if (!this.descriptionTokens.has(token)) {
          this.descriptionTokens.set(token, new Set());
        }
        this.descriptionTokens.get(token)!.add(tool.name);
      });

      // タグインデックス
      if (tool.tags) {
        tool.tags.forEach(tag => {
          if (!this.tagIndex.has(tag)) {
            this.tagIndex.set(tag, new Set());
          }
          this.tagIndex.get(tag)!.add(tool.name);
        });
      }

      // カテゴリインデックス
      if (tool.category) {
        if (!this.categoryIndex.has(tool.category)) {
          this.categoryIndex.set(tool.category, new Set());
        }
        this.categoryIndex.get(tool.category)!.add(tool.name);
      }
    }
  }

  /**
   * インデックスを使った高速検索
   */
  search(query: string): Set<string> {
    const tokens = this.tokenize(query);
    const results = new Set<string>();

    for (const token of tokens) {
      const matches = this.descriptionTokens.get(token);
      if (matches) {
        matches.forEach(name => results.add(name));
      }
    }

    return results;
  }

  /**
   * テキストをトークン化
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 2); // 3文字以上
  }
}
```

## 7. テスト戦略

```typescript
// src/search/text-search.test.ts
describe('TextSearch', () => {
  let textSearch: TextSearch;
  let testTools: ToolMetadata[];

  beforeEach(() => {
    textSearch = new TextSearch();
    testTools = [
      { name: 'echo', description: 'Echo a message', parameters: [] },
      { name: 'search', description: 'Search for data', parameters: [] },
      { name: 'calculator', description: 'Calculate expressions', parameters: [] }
    ];
  });

  describe('search', () => {
    it('should find tools by name partial match', () => {
      const results = textSearch.search(testTools, {
        query: 'echo',
        matchType: 'partial'
      });

      expect(results.length).toBe(1);
      expect(results[0].tool.name).toBe('echo');
    });

    it('should find tools by description', () => {
      const results = textSearch.search(testTools, {
        query: 'message',
        fields: ['description']
      });

      expect(results.length).toBe(1);
      expect(results[0].tool.name).toBe('echo');
    });

    it('should return results sorted by score', () => {
      const results = textSearch.search(testTools, {
        query: 'search'
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
```

## 8. 実装優先順位

### Phase 2: 基本検索機能
- [ ] テキスト検索の実装
- [ ] タグベースの検索
- [ ] カテゴリフィルタリング
- [ ] 複合検索API

### Phase 3: 検索最適化
- [ ] 検索インデックスの構築
- [ ] キャッシング

### Phase 5: 高度な検索
- [ ] セマンティック検索
- [ ] ファジー検索
- [ ] オートコンプリート

## 次のステップ

1. TextSearchクラスの実装
2. TagSearchクラスの実装
3. CategorySearchクラスの実装
4. CompositeSearchクラスの実装
5. APIエンドポイントの追加
6. テストの作成

[次へ: セキュリティ機能設計](./03-security-features.md)
