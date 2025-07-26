import { useState, useCallback } from 'react';
import VectorDBService, { VectorSearchResult } from '../services/vectordb';
import { useApi } from './useApi';

interface UseVectorSearchOptions {
  boardId: string;
  topK?: number;
  onResults?: (results: VectorSearchResult[]) => void;
}

export function useVectorSearch({
  boardId,
  topK = 5,
  onResults,
}: UseVectorSearchOptions) {
  const [results, setResults] = useState<VectorSearchResult[]>([]);
  const [query, setQuery] = useState('');
  
  const { execute: performSearch, loading, error } = useApi(
    async (searchQuery: string, filters?: any) => {
      const searchResults = await VectorDBService.searchSimilar(
        searchQuery,
        boardId,
        topK,
        filters
      );
      setResults(searchResults);
      onResults?.(searchResults);
      return searchResults;
    }
  );

  const search = useCallback(
    async (searchQuery: string, filters?: any) => {
      setQuery(searchQuery);
      return performSearch(searchQuery, filters);
    },
    [performSearch]
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setQuery('');
  }, []);

  return {
    results,
    query,
    loading,
    error,
    search,
    clearResults,
  };
}