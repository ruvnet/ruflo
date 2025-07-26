import React, { useState } from 'react';
import { Link } from 'lucide-react';

interface URLInputProps {
  onAdd: (data: any) => void;
}

export const URLInput: React.FC<URLInputProps> = ({ onAdd }) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const isSocialUrl = (inputUrl: string): boolean => {
    const lowerUrl = inputUrl.toLowerCase();
    return (
      lowerUrl.includes('youtube.com') ||
      lowerUrl.includes('youtu.be') ||
      lowerUrl.includes('instagram.com') ||
      lowerUrl.includes('tiktok.com') ||
      lowerUrl.includes('facebook.com') ||
      lowerUrl.includes('fb.com')
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !title) return;

    if (isSocialUrl(url)) {
      alert('Please use "Add Social Content" for social media URLs.');
      return;
    }

    onAdd({
      type: 'web',
      title,
      metadata: {
        url,
        domain: new URL(url).hostname,
      },
    });

    // Reset form
    setUrl('');
    setTitle('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Website URL
        </label>
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <Link className="w-5 h-5 text-gray-400" />
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter any website URL..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            required
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          For social media content, use "Add Social Content" instead
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a title for this resource..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          required
        />
      </div>

      {url && isSocialUrl(url) && (
        <div className="bg-amber-50 p-3 rounded-lg">
          <p className="text-sm text-amber-700">
            This appears to be a social media URL. Please use "Add Social Content" from the menu for better integration.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setUrl('');
            setTitle('');
          }}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={!url || !title || isSocialUrl(url)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Add to Board
        </button>
      </div>
    </form>
  );
};