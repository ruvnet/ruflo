import decimal
from typing import Any, List, Tuple, Union

from .._utils import deprecation_no_replacement, deprecation_with_replacement
from ._base import FloatObject, NumberObject
from ._data_structures import ArrayObject


class RectangleObject(ArrayObject):
    """
    This class is used to represent *page boxes* in PyPDF2. These boxes include:
        * :attr:`artbox <PyPDF2._page.PageObject.artbox>`
        * :attr:`bleedbox <PyPDF2._page.PageObject.bleedbox>`
        * :attr:`cropbox <PyPDF2._page.PageObject.cropbox>`
        * :attr:`mediabox <PyPDF2._page.PageObject.mediabox>`
        * :attr:`trimbox <PyPDF2._page.PageObject.trimbox>`
    """

    def __init__(
        self, arr: Union["RectangleObject", Tuple[float, float, float, float]]
    ) -> None:
        # must have four points
        assert len(arr) == 4
        # automatically convert arr[x] into NumberObject(arr[x]) if necessary
        ArrayObject.__init__(self, [self._ensure_is_number(x) for x in arr])  # type: ignore

    def _ensure_is_number(self, value: Any) -> Union[FloatObject, NumberObject]:
        if not isinstance(value, (NumberObject, FloatObject)):
            value = FloatObject(value)
        return value

    def scale(self, sx: float, sy: float) -> "RectangleObject":
        return RectangleObject(
            (
                float(self.left) * sx,
                float(self.bottom) * sy,
                float(self.right) * sx,
                float(self.top) * sy,
            )
        )

    def ensureIsNumber(
        self, value: Any
    ) -> Union[FloatObject, NumberObject]:  # pragma: no cover
        deprecation_no_replacement("ensureIsNumber", "3.0.0")
        return self._ensure_is_number(value)

    def __repr__(self) -> str:
        return f"RectangleObject({repr(list(self))})"

    @property
    def left(self) -> FloatObject:
        return self[0]

    @left.setter
    def left(self, f: float) -> None:
        self[0] = FloatObject(f)

    @property
    def bottom(self) -> FloatObject:
        return self[1]

    @bottom.setter
    def bottom(self, f: float) -> None:
        self[1] = FloatObject(f)

    @property
    def right(self) -> FloatObject:
        return self[2]

    @right.setter
    def right(self, f: float) -> None:
        self[2] = FloatObject(f)

    @property
    def top(self) -> FloatObject:
        return self[3]

    @top.setter
    def top(self, f: float) -> None:
        self[3] = FloatObject(f)

    def getLowerLeft_x(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getLowerLeft_x", "left", "3.0.0")
        return self.left

    def getLowerLeft_y(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getLowerLeft_y", "bottom", "3.0.0")
        return self.bottom

    def getUpperRight_x(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getUpperRight_x", "right", "3.0.0")
        return self.right

    def getUpperRight_y(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getUpperRight_y", "top", "3.0.0")
        return self.top

    def getUpperLeft_x(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getUpperLeft_x", "left", "3.0.0")
        return self.left

    def getUpperLeft_y(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getUpperLeft_y", "top", "3.0.0")
        return self.top

    def getLowerRight_x(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getLowerRight_x", "right", "3.0.0")
        return self.right

    def getLowerRight_y(self) -> FloatObject:  # pragma: no cover
        deprecation_with_replacement("getLowerRight_y", "bottom", "3.0.0")
        return self.bottom

    @property
    def lower_left(self) -> Tuple[decimal.Decimal, decimal.Decimal]:
        """
        Property to read and modify the lower left coordinate of this box
        in (x,y) form.
        """
        return self.left, self.bottom

    @lower_left.setter
    def lower_left(self, value: List[Any]) -> None:
        self[0], self[1] = (self._ensure_is_number(x) for x in value)

    @property
    def lower_right(self) -> Tuple[decimal.Decimal, decimal.Decimal]:
        """
        Property to read and modify the lower right coordinate of this box
        in (x,y) form.
        """
        return self.right, self.bottom

    @lower_right.setter
    def lower_right(self, value: List[Any]) -> None:
        self[2], self[1] = (self._ensure_is_number(x) for x in value)

    @property
    def upper_left(self) -> Tuple[decimal.Decimal, decimal.Decimal]:
        """
        Property to read and modify the upper left coordinate of this box
        in (x,y) form.
        """
        return self.left, self.top

    @upper_left.setter
    def upper_left(self, value: List[Any]) -> None:
        self[0], self[3] = (self._ensure_is_number(x) for x in value)

    @property
    def upper_right(self) -> Tuple[decimal.Decimal, decimal.Decimal]:
        """
        Property to read and modify the upper right coordinate of this box
        in (x,y) form.
        """
        return self.right, self.top

    @upper_right.setter
    def upper_right(self, value: List[Any]) -> None:
        self[2], self[3] = (self._ensure_is_number(x) for x in value)

    def getLowerLeft(
        self,
    ) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("getLowerLeft", "lower_left", "3.0.0")
        return self.lower_left

    def getLowerRight(
        self,
    ) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("getLowerRight", "lower_right", "3.0.0")
        return self.lower_right

    def getUpperLeft(
        self,
    ) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("getUpperLeft", "upper_left", "3.0.0")
        return self.upper_left

    def getUpperRight(
        self,
    ) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("getUpperRight", "upper_right", "3.0.0")
        return self.upper_right

    def setLowerLeft(self, value: Tuple[float, float]) -> None:  # pragma: no cover
        deprecation_with_replacement("setLowerLeft", "lower_left", "3.0.0")
        self.lower_left = value  # type: ignore

    def setLowerRight(self, value: Tuple[float, float]) -> None:  # pragma: no cover
        deprecation_with_replacement("setLowerRight", "lower_right", "3.0.0")
        self[2], self[1] = (self._ensure_is_number(x) for x in value)

    def setUpperLeft(self, value: Tuple[float, float]) -> None:  # pragma: no cover
        deprecation_with_replacement("setUpperLeft", "upper_left", "3.0.0")
        self[0], self[3] = (self._ensure_is_number(x) for x in value)

    def setUpperRight(self, value: Tuple[float, float]) -> None:  # pragma: no cover
        deprecation_with_replacement("setUpperRight", "upper_right", "3.0.0")
        self[2], self[3] = (self._ensure_is_number(x) for x in value)

    @property
    def width(self) -> decimal.Decimal:
        return self.right - self.left

    def getWidth(self) -> decimal.Decimal:  # pragma: no cover
        deprecation_with_replacement("getWidth", "width", "3.0.0")
        return self.width

    @property
    def height(self) -> decimal.Decimal:
        return self.top - self.bottom

    def getHeight(self) -> decimal.Decimal:  # pragma: no cover
        deprecation_with_replacement("getHeight", "height", "3.0.0")
        return self.height

    @property
    def lowerLeft(self) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("lowerLeft", "lower_left", "3.0.0")
        return self.lower_left

    @lowerLeft.setter
    def lowerLeft(
        self, value: Tuple[decimal.Decimal, decimal.Decimal]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("lowerLeft", "lower_left", "3.0.0")
        self.lower_left = value

    @property
    def lowerRight(self) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("lowerRight", "lower_right", "3.0.0")
        return self.lower_right

    @lowerRight.setter
    def lowerRight(
        self, value: Tuple[decimal.Decimal, decimal.Decimal]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("lowerRight", "lower_right", "3.0.0")
        self.lower_right = value

    @property
    def upperLeft(self) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("upperLeft", "upper_left", "3.0.0")
        return self.upper_left

    @upperLeft.setter
    def upperLeft(
        self, value: Tuple[decimal.Decimal, decimal.Decimal]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("upperLeft", "upper_left", "3.0.0")
        self.upper_left = value

    @property
    def upperRight(self) -> Tuple[decimal.Decimal, decimal.Decimal]:  # pragma: no cover
        deprecation_with_replacement("upperRight", "upper_right", "3.0.0")
        return self.upper_right

    @upperRight.setter
    def upperRight(
        self, value: Tuple[decimal.Decimal, decimal.Decimal]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("upperRight", "upper_right", "3.0.0")
        self.upper_right = value
