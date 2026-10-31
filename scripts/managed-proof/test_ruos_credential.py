import contextlib
import io
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import ruos_credential as reader

class CredentialReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.home=pathlib.Path(self.temp.name);self.directory=self.home/'.ruos';self.directory.mkdir(mode=0o700);self.file=self.directory/'env'
    def tearDown(self):self.temp.cleanup()
    def write(self,text):self.file.write_text(text);self.file.chmod(0o600)
    def test_env_first_never_reads_disk(self):
        with patch.dict('os.environ',{reader.NAME:'unit-placeholder'},clear=True),patch.object(reader,'_read_named_export')as read:
            self.assertEqual(reader.openrouter_credential(),'unit-placeholder');read.assert_not_called()
    def test_placement_is_explicit(self):
        with patch.dict('os.environ',{},clear=True),patch.object(reader,'_read_named_export')as read:
            with self.assertRaises(RuntimeError):reader.openrouter_credential()
            read.assert_not_called()
    def test_exact_export_only_without_printing_or_sourcing(self):
        self.write('touch /must-not-run\nexport OTHER_KEY=not-returned\nexport OPENROUTER_API_KEY="unit-placeholder"\n')
        with patch.dict('os.environ',{},clear=True),patch.object(reader.pathlib.Path,'home',return_value=self.home),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(reader.openrouter_credential(allow_ruos_placement=True),'unit-placeholder');self.assertEqual(out.getvalue(),'')
    def test_permissions_symlink_and_duplicate_exports_rejected(self):
        self.write('export OPENROUTER_API_KEY=unit-placeholder\n');self.file.chmod(0o644)
        with self.assertRaises(RuntimeError):reader._read_named_export(self.file)
        self.file.unlink();self.file.symlink_to('/dev/null')
        with self.assertRaises(RuntimeError):reader._read_named_export(self.file)
        self.file.unlink();self.write('export OPENROUTER_API_KEY=unit-placeholder\nexport OPENROUTER_API_KEY=other-placeholder\n')
        with self.assertRaises(RuntimeError):reader._read_named_export(self.file)
    def test_shell_substitution_and_header_injection_rejected_without_values(self):
        for value in ['$(touch /must-not-run)','unit\r\nheader','short']:
            self.write("export OPENROUTER_API_KEY="+repr(value)+"\n")
            with self.subTest(value=value),self.assertRaises(RuntimeError) as error:reader._read_named_export(self.file)
            self.assertNotIn(value,str(error.exception))

if __name__=='__main__':unittest.main()
