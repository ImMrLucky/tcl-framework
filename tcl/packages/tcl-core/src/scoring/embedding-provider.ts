/**
 * Optional embedding backend — system works without it (lexical / entity fallbacks).
 */
export interface EmbeddingProvider {
  similarity(a: string, b: string): Promise<number>;
  batchEmbed(texts: string[]): Promise<number[][]>;
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  async similarity(): Promise<number> {
    return 0;
  }
  async batchEmbed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}
