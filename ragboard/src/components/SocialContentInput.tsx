import React, { useState } from 'react';
import { Link, Youtube, Instagram, Facebook, Globe } from 'lucide-react';

interface SocialContentInputProps {
  onAdd: (data: any) => void;
}

export const SocialContentInput: React.FC<SocialContentInputProps> = ({ onAdd }) => {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<string>('');

  const detectPlatform = (inputUrl: string): string => {
    const lowerUrl = inputUrl.toLowerCase();
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
    if (lowerUrl.includes('instagram.com')) return 'instagram';
    if (lowerUrl.includes('tiktok.com')) return 'tiktok';
    if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) {
      if (lowerUrl.includes('/ads/')) return 'facebook-ads';
      return 'facebook';
    }
    return 'unknown';
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    setPlatform(detectPlatform(newUrl));
  };

  const handleSubmit = () => {
    if (!url || platform === 'unknown') return;

    onAdd({
      type: 'social',
      title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Content`,
      metadata: {
        url,
        platform,
        embedUrl: url, // This would be processed by backend
      },
    });
  };

  const getPlatformIcon = () => {
    switch (platform) {
      case 'youtube':
        return <Youtube className="w-5 h-5 text-red-600" />;
      case 'instagram':
        return <Instagram className="w-5 h-5 text-pink-600" />;
      case 'facebook':
      case 'facebook-ads':
        return <Facebook className="w-5 h-5 text-blue-600" />;
      case 'tiktok':
        return <Globe className="w-5 h-5 text-black" />;
      default:
        return <Link className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Social Media URL
        </label>
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {getPlatformIcon()}
          </div>
          <input
            type="url"
            value={url}
            onChange={handleUrlChange}
            placeholder="Paste YouTube, Instagram, TikTok, or Facebook URL..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
      </div>

      {platform && platform !== 'unknown' && (
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-sm text-gray-600">
            Detected platform: <span className="font-medium capitalize">{platform.replace('-', ' ')}</span>
          </p>
        </div>
      )}

      {platform === 'unknown' && url && (
        <div className="bg-red-50 p-3 rounded-lg">
          <p className="text-sm text-red-600">
            Please enter a valid social media URL from YouTube, Instagram, TikTok, or Facebook.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setUrl('')}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!url || platform === 'unknown'}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Add to Board
        </button>
      </div>
    </div>
  );
};