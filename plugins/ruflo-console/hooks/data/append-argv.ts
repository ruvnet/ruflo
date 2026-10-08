/**
 * The one argv that appends stdin to a log: GNU `dd` with O_APPEND, no shell, the path one element. Shared by the Events store
 * (activity-io.ts) and the autopilot journal (ap-journal.ts), so both keep a batch whole when two consoles write one file.
 * `bs=1M iflag=fullblock` matters: dd's default 512-byte blocks write a batch from a pipe in many short `write` calls, so two
 * writers' batches interleave in the middle of a line (measured: 1094 of 4800 lines torn with two writers). One block is one
 * O_APPEND write, which the kernel keeps whole. A leaf: no imports.
 */
export const appendArgv = (path: string): readonly string[] => ['dd', `of=${path}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none']
