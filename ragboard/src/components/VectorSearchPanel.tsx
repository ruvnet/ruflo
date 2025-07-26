import React, { useState } from 'react';
import { Search, X, FileText, Image, Link, Music, Film } from 'lucide-react';
import { clsx } from 'clsx';
import { useVectorSearch } from '../hooks/useVectorSearch';
import { VectorSearchResult } from '../services/vectordb';

interface VectorSearchPanelProps {
  boardId: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectResult?: (result: VectorSearchResult) => void;
}

const typeIcons: Record<string, React.ElementType> = {
  text: FileText,
  image: Image,
  url: Link,
  audio: Music,
  video: Film,
  document: FileText,
};

export const VectorSearchPanel: React.FC<VectorSearchPanelProps> = ({
  boardId,
  isOpen,
  onClose,
  onSelectResult,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { results, loading, search } = useVectorSearch({ boardId, topK: 10 });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      await search(searchQuery);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Search className="w-5 h-5" />
            Semantic Search
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="p-4 border-b">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all your resources..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              autoFocus
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Use natural language to find relevant content across all connected resources
          </p>
        </form>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              {results.map((result, index) => (
                <SearchResultItem
                  key={`${result.id}-${index}`}
                  result={result}
                  onSelect={() => onSelectResult?.(result)}
                />
              ))}
            </div>
          ) : searchQuery && !loading ? (
            <div className="text-center text-gray-500 py-8">
              <p>No results found for "{searchQuery}"</p>
              <p className="text-sm mt-2">Try different keywords or phrases</p>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <Search className="w-12 h-12 mx-auto mb-4" />
              <p>Enter a search query to find relevant content</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Search result item component
const SearchResultItem: React.FC<{
  result: VectorSearchResult;
  onSelect: () => void;
}> = ({ result, onSelect }) => {
  const Icon = typeIcons[result.metadata.type] || FileText;
  const relevancePercentage = Math.round(result.score * 100);

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full text-left p-4 rounded-lg border transition-all',
        'hover:border-purple-300 hover:bg-purple-50',
        'focus:outline-none focus:ring-2 focus:ring-purple-500'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-purple-600" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium text-gray-900 truncate">
              {result.metadata.title}
            </h3>
            <span className="text-sm text-purple-600 font-medium">
              {relevancePercentage}% match
            </span>
          </div>
          
          <p className="text-sm text-gray-600 line-clamp-2">
            {result.metadata.chunk}
          </p>
          
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>Type: {result.metadata.type}</span>
            <span>Chunk: {result.metadata.chunkIndex + 1}</span>
          </div>
        </div>
      </div>
    </button>
  );
};