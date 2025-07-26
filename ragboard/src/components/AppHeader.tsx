import React from 'react';
import { User, MoreVertical, Share2, DollarSign } from 'lucide-react';

interface AppHeaderProps {
  user?: {
    name: string;
    avatar?: string;
  };
  tokenUsage: {
    used: number;
    total: number;
  };
  onUpgrade: () => void;
  onShare: () => void;
  onReferral: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  user = { name: 'Guest', avatar: '' },
  tokenUsage = { used: 562, total: 2000 },
  onUpgrade,
  onShare,
  onReferral,
}) => {
  const tokenPercentage = (tokenUsage.used / tokenUsage.total) * 100;

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-50 px-4">
      <div className="flex items-center justify-between h-full">
        {/* Left Section - Logo and Branding */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="grid grid-cols-2 gap-1 w-8 h-8">
                <div className="bg-purple-600 rounded-tl-lg"></div>
                <div className="bg-purple-400 rounded-tr-lg"></div>
                <div className="bg-purple-400 rounded-bl-lg"></div>
                <div className="bg-purple-600 rounded-br-lg"></div>
              </div>
              <span className="font-semibold text-purple-600 text-lg">Purple Firefly</span>
            </div>
          </div>

          {/* Status Tags */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
              <span className="text-xs">👋</span> Hiring
            </span>
            <span className="flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium">
              <span className="text-xs">🤝</span> Affiliate
            </span>
            <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
              <span className="text-xs">👨‍💻</span> APIs
            </span>
          </div>
        </div>

        {/* Right Section - User Actions */}
        <div className="flex items-center gap-4">
          {/* Token Usage */}
          <div className="flex items-center gap-2">
            <div className="relative w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="absolute left-0 top-0 h-full bg-purple-600 rounded-full transition-all duration-300"
                style={{ width: `${tokenPercentage}%` }}
              />
            </div>
            <span className="text-sm text-gray-600">
              {tokenUsage.used} / {(tokenUsage.total / 1000).toFixed(1)}k
            </span>
          </div>

          {/* Action Buttons */}
          <button
            onClick={onUpgrade}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            Upgrade
          </button>

          <button
            onClick={onShare}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium flex items-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>

          <button
            onClick={onReferral}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all text-sm font-medium flex items-center gap-2 shadow-lg hover:shadow-xl"
          >
            <DollarSign className="w-4 h-4" />
            Refer & Earn $70
          </button>

          {/* User Profile */}
          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="relative">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 rounded-full border-2 border-gray-200"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-600" />
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
            </div>
            <button className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
              <MoreVertical className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;