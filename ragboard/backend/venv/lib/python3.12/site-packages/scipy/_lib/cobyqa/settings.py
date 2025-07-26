import sys
from enum import Enum

import numpy as np


# Exit status.
class ExitStatus(Enum):
    """
    Exit statuses.
    """

    RADIUS_SUCCESS = 0
    TARGET_SUCCESS = 1
    FIXED_SUCCESS = 2
    CALLBACK_SUCCESS = 3
    FEASIBLE_SUCCESS = 4
    MAX_EVAL_WARNING = 5
    MAX_ITER_WARNING = 6
    INFEASIBLE_ERROR = -1
    LINALG_ERROR = -2


class Options(str, Enum):
    """
    Options.
    """

    DEBUG = "debug"
    FEASIBILITY_TOL = "feasibility_tol"
    FILTER_SIZE = "filter_size"
    HISTORY_SIZE = "history_size"
    MAX_EVAL = "maxfev"
    MAX_ITER = "maxiter"
    NPT = "nb_points"
    RHOBEG = "radius_init"
    RHOEND = "radius_final"
    SCALE = "scale"
    STORE_HISTORY = "store_history"
    TARGET = "target"
    VERBOSE = "disp"


class Constants(str, Enum):
    """
    Constants.
    """

    DECREASE_RADIUS_FACTOR = "decrease_radius_factor"
    INCREASE_RADIUS_FACTOR = "increase_radius_factor"
    INCREASE_RADIUS_THRESHOLD = "increase_radius_threshold"
    DECREASE_RADIUS_THRESHOLD = "decrease_radius_threshold"
    DECREASE_RESOLUTION_FACTOR = "decrease_resolution_factor"
    LARGE_RESOLUTION_THRESHOLD = "large_resolution_threshold"
    MODERATE_RESOLUTION_THRESHOLD = "moderate_resolution_threshold"
    LOW_RATIO = "low_ratio"
    HIGH_RATIO = "high_ratio"
    VERY_LOW_RATIO = "very_low_ratio"
    PENALTY_INCREASE_THRESHOLD = "penalty_increase_threshold"
    PENALTY_INCREASE_FACTOR = "penalty_increase_factor"
    SHORT_STEP_THRESHOLD = "short_step_threshold"
    LOW_RADIUS_FACTOR = "low_radius_factor"
    BYRD_OMOJOKUN_FACTOR = "byrd_omojokun_factor"
    THRESHOLD_RATIO_CONSTRAINTS = "threshold_ratio_constraints"
    LARGE_SHIFT_FACTOR = "large_shift_factor"
    LARGE_GRADIENT_FACTOR = "large_gradient_factor"
    RESOLUTION_FACTOR = "resolution_factor"
    IMPROVE_TCG = "improve_tcg"


# Default options.
DEFAULT_OPTIONS = {
    Options.DEBUG.value: False,
    Options.FEASIBILITY_TOL.value: np.sqrt(np.finfo(float).eps),
    Options.FILTER_SIZE.value: sys.maxsize,
    Options.HISTORY_SIZE.value: sys.maxsize,
    Options.MAX_EVAL.value: lambda n: 500 * n,
    Options.MAX_ITER.value: lambda n: 1000 * n,
    Options.NPT.value: lambda n: 2 * n + 1,
    Options.RHOBEG.value: 1.0,
    Options.RHOEND.value: 1e-6,
    Options.SCALE.value: False,
    Options.STORE_HISTORY.value: False,
    Options.TARGET.value: -np.inf,
    Options.VERBOSE.value: False,
}

# Default constants.
DEFAULT_CONSTANTS = {
    Constants.DECREASE_RADIUS_FACTOR.value: 0.5,
    Constants.INCREASE_RADIUS_FACTOR.value: np.sqrt(2.0),
    Constants.INCREASE_RADIUS_THRESHOLD.value: 2.0,
    Constants.DECREASE_RADIUS_THRESHOLD.value: 1.4,
    Constants.DECREASE_RESOLUTION_FACTOR.value: 0.1,
    Constants.LARGE_RESOLUTION_THRESHOLD.value: 250.0,
    Constants.MODERATE_RESOLUTION_THRESHOLD.value: 16.0,
    Constants.LOW_RATIO.value: 0.1,
    Constants.HIGH_RATIO.value: 0.7,
    Constants.VERY_LOW_RATIO.value: 0.01,
    Constants.PENALTY_INCREASE_THRESHOLD.value: 1.5,
    Constants.PENALTY_INCREASE_FACTOR.value: 2.0,
    Constants.SHORT_STEP_THRESHOLD.value: 0.5,
    Constants.LOW_RADIUS_FACTOR.value: 0.1,
    Constants.BYRD_OMOJOKUN_FACTOR.value: 0.8,
    Constants.THRESHOLD_RATIO_CONSTRAINTS.value: 2.0,
    Constants.LARGE_SHIFT_FACTOR.value: 10.0,
    Constants.LARGE_GRADIENT_FACTOR.value: 10.0,
    Constants.RESOLUTION_FACTOR.value: 2.0,
    Constants.IMPROVE_TCG.value: True,
}

# Printing options.
PRINT_OPTIONS = {
    "threshold": 6,
    "edgeitems": 2,
    "linewidth": sys.maxsize,
    "formatter": {
        "float_kind": lambda x: np.format_float_scientific(
            x,
            precision=3,
            unique=False,
            pad_left=2,
        )
    },
}

# Constants.
BARRIER = 2.0 ** min(
    100,
    np.finfo(float).maxexp // 2,
    -np.finfo(float).minexp // 2,
)
