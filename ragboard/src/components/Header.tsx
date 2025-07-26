import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">RAGBoard</h1>
        <div className="flex items-center space-x-4">
          <button className="text-gray-600 hover:text-gray-800">
            Settings
          </button>
          <button className="text-gray-600 hover:text-gray-800">
            Help
          </button>
        </div>
      </div>
    </header>
  );
};