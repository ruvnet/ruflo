import React from 'react';
import { 
  MessageSquare, 
  Mic, 
  Image, 
  Type, 
  Palette,
  Globe,
  Share2,
  FileText,
  Folder,
  Plus
} from 'lucide-react';
import { clsx } from 'clsx';

interface SidebarMenuItem {
  id: string;
  icon: React.ElementType;
  label: string;
  action: () => void;
}

interface SidebarMenuProps {
  onAddResource: (type: string) => void;
}

export const SidebarMenu: React.FC<SidebarMenuProps> = ({ onAddResource }) => {
  const menuItems: SidebarMenuItem[] = [
    {
      id: 'chat',
      icon: MessageSquare,
      label: 'AI Chat',
      action: () => onAddResource('chat'),
    },
    {
      id: 'voice',
      icon: Mic,
      label: 'Record Voice',
      action: () => onAddResource('voice'),
    },
    {
      id: 'image',
      icon: Image,
      label: 'Add Image',
      action: () => onAddResource('image'),
    },
    {
      id: 'text',
      icon: Type,
      label: 'Add Text',
      action: () => onAddResource('text'),
    },
    {
      id: 'web',
      icon: Globe,
      label: 'Add URL',
      action: () => onAddResource('web'),
    },
    {
      id: 'social',
      icon: Share2,
      label: 'Add Social Content',
      action: () => onAddResource('social'),
    },
    {
      id: 'documents',
      icon: FileText,
      label: 'Upload Documents',
      action: () => onAddResource('documents'),
    },
    {
      id: 'folder',
      icon: Folder,
      label: 'Add Folder',
      action: () => onAddResource('folder'),
    },
  ];

  return (
    <div className="fixed left-0 top-14 h-[calc(100%-3.5rem)] w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 z-50">
      {/* Logo/Brand */}
      <div className="mb-8">
        <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex flex-col gap-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={item.action}
              className={clsx(
                'group relative w-12 h-12 rounded-lg flex items-center justify-center',
                'hover:bg-purple-50 transition-colors duration-200',
                'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2'
              )}
              title={item.label}
            >
              <Icon className="w-5 h-5 text-gray-600 group-hover:text-purple-600" />
              
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Add Button at Bottom */}
      <div className="mt-auto">
        <button
          onClick={() => onAddResource('quick')}
          className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center hover:bg-purple-700 transition-colors"
          title="Quick Add"
        >
          <Plus className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  );
};