import os


def get_directory_size(directory: str) -> int:
    """
    Calculate the total size of the directory by walking through each file.

    Parameters:
    directory (str): The path of the directory for which to calculate the size.

    Returns:
    total_size (int): The total size of the directory in bytes.
    """
    total_size = 0
    for dirpath, _, filenames in os.walk(directory):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            # skip if it is symbolic link
            if not os.path.islink(fp):
                total_size += os.path.getsize(fp)

    return total_size
