ALTER TABLE max_seq_id ADD COLUMN int_seq_id INTEGER;

-- Convert 8 byte wide big-endian integer as blob to native 64 bit integer.
-- Adapted from https://stackoverflow.com/a/70296198.
UPDATE max_seq_id SET int_seq_id = (
  SELECT (
       (instr('123456789ABCDEF', substr(hex(seq_id), -1 , 1)) <<  0)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -2 , 1)) <<  4)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -3 , 1)) <<  8)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -4 , 1)) << 12)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -5 , 1)) << 16)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -6 , 1)) << 20)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -7 , 1)) << 24)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -8 , 1)) << 28)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -9 , 1)) << 32)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -10, 1)) << 36)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -11, 1)) << 40)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -12, 1)) << 44)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -13, 1)) << 48)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -14, 1)) << 52)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -15, 1)) << 56)
     | (instr('123456789ABCDEF', substr(hex(seq_id), -16, 1)) << 60)
    )
);

ALTER TABLE max_seq_id DROP COLUMN seq_id;
ALTER TABLE max_seq_id RENAME COLUMN int_seq_id TO seq_id;
