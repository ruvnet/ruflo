"""This script evaluates scipy's implementation of hyp2f1 against mpmath's.

Author: Albert Steppi

This script is long running and generates a large output file. With default
arguments, the generated file is roughly 700MB in size and it takes around
40 minutes using an Intel(R) Core(TM) i5-8250U CPU with n_jobs set to 8
(full utilization). There are optional arguments which can be used to restrict
(or enlarge) the computations performed. These are described below.
The output of this script can be analyzed to identify suitable test cases and
to find parameter and argument regions where hyp2f1 needs to be improved.

The script has one mandatory positional argument for specifying the path to
the location where the output file is to be placed, and 4 optional arguments
--n_jobs, --grid_size, --regions, and --parameter_groups. --n_jobs specifies
the number of processes to use if running in parallel. The default value is 1.
The other optional arguments are explained below.

Produces a tab separated values file with 11 columns. The first four columns
contain the parameters a, b, c and the argument z. The next two contain |z| and
a region code for which region of the complex plane belongs to. The regions are

    0) z == 1
    1) |z| < 0.9 and real(z) >= 0
    2) |z| <= 1 and real(z) < 0
    3) 0.9 <= |z| <= 1 and |1 - z| < 0.9:
    4) 0.9 <= |z| <= 1 and |1 - z| >= 0.9 and real(z) >= 0:
    5) 1 < |z| < 1.1 and |1 - z| >= 0.9 and real(z) >= 0
    6) |z| > 1 and not in 5)

The --regions optional argument allows the user to specify a list of regions
to which computation will be restricted.

Parameters a, b, c are taken from a 10 * 10 * 10 grid with values at

    -16, -8, -4, -2, -1, 1, 2, 4, 8, 16

with random perturbations applied.

There are 9 parameter groups handling the following cases.

    1) A, B, C, B - A, C - A, C - B, C - A - B all non-integral.
    2) B - A integral
    3) C - A integral
    4) C - B integral
    5) C - A - B integral
    6) A integral
    7) B integral
    8) C integral
    9) Wider range with c - a - b > 0.

The seventh column of the output file is an integer between 1 and 8 specifying
the parameter group as above.

The --parameter_groups optional argument allows the user to specify a list of
parameter groups to which computation will be restricted.

The argument z is taken from a grid in the box
    -box_size <= real(z) <= box_size, -box_size <= imag(z) <= box_size.
with grid size specified using the optional command line argument --grid_size,
and box_size specified with the command line argument --box_size.
The default value of grid_size is 20 and the default value of box_size is 2.0,
yielding a 20 * 20 grid in the box with corners -2-2j, -2+2j, 2-2j, 2+2j.

The final four columns have the expected value of hyp2f1 for the given
parameters and argument as calculated with mpmath, the observed value
calculated with scipy's hyp2f1, the relative error, and the absolute error.

As special cases of hyp2f1 are moved from the original Fortran implementation
into Cython, this script can be used to ensure that no regressions occur and
to point out where improvements are needed.
"""


import os
import csv
import argparse
import numpy as np
from itertools import product
from multiprocessing import Pool


from scipy.special import hyp2f1
from scipy.special.tests.test_hyp2f1 import mp_hyp2f1


def get_region(z):
    """Assign numbers for regions where hyp2f1 must be handled differently."""
    if z == 1 + 0j:
        return 0
    elif abs(z) < 0.9 and z.real >= 0:
        return 1
    elif abs(z) <= 1 and z.real < 0:
        return 2
    elif 0.9 <= abs(z) <= 1 and abs(1 - z) < 0.9:
        return 3
    elif 0.9 <= abs(z) <= 1 and abs(1 - z) >= 0.9:
        return 4
    elif 1 < abs(z) < 1.1 and abs(1 - z) >= 0.9 and z.real >= 0:
        return 5
    else:
        return 6


def get_result(a, b, c, z, group):
    """Get results for given parameter and value combination."""
    expected, observed = mp_hyp2f1(a, b, c, z), hyp2f1(a, b, c, z)
    if (
            np.isnan(observed) and np.isnan(expected) or
            expected == observed
    ):
        relative_error = 0.0
        absolute_error = 0.0
    elif np.isnan(observed):
        # Set error to infinity if result is nan when not expected to be.
        # Makes results easier to interpret.
        relative_error = float("inf")
        absolute_error = float("inf")
    else:
        absolute_error = abs(expected - observed)
        relative_error = absolute_error / abs(expected)

    return (
        a,
        b,
        c,
        z,
        abs(z),
        get_region(z),
        group,
        expected,
        observed,
        relative_error,
        absolute_error,
    )


