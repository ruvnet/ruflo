import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FolderNode } from './FolderNode';
import { DndContext } from '@dnd-kit/core';

describe('FolderNode', () => {
  const defaultProps = {
    id: 'folder-1',
    title: 'Test Folder',
    position: { x: 100, y: 100 },
    children: ['node-1', 'node-2'],
  };

  test('renders folder with title', () => {
    render(
      <DndContext>
        <FolderNode {...defaultProps} />
      </DndContext>
    );
    
    expect(screen.getByText('Test Folder')).toBeInTheDocument();
  });

  test('shows correct item count', () => {
    render(
      <DndContext>
        <FolderNode {...defaultProps} />
      </DndContext>
    );
    
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  test('shows singular item text for single child', () => {
    render(
      <DndContext>
        <FolderNode {...defaultProps} children={['node-1']} />
      </DndContext>
    );
    
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  test('applies selected styles when selected', () => {
    const { container } = render(
      <DndContext>
        <FolderNode {...defaultProps} isSelected={true} />
      </DndContext>
    );
    
    const folderDiv = container.firstChild as HTMLElement;
    expect(folderDiv).toHaveClass('border-purple-500');
    expect(folderDiv).toHaveClass('shadow-purple-200');
  });

  test('shows expanded content when expanded', () => {
    render(
      <DndContext>
        <FolderNode {...defaultProps} isExpanded={true} />
      </DndContext>
    );
    
    expect(screen.getByText('• Node node-1')).toBeInTheDocument();
    expect(screen.getByText('• Node node-2')).toBeInTheDocument();
  });
});