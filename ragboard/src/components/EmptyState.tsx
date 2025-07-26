import React from 'react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full text-gray-500">
      <div className="text-center">
        <p className="text-lg">Start by adding resources from the sidebar</p>
        <p className="text-sm mt-2">Click on the icons to add videos, images, documents, and more</p>
      </div>
    </div>
  );
};