def get_result_no_mp(a, b, c, z, group):
    """Get results for given parameter and value combination."""
    expected, observed = complex('nan'), hyp2f1(a, b, c, z)
    relative_error, absolute_error = float('nan'), float('nan')
    return (
        a,
        b,
        c,
        z,
        abs(z),
        get_region(z),
        group,
        expected,
        observed,
        relative_error,
        absolute_error,
    )


def get_results(params, Z, n_jobs=1, compute_mp=True):
    """Batch compute results for multiple parameter and argument values.

    Parameters
    ----------
    params : iterable
        iterable of tuples of floats (a, b, c) specifying parameter values
        a, b, c for hyp2f1
    Z : iterable of complex
        Arguments at which to evaluate hyp2f1
    n_jobs : Optional[int]
        Number of jobs for parallel execution.

    Returns
    -------
    list
        List of tuples of results values. See return value in source code
        of `get_result`.
    """
    input_ = (
        (a, b, c, z, group) for (a, b, c, group), z in product(params, Z)
    )

    with Pool(n_jobs) as pool:
        rows = pool.starmap(
            get_result if compute_mp else get_result_no_mp,
            input_
        )
    return rows


def _make_hyp2f1_test_case(a, b, c, z, rtol):
    """Generate string for single test case as used in test_hyp2f1.py."""
    expected = mp_hyp2f1(a, b, c, z)
    return (
        "    pytest.param(\n"
        "        Hyp2f1TestCase(\n"
        f"            a={a},\n"
        f"            b={b},\n"
        f"            c={c},\n"
        f"            z={z},\n"
        f"            expected={expected},\n"
        f"            rtol={rtol},\n"
        "        ),\n"
        "    ),"
    )


def make_hyp2f1_test_cases(rows):
    """Generate string for a list of test cases for test_hyp2f1.py.

    Parameters
    ----------
    rows : list
        List of lists of the form [a, b, c, z, rtol] where a, b, c, z are
        parameters and the argument for hyp2f1 and rtol is an expected
        relative error for the associated test case.

    Returns
    -------
    str
        String for a list of test cases. The output string can be printed
        or saved to a file and then copied into an argument for
        `pytest.mark.parameterize` within `scipy.special.tests.test_hyp2f1.py`.
    """
    result = "[\n"
    result += '\n'.join(
        _make_hyp2f1_test_case(a, b, c, z, rtol)
        for a, b, c, z, rtol in rows
    )
    result += "\n]"
    return result


