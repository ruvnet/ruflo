"""
Array API Inspection namespace

This is the namespace for inspection functions as defined by the array API
standard. See
https://data-apis.org/array-api/latest/API_specification/inspection.html for
more details.

"""

# pyright: reportPrivateUsage=false

from __future__ import annotations

from typing import Literal as L
from typing import TypeAlias, overload

from numpy import bool_ as bool
from numpy import (
    complex64,
    complex128,
    dtype,
    float32,
    float64,
    int8,
    int16,
    int32,
    int64,
    intp,
    uint8,
    uint16,
    uint32,
    uint64,
)

from ...common._helpers import _DASK_DEVICE, _dask_device
from ...common._typing import (
    Capabilities,
    DefaultDTypes,
    DType,
    DTypeKind,
    DTypesAll,
    DTypesAny,
    DTypesBool,
    DTypesComplex,
    DTypesIntegral,
    DTypesNumeric,
    DTypesReal,
    DTypesSigned,
    DTypesUnsigned,
)

_Device: TypeAlias = L["cpu"] | _dask_device


class __array_namespace_info__:
    """
    Get the array API inspection namespace for Dask.

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
        The array API inspection namespace for Dask.

    Examples
    --------
    >>> info = xp.__array_namespace_info__()
    >>> info.default_dtypes()
    {'real floating': dask.float64,
     'complex floating': dask.complex128,
     'integral': dask.int64,
     'indexing': dask.int64}

    """

    __module__ = "dask.array"

    def capabilities(self) -> Capabilities:
        """
        Return a dictionary of array API library capabilities.

        The resulting dictionary has the following keys:

        - **"boolean indexing"**: boolean indicating whether an array library
          supports boolean indexing.

          Dask support boolean indexing as long as both the index
          and the indexed arrays have known shapes.
          Note however that the output .shape and .size properties
          will contain a non-compliant math.nan instead of None.

        - **"data-dependent shapes"**: boolean indicating whether an array
          library supports data-dependent output shapes.

          Dask implements unique_values et.al.
          Note however that the output .shape and .size properties
          will contain a non-compliant math.nan instead of None.

        - **"max dimensions"**: integer indicating the maximum number of
          dimensions supported by the array library.

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

    def default_device(self) -> L["cpu"]:
        """
        The default device used for new Dask arrays.

        For Dask, this always returns ``'cpu'``.

        See Also
        --------
        __array_namespace_info__.capabilities,
        __array_namespace_info__.default_dtypes,
        __array_namespace_info__.dtypes,
        __array_namespace_info__.devices

        Returns
        -------
        device : Device
            The default device used for new Dask arrays.

        Examples
        --------
        >>> info = xp.__array_namespace_info__()
        >>> info.default_device()
        'cpu'

        """
        return "cpu"

    def default_dtypes(self, /, *, device: _Device | None = None) -> DefaultDTypes:
        """
        The default data types used for new Dask arrays.

        For Dask, this always returns the following dictionary:

        - **"real floating"**: ``numpy.float64``
        - **"complex floating"**: ``numpy.complex128``
        - **"integral"**: ``numpy.intp``
        - **"indexing"**: ``numpy.intp``

        Parameters
        ----------
        device : str, optional
            The device to get the default data types for.

        Returns
        -------
        dtypes : dict
            A dictionary describing the default data types used for new Dask
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
        {'real floating': dask.float64,
         'complex floating': dask.complex128,
         'integral': dask.int64,
         'indexing': dask.int64}

        """
        if device not in ["cpu", _DASK_DEVICE, None]:
            raise ValueError(
                f'Device not understood. Only "cpu" or _DASK_DEVICE is allowed, '
                f"but received: {device!r}"
            )
        return {
            "real floating": dtype(float64),
            "complex floating": dtype(complex128),
            "integral": dtype(intp),
            "indexing": dtype(intp),
        }

    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: None = None
    ) -> DTypesAll: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["bool"]
    ) -> DTypesBool: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["signed integer"]
    ) -> DTypesSigned: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["unsigned integer"]
    ) -> DTypesUnsigned: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["integral"]
    ) -> DTypesIntegral: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["real floating"]
    ) -> DTypesReal: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["complex floating"]
    ) -> DTypesComplex: ...
    @overload
    def dtypes(
        self, /, *, device: _Device | None = None, kind: L["numeric"]
    ) -> DTypesNumeric: ...
    def dtypes(
        self, /, *, device: _Device | None = None, kind: DTypeKind | None = None
    ) -> DTypesAny:
        """
        The array API data types supported by Dask.

        Note that this function only returns data types that are defined by
        the array API.

        Parameters
        ----------
        device : str, optional
            The device to get the data types for.
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
            Dask data types.

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
        {'int8': dask.int8,
         'int16': dask.int16,
         'int32': dask.int32,
         'int64': dask.int64}

        """
        if device not in ["cpu", _DASK_DEVICE, None]:
            raise ValueError(
                'Device not understood. Only "cpu" or _DASK_DEVICE is allowed, but received:'
                f" {device}"
            )
        if kind is None:
            return {
                "bool": dtype(bool),
                "int8": dtype(int8),
                "int16": dtype(int16),
                "int32": dtype(int32),
                "int64": dtype(int64),
                "uint8": dtype(uint8),
                "uint16": dtype(uint16),
                "uint32": dtype(uint32),
                "uint64": dtype(uint64),
                "float32": dtype(float32),
                "float64": dtype(float64),
                "complex64": dtype(complex64),
                "complex128": dtype(complex128),
            }
        if kind == "bool":
            return {"bool": bool}
        if kind == "signed integer":
            return {
                "int8": dtype(int8),
                "int16": dtype(int16),
                "int32": dtype(int32),
                "int64": dtype(int64),
            }
        if kind == "unsigned integer":
            return {
                "uint8": dtype(uint8),
                "uint16": dtype(uint16),
                "uint32": dtype(uint32),
                "uint64": dtype(uint64),
            }
        if kind == "integral":
            return {
                "int8": dtype(int8),
                "int16": dtype(int16),
                "int32": dtype(int32),
                "int64": dtype(int64),
                "uint8": dtype(uint8),
                "uint16": dtype(uint16),
                "uint32": dtype(uint32),
                "uint64": dtype(uint64),
            }
        if kind == "real floating":
            return {
                "float32": dtype(float32),
                "float64": dtype(float64),
            }
        if kind == "complex floating":
            return {
                "complex64": dtype(complex64),
                "complex128": dtype(complex128),
            }
        if kind == "numeric":
            return {
                "int8": dtype(int8),
                "int16": dtype(int16),
                "int32": dtype(int32),
                "int64": dtype(int64),
                "uint8": dtype(uint8),
                "uint16": dtype(uint16),
                "uint32": dtype(uint32),
                "uint64": dtype(uint64),
                "float32": dtype(float32),
                "float64": dtype(float64),
                "complex64": dtype(complex64),
                "complex128": dtype(complex128),
            }
        if isinstance(kind, tuple):  # type: ignore[reportUnnecessaryIsinstanceCall]
            res: dict[str, DType] = {}
            for k in kind:
                res.update(self.dtypes(kind=k))
            return res
        raise ValueError(f"unsupported kind: {kind!r}")

    def devices(self) -> list[_Device]:
        """
        The devices supported by Dask.

        For Dask, this always returns ``['cpu', DASK_DEVICE]``.

        Returns
        -------
        devices : list[Device]
            The devices supported by Dask.

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
        ['cpu', DASK_DEVICE]

        """
        return ["cpu", _DASK_DEVICE]
