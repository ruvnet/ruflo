/**
 * VectorSearchResult Component
 * Displays search operation results with similarity scores
 */

import React from 'react';
import type { MemoryOperation, VectorSearchResult as VectorSearchResultType } from '../../types/memory';

interface VectorSearchResultProps {
  searchOp: MemoryOperation;
}

const getSimilarityColor = (similarity: number): string => {
  if (similarity >= 0.8) {
    return 'text-green-400 bg-green-400/10';
  }
  if (similarity >= 0.5) {
    return 'text-yellow-400 bg-yellow-400/10';
  }
  return 'text-red-400 bg-red-400/10';
};

const getSimilarityBarColor = (similarity: number): string => {
  if (similarity >= 0.8) {
    return 'bg-green-500';
  }
  if (similarity >= 0.5) {
    return 'bg-yellow-500';
  }
  return 'bg-red-500';
};

const formatSimilarity = (similarity: number): string => {
  return (similarity * 100).toFixed(1) + '%';
};

const truncateValue = (value: unknown, maxLength = 150): string => {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > maxLength) {
      return str.slice(0, maxLength) + '...';
    }
    return str;
  } catch {
    return '[Unable to display]';
  }
};

export const VectorSearchResult: React.FC<VectorSearchResultProps> = ({ searchOp }) => {
  if (searchOp.operation !== 'search') {
    return null;
  }

  const results = searchOp.results || [];
  const hasResults = results.length > 0;

  return (
    <div className="flex flex-col gap-3 p-4 bg-gray-800 rounded-lg border border-gray-700">
      {/* Query Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm font-medium text-gray-200">Vector Search</span>
        </div>
        {searchOp.query && (
          <div className="flex items-start gap-2 pl-6">
            <span className="text-xs text-gray-500 flex-shrink-0">Query:</span>
            <span className="text-sm text-purple-300 font-mono break-all">"{searchOp.query}"</span>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center gap-2 pl-6">
        <span className="text-xs text-gray-500">Results:</span>
        <span className={`text-sm font-medium ${hasResults ? 'text-white' : 'text-gray-500'}`}>
          {searchOp.resultCount ?? results.length} found
        </span>
      </div>

      {/* Results List */}
      {hasResults ? (
        <div className="flex flex-col gap-2 pl-6">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Top Results</span>
          <div className="flex flex-col gap-1.5">
            {results.map((result, index) => (
              <ResultItem key={`${result.namespace}::${result.key}-${index}`} result={result} rank={index + 1} />
            ))}
          </div>
        </div>
      ) : (
        <div className="pl-6 py-2">
          <span className="text-sm text-gray-500 italic">No matching results</span>
        </div>
      )}
    </div>
  );
};

interface ResultItemProps {
  result: VectorSearchResultType;
  rank: number;
}

const ResultItem: React.FC<ResultItemProps> = ({ result, rank }) => {
  const similarityColor = getSimilarityColor(result.similarity);
  const barColor = getSimilarityBarColor(result.similarity);

  return (
    <div className="flex flex-col gap-1.5 p-2 bg-gray-900/50 rounded border border-gray-700">
      {/* Result Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Rank Badge */}
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-700 text-xs text-gray-400 font-medium flex-shrink-0">
            {rank}
          </span>

          {/* Namespace::Key */}
          <span className="text-sm text-gray-200 truncate">
            <span className="text-gray-500">{result.namespace}</span>
            <span className="text-gray-600">::</span>
            <span className="text-white font-medium">{result.key}</span>
          </span>
        </div>

        {/* Similarity Score */}
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${similarityColor}`}>
          <span className="text-xs font-mono font-medium">{formatSimilarity(result.similarity)}</span>
        </div>
      </div>

      {/* Similarity Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all duration-300`}
            style={{ width: `${result.similarity * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 font-mono w-8 text-right">
          {result.similarity.toFixed(2)}
        </span>
      </div>

      {/* Value Preview (if available) */}
      {result.value !== undefined && (
        <div className="pt-1">
          <pre className="text-xs text-gray-400 bg-gray-800 rounded p-1.5 overflow-x-auto">
            {truncateValue(result.value)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default VectorSearchResult;
