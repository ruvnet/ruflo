# Copyright 2019 The Kubernetes Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
from decimal import Decimal, InvalidOperation

_EXPONENTS = {
    "n": -3,
    "u": -2,
    "m": -1,
    "K": 1,
    "k": 1,
    "M": 2,
    "G": 3,
    "T": 4,
    "P": 5,
    "E": 6,
}


def parse_quantity(quantity):
    """
    Parse kubernetes canonical form quantity like 200Mi to a decimal number.
    Supported SI suffixes:
    base1024: Ki | Mi | Gi | Ti | Pi | Ei
    base1000: n | u | m | "" | k | M | G | T | P | E

    See https://github.com/kubernetes/apimachinery/blob/master/pkg/api/resource/quantity.go

    Input:
    quantity: string. kubernetes canonical form quantity

    Returns:
    Decimal

    Raises:
    ValueError on invalid or unknown input
    """
    if isinstance(quantity, (int, float, Decimal)):
        return Decimal(quantity)

    quantity = str(quantity)
    number = quantity
    suffix = None
    if len(quantity) >= 2 and quantity[-1] == "i":
        if quantity[-2] in _EXPONENTS:
            number = quantity[:-2]
            suffix = quantity[-2:]
    elif len(quantity) >= 1 and quantity[-1] in _EXPONENTS:
        number = quantity[:-1]
        suffix = quantity[-1:]

    try:
        number = Decimal(number)
    except InvalidOperation:
        raise ValueError("Invalid number format: {}".format(number))

    if suffix is None:
        return number

    if suffix.endswith("i"):
        base = 1024
    elif len(suffix) == 1:
        base = 1000
    else:
        raise ValueError("{} has unknown suffix".format(quantity))

    # handle SI inconsistency
    if suffix == "ki":
        raise ValueError("{} has unknown suffix".format(quantity))

    if suffix[0] not in _EXPONENTS:
        raise ValueError("{} has unknown suffix".format(quantity))

    exponent = Decimal(_EXPONENTS[suffix[0]])
    return number * (base ** exponent)


def format_quantity(quantity_value, suffix, quantize=None) -> str:
    """
    Takes a decimal and produces a string value in kubernetes' canonical quantity form,
    like "200Mi".Users can specify an additional decimal number to quantize the output.

    Example -  Relatively increase pod memory limits:

    # retrieve my_pod
    current_memory: Decimal = parse_quantity(my_pod.spec.containers[0].resources.limits.memory)
    desired_memory = current_memory * 1.2
    desired_memory_str = format_quantity(desired_memory, suffix="Gi", quantize=Decimal(1))
    # patch pod with desired_memory_str

    'quantize=Decimal(1)' ensures that the result does not contain any fractional digits.

    Supported SI suffixes:
    base1024: Ki | Mi | Gi | Ti | Pi | Ei
    base1000: n | u | m | "" | k | M | G | T | P | E

    See https://github.com/kubernetes/apimachinery/blob/master/pkg/api/resource/quantity.go

    Input:
    quantity: Decimal.  Quantity as a number which is supposed to converted to a string
                        with SI suffix.
    suffix: string.     The desired suffix/unit-of-measure of the output string
    quantize: Decimal.  Can be used to round/quantize the value before the string
                        is returned. Defaults to None.

    Returns:
    string. Canonical Kubernetes quantity string containing the SI suffix.

    Raises:
    ValueError if the SI suffix is not supported.
    """

    if not suffix:
        return str(quantity_value)

    if suffix.endswith("i"):
        base = 1024
    elif len(suffix) == 1:
        base = 1000
    else:
        raise ValueError(f"{quantity_value} has unknown suffix")

    if suffix == "ki":
        raise ValueError(f"{quantity_value} has unknown suffix")

    if suffix[0] not in _EXPONENTS:
        raise ValueError(f"{quantity_value} has unknown suffix")

    different_scale = quantity_value / Decimal(base ** _EXPONENTS[suffix[0]])
    if quantize:
        different_scale = different_scale.quantize(quantize)
    return str(different_scale) + suffix
