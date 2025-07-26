import json
import logging
import mmap
import os
import shutil
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Generator, Iterable, Tuple, Union

from ..errors import DDUFCorruptedFileError, DDUFExportError, DDUFInvalidEntryNameError


logger = logging.getLogger(__name__)

DDUF_ALLOWED_ENTRIES = {
    # Allowed file extensions in a DDUF file
    ".json",
    ".model",
    ".safetensors",
    ".txt",
}

DDUF_FOLDER_REQUIRED_ENTRIES = {
    # Each folder must contain at least one of these entries
    "config.json",
    "tokenizer_config.json",
    "preprocessor_config.json",
    "scheduler_config.json",
}


@dataclass
class DDUFEntry:
    """Object representing a file entry in a DDUF file.

    See [`read_dduf_file`] for how to read a DDUF file.

    Attributes:
        filename (str):
            The name of the file in the DDUF archive.
        offset (int):
            The offset of the file in the DDUF archive.
        length (int):
            The length of the file in the DDUF archive.
        dduf_path (str):
            The path to the DDUF archive (for internal use).
    """

    filename: str
    length: int
    offset: int

    dduf_path: Path = field(repr=False)

    @contextmanager
    def as_mmap(self) -> Generator[bytes, None, None]:
        """Open the file as a memory-mapped file.

        Useful to load safetensors directly from the file.

        Example:
            ```py
            >>> import safetensors.torch
            >>> with entry.as_mmap() as mm:
            ...     tensors = safetensors.torch.load(mm)
            ```
        """
        with self.dduf_path.open("rb") as f:
            with mmap.mmap(f.fileno(), length=0, access=mmap.ACCESS_READ) as mm:
                yield mm[self.offset : self.offset + self.length]

    def read_text(self, encoding: str = "utf-8") -> str:
        """Read the file as text.

        Useful for '.txt' and '.json' entries.

        Example:
            ```py
            >>> import json
            >>> index = json.loads(entry.read_text())
            ```
        """
        with self.dduf_path.open("rb") as f:
            f.seek(self.offset)
            return f.read(self.length).decode(encoding=encoding)


def read_dduf_file(dduf_path: Union[os.PathLike, str]) -> Dict[str, DDUFEntry]:
    """
    Read a DDUF file and return a dictionary of entries.

    Only the metadata is read, the data is not loaded in memory.

    Args:
        dduf_path (`str` or `os.PathLike`):
            The path to the DDUF file to read.

    Returns:
        `Dict[str, DDUFEntry]`:
            A dictionary of [`DDUFEntry`] indexed by filename.

    Raises:
        - [`DDUFCorruptedFileError`]: If the DDUF file is corrupted (i.e. doesn't follow the DDUF format).

    Example:
        ```python
        >>> import json
        >>> import safetensors.torch
        >>> from huggingface_hub import read_dduf_file

        # Read DDUF metadata
        >>> dduf_entries = read_dduf_file("FLUX.1-dev.dduf")

        # Returns a mapping filename <> DDUFEntry
        >>> dduf_entries["model_index.json"]
        DDUFEntry(filename='model_index.json', offset=66, length=587)

        # Load model index as JSON
        >>> json.loads(dduf_entries["model_index.json"].read_text())
        {'_class_name': 'FluxPipeline', '_diffusers_version': '0.32.0.dev0', '_name_or_path': 'black-forest-labs/FLUX.1-dev', ...

        # Load VAE weights using safetensors
        >>> with dduf_entries["vae/diffusion_pytorch_model.safetensors"].as_mmap() as mm:
        ...     state_dict = safetensors.torch.load(mm)
        ```
    """
    entries = {}
    dduf_path = Path(dduf_path)
    logger.info(f"Reading DDUF file {dduf_path}")
    with zipfile.ZipFile(str(dduf_path), "r") as zf:
        for info in zf.infolist():
            logger.debug(f"Reading entry {info.filename}")
            if info.compress_type != zipfile.ZIP_STORED:
                raise DDUFCorruptedFileError("Data must not be compressed in DDUF file.")

            try:
                _validate_dduf_entry_name(info.filename)
            except DDUFInvalidEntryNameError as e:
                raise DDUFCorruptedFileError(f"Invalid entry name in DDUF file: {info.filename}") from e

            offset = _get_data_offset(zf, info)

            entries[info.filename] = DDUFEntry(
                filename=info.filename, offset=offset, length=info.file_size, dduf_path=dduf_path
            )

    # Consistency checks on the DDUF file
    if "model_index.json" not in entries:
        raise DDUFCorruptedFileError("Missing required 'model_index.json' entry in DDUF file.")
    index = json.loads(entries["model_index.json"].read_text())
    _validate_dduf_structure(index, entries.keys())

    logger.info(f"Done reading DDUF file {dduf_path}. Found {len(entries)} entries")
    return entries


