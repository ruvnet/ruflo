import os
import random
import gc
import time


# Borrowed from https://github.com/rogerbinns/apsw/blob/master/apsw/tests.py#L224
# Used to delete sqlite files on Windows, since Windows file locking
# behaves differently to other operating systems
# This should only be used for test or non-production code, such as in reset_state.
def delete_file(name: str) -> None:
    try:
        os.remove(name)
    except Exception:
        pass

    chars = list("abcdefghijklmn")
    random.shuffle(chars)
    newname = name + "-n-" + "".join(chars)
    count = 0
    while os.path.exists(name):
        count += 1
        try:
            os.rename(name, newname)
        except Exception:
            if count > 30:
                n = list("abcdefghijklmnopqrstuvwxyz")
                random.shuffle(n)
                final_name = "".join(n)
                try:
                    os.rename(
                        name, "chroma-to-clean" + final_name + ".deletememanually"
                    )
                except Exception:
                    pass
                break
            time.sleep(0.1)
            gc.collect()
