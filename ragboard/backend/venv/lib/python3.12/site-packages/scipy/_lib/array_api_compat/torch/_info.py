"""
Array API Inspection namespace

This is the namespace for inspection functions as defined by the array API
standard. See
https://data-apis.org/array-api/latest/API_specification/inspection.html for
more details.

"""
import torch

from functools import cache

class __array_namespace_info__:
    """
    Get the array API inspection namespace for PyTorch.

    The array API inspection namespace defines the following functions:

    - capabilities()
    - default_device()
    - default_dtypes()
    - dtypes()
    - devices()

    See
    https://data-apis.org/array-api/latest/API_specification/inspection.html
    for more details.

    Returns
    -------
    info : ModuleType
        The array API inspection namespace for PyTorch.

    Examples
    --------
    >>> info = xp.__array_namespace_info__()
    >>> info.default_dtypes()
    {'real floating': numpy.float64,
     'complex floating': numpy.complex128,
     'integral': numpy.int64,
     'indexing': numpy.int64}

    """

    __module__ = 'torch'

    def capabilities(self):
        """
        Return a dictionary of array API library capabilities.

        The resulting dictionary has the following keys:

        - **"boolean indexing"**: boolean indicating whether an array library
          supports boolean indexing. Always ``True`` for PyTorch.

        - **"data-dependent shapes"**: boolean indicating whether an array
          library supports data-dependent output shapes. Always ``True`` for
          PyTorch.

        See
        https://data-apis.org/array-api/latest/API_specification/generated/array_api.info.capabilities.html
        for more details.

        See Also
        --------
        __array_namespace_info__.default_device,
        __array_namespace_info__.default_dtypes,
        __array_namespace_info__.dtypes,
        __array_namespace_info__.devices

        Returns
        -------
        capabilities : dict
            A dictionary of array API library capabilities.

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.capabilities()
        {'boolean indexing': True,
         'data-dependent shapes': True,
         'max dimensions': 64}

        """
        return {
            "boolean indexing": True,
            "data-dependent shapes": True,
            "max dimensions": 64,
        }

    def default_device(self):
        """
        The default device used for new PyTorch arrays.

        See Also
        --------
        __array_namespace_info__.capabilities,
        __array_namespace_info__.default_dtypes,
        __array_namespace_info__.dtypes,
        __array_namespace_info__.devices

        Returns
        -------
        device : Device
            The default device used for new PyTorch arrays.

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.default_device()
        device(type='cpu')

        Notes
        -----
        This method returns the static default device when PyTorch is initialized.
        However, the *current* device used by creation functions (``empty`` etc.)
        can be changed at runtime.

        See Also
        --------
        https://github.com/data-apis/array-api/issues/835
        """
        return torch.device("cpu")

    def default_dtypes(self, *, device=None):
        """
        The default data types used for new PyTorch arrays.

        Parameters
        ----------
        device : Device, optional
            The device to get the default data types for.
            Unused for PyTorch, as all devices use the same default dtypes.

        Returns
        -------
        dtypes : dict
            A dictionary describing the default data types used for new PyTorch
            arrays.

        See Also
        --------
        __array_namespace_info__.capabilities,
        __array_namespace_info__.default_device,
        __array_namespace_info__.dtypes,
        __array_namespace_info__.devices

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.default_dtypes()
        {'real floating': torch.float32,
         'complex floating': torch.complex64,
         'integral': torch.int64,
         'indexing': torch.int64}

        """
        # Note: if the default is set to float64, the devices like MPS that
        # don't support float64 will error. We still return the default_dtype
        # value here because this error doesn't represent a different default
        # per-device.
        default_floating = torch.get_default_dtype()
        default_complex = torch.complex64 if default_floating == torch.float32 else torch.complex128
        default_integral = torch.int64
        return {
            "real floating": default_floating,
            "complex floating": default_complex,
            "integral": default_integral,
            "indexing": default_integral,
        }


    def _dtypes(self, kind):
        bool = torch.bool
        int8 = torch.int8
        int16 = torch.int16
        int32 = torch.int32
        int64 = torch.int64
        uint8 = torch.uint8
        # uint16, uint32, and uint64 are present in newer versions of pytorch,
        # but they aren't generally supported by the array API functions, so
        # we omit them from this function.
        float32 = torch.float32
        float64 = torch.float64
        complex64 = torch.complex64
        complex128 = torch.complex128

        if kind is None:
            return {
                "bool": bool,
                "int8": int8,
                "int16": int16,
                "int32": int32,
                "int64": int64,
                "uint8": uint8,
                "float32": float32,
                "float64": float64,
                "complex64": complex64,
                "complex128": complex128,
            }
        if kind == "bool":
            return {"bool": bool}
        if kind == "signed integer":
            return {
                "int8": int8,
                "int16": int16,
                "int32": int32,
                "int64": int64,
            }
        if kind == "unsigned integer":
            return {
                "uint8": uint8,
            }
        if kind == "integral":
            return {
                "int8": int8,
                "int16": int16,
                "int32": int32,
                "int64": int64,
                "uint8": uint8,
            }
        if kind == "real floating":
            return {
                "float32": float32,
                "float64": float64,
            }
        if kind == "complex floating":
            return {
                "complex64": complex64,
                "complex128": complex128,
            }
        if kind == "numeric":
            return {
                "int8": int8,
                "int16": int16,
                "int32": int32,
                "int64": int64,
                "uint8": uint8,
                "float32": float32,
                "float64": float64,
                "complex64": complex64,
                "complex128": complex128,
            }
        if isinstance(kind, tuple):
            res = {}
            for k in kind:
                res.update(self.dtypes(kind=k))
            return res
        raise ValueError(f"unsupported kind: {kind!r}")

    @cache
    def dtypes(self, *, device=None, kind=None):
        """
        The array API data types supported by PyTorch.

        Note that this function only returns data types that are defined by
        the array API.

        Parameters
        ----------
        device : Device, optional
            The device to get the data types for.
            Unused for PyTorch, as all devices use the same dtypes.
        kind : str or tuple of str, optional
            The kind of data types to return. If ``None``, all data types are
            returned. If a string, only data types of that kind are returned.
            If a tuple, a dictionary containing the union of the given kinds
            is returned. The following kinds are supported:

            - ``'bool'``: boolean data types (i.e., ``bool``).
            - ``'signed integer'``: signed integer data types (i.e., ``int8``,
              ``int16``, ``int32``, ``int64``).
            - ``'unsigned integer'``: unsigned integer data types (i.e.,
              ``uint8``, ``uint16``, ``uint32``, ``uint64``).
            - ``'integral'``: integer data types. Shorthand for ``('signed
              integer', 'unsigned integer')``.
            - ``'real floating'``: real-valued floating-point data types
              (i.e., ``float32``, ``float64``).
            - ``'complex floating'``: complex floating-point data types (i.e.,
              ``complex64``, ``complex128``).
            - ``'numeric'``: numeric data types. Shorthand for ``('integral',
              'real floating', 'complex floating')``.

        Returns
        -------
        dtypes : dict
            A dictionary mapping the names of data types to the corresponding
            PyTorch data types.

        See Also
        --------
        __array_namespace_info__.capabilities,
        __array_namespace_info__.default_device,
        __array_namespace_info__.default_dtypes,
        __array_namespace_info__.devices

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.dtypes(kind='signed integer')
        {'int8': numpy.int8,
         'int16': numpy.int16,
         'int32': numpy.int32,
         'int64': numpy.int64}

        """
        res = self._dtypes(kind)
        for k, v in res.copy().items():
            try:
                torch.empty((0,), dtype=v, device=device)
            except:
                del res[k]
        return res

    @cache
    def devices(self):
        """
        The devices supported by PyTorch.

        Returns
        -------
        devices : list[Device]
            The devices supported by PyTorch.

        See Also
        --------
        __array_namespace_info__.capabilities,
        __array_namespace_info__.default_device,
        __array_namespace_info__.default_dtypes,
        __array_namespace_info__.dtypes

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.devices()
        [device(type='cpu'), device(type='mps', index=0), device(type='meta')]

        """
        # Torch doesn't have a straightforward way to get the list of all
        # currently supported devices. To do this, we first parse the error
        # message of torch.device to get the list of all possible types of
        # device:
        try:
            torch.device('notadevice')
            raise AssertionError("unreachable")  # pragma: nocover
        except RuntimeError as e:
            # The error message is something like:
            # "Expected one of cpu, cuda, ipu, xpu, mkldnn, opengl, opencl, ideep, hip, ve, fpga, ort, xla, lazy, vulkan, mps, meta, hpu, mtia, privateuseone device type at start of device string: notadevice"
            devices_names = e.args[0].split('Expected one of ')[1].split(' device type')[0].split(', ')

        # Next we need to check for different indices for different devices.
        # device(device_name, index=index) doesn't actually check if the
        # device name or index is valid. We have to try to create a tensor
        # with it (which is why this function is cached).
        devices = []
        for device_name in devices_names:
            i = 0
            while True:
                try:
                    a = torch.empty((0,), device=torch.device(device_name, index=i))
                    if a.device in devices:
                        break
                    devices.append(a.device)
                except:
                    break
                i += 1

        return devices
