import React from 'react';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';

interface ResizableNodeWrapperProps {
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  selected?: boolean;
}

export const ResizableNodeWrapper: React.FC<ResizableNodeWrapperProps> = ({
  children,
  minWidth = 200,
  minHeight = 100,
  selected = false,
}) => {
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        handleStyle={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: '#7c3aed',
          border: '2px solid white',
        }}
        lineStyle={{
          borderColor: '#7c3aed',
          borderWidth: 2,
        }}
      />
      {children}
    </>
  );
};