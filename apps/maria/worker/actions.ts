// Fusion ou abandon d'une branche de mission, demandés depuis l'interface.
import type { Mission } from '../src/lib/types';
import type { Store } from './store';
import { mergeWorktree, removeWorktree } from './worktree';

export async function runWorktreeAction(mission: Mission, workspaceDir: string, store: Store): Promise<void> {
  const { worktree_path: wtPath, branch, worktree_action: action } = mission;
  if (!wtPath || !branch || !action) return;

  if (await store.worktreeBusy(wtPath)) {
    await store.updateWorktree(wtPath, {
      worktree_action: null,
      worktree_error: 'Une mission tourne encore dans cette branche : attends sa fin ou annule-la.',
    });
    return;
  }

  try {
    if (action === 'merge') {
      await mergeWorktree(workspaceDir, { path: wtPath, branch }, `MarIA: fusion de ${branch}`);
    } else {
      await removeWorktree(workspaceDir, { path: wtPath, branch });
    }
    await store.updateWorktree(wtPath, {
      worktree_state: action === 'merge' ? 'merged' : 'discarded',
      worktree_action: null,
      worktree_error: null,
    });
    console.log(`[maria] branche ${branch} ${action === 'merge' ? 'fusionnée' : 'abandonnée'}`);
  } catch (err) {
    await store.updateWorktree(wtPath, { worktree_action: null, worktree_error: (err as Error).message });
    console.error(`[maria] ${branch} : ${(err as Error).message}`);
  }
}
