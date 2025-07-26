# IEEE 754 Explained

IEEE 754 is a standard that defines a way to represent certain mathematical
objects using binary numbers.

## Binary Number Fields

The binary numbers used in IEEE 754 can have different lengths, the length that
is interesting for the purposes of this project is 64 bits. These binary
numbers are made up of 3 contiguous fields of bits, from left to right:

1. 1 sign bit
2. 11 exponent bits
3. 52 mantissa bits

Depending on the values these fields have, the represented mathematical object
can be one of:

* Floating point number
* Zero
* NaN
* Infinite

## Floating Point Numbers

IEEE 754 represents a floating point number $f$ using an exponential
notation with 4 components: $sign$, $mantissa$, $base$ and $exponent$:

$$f = sign \times mantissa \times base ^ {exponent}$$

There are two possible representations of floating point numbers:
_normal_ and _denormal_, which have different valid values for
their $mantissa$ and $exponent$ fields.

### Binary Representation

$sign$, $mantissa$, and $exponent$ are represented in binary, the
representation of each component has certain details explained next.

$base$ is always $2$ and it is not represented in binary.

#### Sign

$sign$ can have 2 values:

1. $1$ if the `sign` bit is `0`
2. $-1$ if the `sign` bit is `1`.

#### Mantissa

##### Normal Floating Point Numbers

$mantissa$ is a positive fractional number whose integer part is $1$, for example
$1.2345 \dots$. The `mantissa` bits represent only the fractional part and the
$mantissa$ value can be calculated as:

$$mantissa = 1 + \sum_{i=1}^{52} b_{i} \times 2^{-i} = 1 + \frac{b_{1}}{2^{1}} + \frac{b_{2}}{2^{2}} + \dots + \frac{b_{51}}{2^{51}} + \frac{b_{52}}{2^{52}}$$

Where $b_{i}$ is:

1. $0$ if the bit at the position `i - 1` is `0`.
2. $1$ if the bit at the position `i - 1` is `1`.

##### Denormal Floating Point Numbers

$mantissa$ is a positive fractional number whose integer part is $0$, for example
$0.12345 \dots$. The `mantissa` bits represent only the fractional part and the
$mantissa$ value can be calculated as:

$$mantissa = \sum_{i=1}^{52} b_{i} \times 2^{-i} = \frac{b_{1}}{2^{1}} + \frac{b_{2}}{2^{2}} + \dots + \frac{b_{51}}{2^{51}} + \frac{b_{52}}{2^{52}}$$

Where $b_{i}$ is:

1. $0$ if the bit at the position `i - 1` is `0`.
2. $1$ if the bit at the position `i - 1` is `1`.

#### Exponent

##### Normal Floating Point Numbers

Only the following bit sequences are allowed: `00000000001` to `11111111110`.
That is, there must be at least one `0` and one `1` in the exponent bits.

The actual value of the $exponent$ can be calculated as:

$$exponent = v - bias$$

where $v$ is the value of the binary number in the exponent bits and $bias$ is $1023$.
Considering the restrictions above, the respective minimum and maximum values for the
exponent are:

1. `00000000001` = $1$, $1 - 1023 = -1022$
2. `11111111110` = $2046$, $2046 - 1023 = 1023$

So, $exponent$ is an integer in the range $\left[-1022, 1023\right]$.


##### Denormal Floating Point Numbers

$exponent$ is always $-1022$. Nevertheless, it is always represented as `00000000000`.

### Normal and Denormal Floating Point Numbers

The smallest absolute value a normal floating point number can have is calculated
like this:

$$1 \times 1.0\dots0 \times 2^{-1022} = 2.2250738585072014 \times 10^{-308}$$

Since normal floating point numbers always have a $1$ as the integer part of the
$mantissa$, then smaller values can be achieved by using the smallest possible exponent
( $-1022$ ) and a $0$ in the integer part of the $mantissa$, but significant digits are lost.

The smallest absolute value a denormal floating point number can have is calculated
like this:

$$1 \times 2^{-52} \times 2^{-1022} = 5 \times 10^{-324}$$

## Zero

Zero is represented like this:

* Sign bit: `X`
* Exponent bits: `00000000000`
* Mantissa bits: `0000000000000000000000000000000000000000000000000000`

where `X` means `0` or `1`.

## NaN

There are 2 kinds of NaNs that are represented:

1. QNaNs (Quiet NaNs): represent the result of indeterminate operations.
2. SNaNs (Signalling NaNs): represent the result of invalid operations.

### QNaNs

QNaNs are represented like this:

* Sign bit: `X`
* Exponent bits: `11111111111`
* Mantissa bits: `1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

where `X` means `0` or `1`.

### SNaNs

SNaNs are represented like this:

* Sign bit: `X`
* Exponent bits: `11111111111`
* Mantissa bits: `0XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1`

where `X` means `0` or `1`.

## Infinite

### Positive Infinite

Positive infinite is represented like this:

* Sign bit: `0`
* Exponent bits: `11111111111`
* Mantissa bits: `0000000000000000000000000000000000000000000000000000`

where `X` means `0` or `1`.

### Negative Infinite

Negative infinite is represented like this:

* Sign bit: `1`
* Exponent bits: `11111111111`
* Mantissa bits: `0000000000000000000000000000000000000000000000000000`

where `X` means `0` or `1`.