def export_entries_as_dduf(
    dduf_path: Union[str, os.PathLike], entries: Iterable[Tuple[str, Union[str, Path, bytes]]]
) -> None:
    """Write a DDUF file from an iterable of entries.

    This is a lower-level helper than [`export_folder_as_dduf`] that allows more flexibility when serializing data.
    In particular, you don't need to save the data on disk before exporting it in the DDUF file.

    Args:
        dduf_path (`str` or `os.PathLike`):
            The path to the DDUF file to write.
        entries (`Iterable[Tuple[str, Union[str, Path, bytes]]]`):
            An iterable of entries to write in the DDUF file. Each entry is a tuple with the filename and the content.
            The filename should be the path to the file in the DDUF archive.
            The content can be a string or a pathlib.Path representing a path to a file on the local disk or directly the content as bytes.

    Raises:
        - [`DDUFExportError`]: If anything goes wrong during the export (e.g. invalid entry name, missing 'model_index.json', etc.).

    Example:
        ```python
        # Export specific files from the local disk.
        >>> from huggingface_hub import export_entries_as_dduf
        >>> export_entries_as_dduf(
        ...     dduf_path="stable-diffusion-v1-4-FP16.dduf",
        ...     entries=[ # List entries to add to the DDUF file (here, only FP16 weights)
        ...         ("model_index.json", "path/to/model_index.json"),
        ...         ("vae/config.json", "path/to/vae/config.json"),
        ...         ("vae/diffusion_pytorch_model.fp16.safetensors", "path/to/vae/diffusion_pytorch_model.fp16.safetensors"),
        ...         ("text_encoder/config.json", "path/to/text_encoder/config.json"),
        ...         ("text_encoder/model.fp16.safetensors", "path/to/text_encoder/model.fp16.safetensors"),
        ...         # ... add more entries here
        ...     ]
        ... )
        ```

        ```python
        # Export state_dicts one by one from a loaded pipeline
        >>> from diffusers import DiffusionPipeline
        >>> from typing import Generator, Tuple
        >>> import safetensors.torch
        >>> from huggingface_hub import export_entries_as_dduf
        >>> pipe = DiffusionPipeline.from_pretrained("CompVis/stable-diffusion-v1-4")
        ... # ... do some work with the pipeline

        >>> def as_entries(pipe: DiffusionPipeline) -> Generator[Tuple[str, bytes], None, None]:
        ...     # Build an generator that yields the entries to add to the DDUF file.
        ...     # The first element of the tuple is the filename in the DDUF archive (must use UNIX separator!). The second element is the content of the file.
        ...     # Entries will be evaluated lazily when the DDUF file is created (only 1 entry is loaded in memory at a time)
        ...     yield "vae/config.json", pipe.vae.to_json_string().encode()
        ...     yield "vae/diffusion_pytorch_model.safetensors", safetensors.torch.save(pipe.vae.state_dict())
        ...     yield "text_encoder/config.json", pipe.text_encoder.config.to_json_string().encode()
        ...     yield "text_encoder/model.safetensors", safetensors.torch.save(pipe.text_encoder.state_dict())
        ...     # ... add more entries here

        >>> export_entries_as_dduf(dduf_path="stable-diffusion-v1-4.dduf", entries=as_entries(pipe))
        ```
    """
    logger.info(f"Exporting DDUF file '{dduf_path}'")
    filenames = set()
    index = None
    with zipfile.ZipFile(str(dduf_path), "w", zipfile.ZIP_STORED) as archive:
        for filename, content in entries:
            if filename in filenames:
                raise DDUFExportError(f"Can't add duplicate entry: {filename}")
            filenames.add(filename)

            if filename == "model_index.json":
                try:
                    index = json.loads(_load_content(content).decode())
                except json.JSONDecodeError as e:
                    raise DDUFExportError("Failed to parse 'model_index.json'.") from e

            try:
                filename = _validate_dduf_entry_name(filename)
            except DDUFInvalidEntryNameError as e:
                raise DDUFExportError(f"Invalid entry name: {filename}") from e
            logger.debug(f"Adding entry '{filename}' to DDUF file")
            _dump_content_in_archive(archive, filename, content)

    # Consistency checks on the DDUF file
    if index is None:
        raise DDUFExportError("Missing required 'model_index.json' entry in DDUF file.")
    try:
        _validate_dduf_structure(index, filenames)
    except DDUFCorruptedFileError as e:
        raise DDUFExportError("Invalid DDUF file structure.") from e

    logger.info(f"Done writing DDUF file {dduf_path}")


def export_folder_as_dduf(dduf_path: Union[str, os.PathLike], folder_path: Union[str, os.PathLike]) -> None:
    """
    Export a folder as a DDUF file.

    AUses [`export_entries_as_dduf`] under the hood.

    Args:
        dduf_path (`str` or `os.PathLike`):
            The path to the DDUF file to write.
        folder_path (`str` or `os.PathLike`):
            The path to the folder containing the diffusion model.

    Example:
        ```python
        >>> from huggingface_hub import export_folder_as_dduf
        >>> export_folder_as_dduf(dduf_path="FLUX.1-dev.dduf", folder_path="path/to/FLUX.1-dev")
        ```
    """
    folder_path = Path(folder_path)

    def _iterate_over_folder() -> Iterable[Tuple[str, Path]]:
        for path in Path(folder_path).glob("**/*"):
            if not path.is_file():
                continue
            if path.suffix not in DDUF_ALLOWED_ENTRIES:
                logger.debug(f"Skipping file '{path}' (file type not allowed)")
                continue
            path_in_archive = path.relative_to(folder_path)
            if len(path_in_archive.parts) >= 3:
                logger.debug(f"Skipping file '{path}' (nested directories not allowed)")
                continue
            yield path_in_archive.as_posix(), path

    export_entries_as_dduf(dduf_path, _iterate_over_folder())