def main(
        outpath,
        n_jobs=1,
        box_size=2.0,
        grid_size=20,
        regions=None,
        parameter_groups=None,
        compute_mp=True,
):
    outpath = os.path.realpath(os.path.expanduser(outpath))

    random_state = np.random.RandomState(1234)
    # Parameters a, b, c selected near these values.
    root_params = np.array(
        [-16, -8, -4, -2, -1, 1, 2, 4, 8, 16]
    )
    # Perturbations to apply to root values.
    perturbations = 0.1 * random_state.random_sample(
        size=(3, len(root_params))
    )

    params = []
    # Parameter group 1
    # -----------------
    # No integer differences. This has been confirmed for the above seed.
    A = root_params + perturbations[0, :]
    B = root_params + perturbations[1, :]
    C = root_params + perturbations[2, :]
    params.extend(
        sorted(
            ((a, b, c, 1) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 2
    # -----------------
    # B - A an integer
    A = root_params + 0.5
    B = root_params + 0.5
    C = root_params + perturbations[1, :]
    params.extend(
        sorted(
            ((a, b, c, 2) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 3
    # -----------------
    # C - A an integer
    A = root_params + 0.5
    B = root_params + perturbations[1, :]
    C = root_params + 0.5
    params.extend(
        sorted(
            ((a, b, c, 3) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 4
    # -----------------
    # C - B an integer
    A = root_params + perturbations[0, :]
    B = root_params + 0.5
    C = root_params + 0.5
    params.extend(
        sorted(
            ((a, b, c, 4) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 5
    # -----------------
    # C - A - B an integer
    A = root_params + 0.25
    B = root_params + 0.25
    C = root_params + 0.5
    params.extend(
        sorted(
            ((a, b, c, 5) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 6
    # -----------------
    # A an integer
    A = root_params
    B = root_params + perturbations[0, :]
    C = root_params + perturbations[1, :]
    params.extend(
        sorted(
            ((a, b, c, 6) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 7
    # -----------------
    # B an integer
    A = root_params + perturbations[0, :]
    B = root_params
    C = root_params + perturbations[1, :]
    params.extend(
        sorted(
            ((a, b, c, 7) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 8
    # -----------------
    # C an integer
    A = root_params + perturbations[0, :]
    B = root_params + perturbations[1, :]
    C = root_params
    params.extend(
        sorted(
            ((a, b, c, 8) for a, b, c in product(A, B, C)),
            key=lambda x: max(abs(x[0]), abs(x[1])),
        )
    )

    # Parameter group 9
    # -----------------
    # Wide range of magnitudes, c - a - b > 0.
    phi = (1 + np.sqrt(5))/2
    P = phi**np.arange(16)
    P = np.hstack([-P, P])
    group_9_params = sorted(
        (
            (a, b, c, 9) for a, b, c in product(P, P, P) if c - a - b > 0
        ),
        key=lambda x: max(abs(x[0]), abs(x[1])),
    )

    if parameter_groups is not None:
        # Group 9 params only used if specified in arguments.
        params.extend(group_9_params)
        params = [
            (a, b, c, group) for a, b, c, group in params
            if group in parameter_groups
        ]

    # grid_size * grid_size grid in box with corners
    # -2 - 2j, -2 + 2j, 2 - 2j, 2 + 2j
    X, Y = np.meshgrid(
        np.linspace(-box_size, box_size, grid_size),
        np.linspace(-box_size, box_size, grid_size)
    )
    Z = X + Y * 1j
    Z = Z.flatten().tolist()
    # Add z = 1 + 0j (region 0).
    Z.append(1 + 0j)
    if regions is not None:
        Z = [z for z in Z if get_region(z) in regions]

    # Evaluate scipy and mpmath's hyp2f1 for all parameter combinations
    # above against all arguments in the grid Z
    rows = get_results(params, Z, n_jobs=n_jobs, compute_mp=compute_mp)

    with open(outpath, "w", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(
            [
                "a",
                "b",
                "c",
                "z",
                "|z|",
                "region",
                "parameter_group",
                "expected",  # mpmath's hyp2f1
                "observed",  # scipy's hyp2f1
                "relative_error",
                "absolute_error",
            ]
        )
        for row in rows:
            writer.writerow(row)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test scipy's hyp2f1 against mpmath's on a grid in the"
        " complex plane over a grid of parameter values. Saves output to file"
        " specified in positional argument \"outpath\"."
        " Caution: With default arguments, the generated output file is"
        " roughly 700MB in size. Script may take several hours to finish if"
        " \"--n_jobs\" is set to 1."
    )
    parser.add_argument(
        "outpath", type=str, help="Path to output tsv file."
    )
    parser.add_argument(
        "--n_jobs",
        type=int,
        default=1,
        help="Number of jobs for multiprocessing.",
    )
    parser.add_argument(
        "--box_size",
        type=float,
        default=2.0,
        help="hyp2f1 is evaluated in box of side_length 2*box_size centered"
        " at the origin."
    )
    parser.add_argument(
        "--grid_size",
        type=int,
        default=20,
        help="hyp2f1 is evaluated on grid_size * grid_size grid in box of side"
        " length 2*box_size centered at the origin."
    )
    parser.add_argument(
        "--parameter_groups",
        type=int,
        nargs='+',
        default=None,
        help="Restrict to supplied parameter groups. See the Docstring for"
        " this module for more info on parameter groups. Calculate for all"
        " parameter groups by default."
    )
    parser.add_argument(
        "--regions",
        type=int,
        nargs='+',
        default=None,
        help="Restrict to argument z only within the supplied regions. See"
        " the Docstring for this module for more info on regions. Calculate"
        " for all regions by default."
    )
    parser.add_argument(
        "--no_mp",
        action='store_true',
        help="If this flag is set, do not compute results with mpmath. Saves"
        " time if results have already been computed elsewhere. Fills in"
        " \"expected\" column with None values."
    )
    args = parser.parse_args()
    compute_mp = not args.no_mp
    print(args.parameter_groups)
    main(
        args.outpath,
        n_jobs=args.n_jobs,
        box_size=args.box_size,
        grid_size=args.grid_size,
        parameter_groups=args.parameter_groups,
        regions=args.regions,
        compute_mp=compute_mp,
    )
