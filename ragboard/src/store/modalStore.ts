import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ModalState, BoardNode } from '../types';

interface ModalStoreState extends ModalState {
  subType?: string;
}

export const useModalStore = create<ModalStoreState>()(
  devtools(
    (set) => ({
      isOpen: false,
      type: null,
      editingNode: undefined,
      subType: undefined,

      openModal: (type: 'resource' | 'chat' | 'folder', node?: BoardNode, subType?: string) =>
        set({
          isOpen: true,
          type,
          editingNode: node,
          subType,
        }),

      closeModal: () =>
        set({
          isOpen: false,
          type: null,
          editingNode: undefined,
          subType: undefined,
        }),
    }),
    {
      name: 'modal-storage',
    }
  )
);