def _dump_content_in_archive(archive: zipfile.ZipFile, filename: str, content: Union[str, os.PathLike, bytes]) -> None:
    with archive.open(filename, "w", force_zip64=True) as archive_fh:
        if isinstance(content, (str, Path)):
            content_path = Path(content)
            with content_path.open("rb") as content_fh:
                shutil.copyfileobj(content_fh, archive_fh, 1024 * 1024 * 8)  # type: ignore[misc]
        elif isinstance(content, bytes):
            archive_fh.write(content)
        else:
            raise DDUFExportError(f"Invalid content type for {filename}. Must be str, Path or bytes.")


def _load_content(content: Union[str, Path, bytes]) -> bytes:
    """Load the content of an entry as bytes.

    Used only for small checks (not to dump content into archive).
    """
    if isinstance(content, (str, Path)):
        return Path(content).read_bytes()
    elif isinstance(content, bytes):
        return content
    else:
        raise DDUFExportError(f"Invalid content type. Must be str, Path or bytes. Got {type(content)}.")


def _validate_dduf_entry_name(entry_name: str) -> str:
    if "." + entry_name.split(".")[-1] not in DDUF_ALLOWED_ENTRIES:
        raise DDUFInvalidEntryNameError(f"File type not allowed: {entry_name}")
    if "\\" in entry_name:
        raise DDUFInvalidEntryNameError(f"Entry names must use UNIX separators ('/'). Got {entry_name}.")
    entry_name = entry_name.strip("/")
    if entry_name.count("/") > 1:
        raise DDUFInvalidEntryNameError(f"DDUF only supports 1 level of directory. Got {entry_name}.")
    return entry_name


def _validate_dduf_structure(index: Any, entry_names: Iterable[str]) -> None:
    """
    Consistency checks on the DDUF file structure.

    Rules:
    - The 'model_index.json' entry is required and must contain a dictionary.
    - Each folder name must correspond to an entry in 'model_index.json'.
    - Each folder must contain at least a config file ('config.json', 'tokenizer_config.json', 'preprocessor_config.json', 'scheduler_config.json').

    Args:
        index (Any):
            The content of the 'model_index.json' entry.
        entry_names (Iterable[str]):
            The list of entry names in the DDUF file.

    Raises:
        - [`DDUFCorruptedFileError`]: If the DDUF file is corrupted (i.e. doesn't follow the DDUF format).
    """
    if not isinstance(index, dict):
        raise DDUFCorruptedFileError(f"Invalid 'model_index.json' content. Must be a dictionary. Got {type(index)}.")

    dduf_folders = {entry.split("/")[0] for entry in entry_names if "/" in entry}
    for folder in dduf_folders:
        if folder not in index:
            raise DDUFCorruptedFileError(f"Missing required entry '{folder}' in 'model_index.json'.")
        if not any(f"{folder}/{required_entry}" in entry_names for required_entry in DDUF_FOLDER_REQUIRED_ENTRIES):
            raise DDUFCorruptedFileError(
                f"Missing required file in folder '{folder}'. Must contains at least one of {DDUF_FOLDER_REQUIRED_ENTRIES}."
            )


def _get_data_offset(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> int:
    """
    Calculate the data offset for a file in a ZIP archive.

    Args:
        zf (`zipfile.ZipFile`):
            The opened ZIP file. Must be opened in read mode.
        info (`zipfile.ZipInfo`):
            The file info.

    Returns:
        int: The offset of the file data in the ZIP archive.
    """
    if zf.fp is None:
        raise DDUFCorruptedFileError("ZipFile object must be opened in read mode.")

    # Step 1: Get the local file header offset
    header_offset = info.header_offset

    # Step 2: Read the local file header
    zf.fp.seek(header_offset)
    local_file_header = zf.fp.read(30)  # Fixed-size part of the local header

    if len(local_file_header) < 30:
        raise DDUFCorruptedFileError("Incomplete local file header.")

    # Step 3: Parse the header fields to calculate the start of file data
    # Local file header: https://en.wikipedia.org/wiki/ZIP_(file_format)#File_headers
    filename_len = int.from_bytes(local_file_header[26:28], "little")
    extra_field_len = int.from_bytes(local_file_header[28:30], "little")

    # Data offset is after the fixed header, filename, and extra fields
    data_offset = header_offset + 30 + filename_len + extra_field_len

    return data_offset
