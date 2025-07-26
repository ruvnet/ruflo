from warnings import warn

import numpy as np
import scipy.optimize._highspy._core as _h # type: ignore[import-not-found]
from scipy.optimize._highspy import _highs_options as hopt  # type: ignore[attr-defined]
from scipy.optimize import OptimizeWarning


def _highs_wrapper(c, indptr, indices, data, lhs, rhs, lb, ub, integrality, options):
    '''Solve linear programs using HiGHS [1]_.

    Assume problems of the form:

        MIN c.T @ x
        s.t. lhs <= A @ x <= rhs
             lb <= x <= ub

    Parameters
    ----------
    c : 1-D array, (n,)
        Array of objective value coefficients.
    astart : 1-D array
        CSC format index array.
    aindex : 1-D array
        CSC format index array.
    avalue : 1-D array
        Data array of the matrix.
    lhs : 1-D array (or None), (m,)
        Array of left hand side values of the inequality constraints.
        If ``lhs=None``, then an array of ``-inf`` is assumed.
    rhs : 1-D array, (m,)
        Array of right hand side values of the inequality constraints.
    lb : 1-D array (or None), (n,)
        Lower bounds on solution variables x.  If ``lb=None``, then an
        array of all `0` is assumed.
    ub : 1-D array (or None), (n,)
        Upper bounds on solution variables x.  If ``ub=None``, then an
        array of ``inf`` is assumed.
    options : dict
        A dictionary of solver options

    Returns
    -------
    res : dict

        If model_status is one of kOptimal,
        kObjectiveBound, kTimeLimit,
        kIterationLimit:

            - ``status`` : HighsModelStatus
                Model status code.

            - ``message`` : str
                Message corresponding to model status code.

            - ``x`` : list
                Solution variables.

            - ``slack`` : list
                Slack variables.

            - ``lambda`` : list
                Lagrange multipliers associated with the constraints
                Ax = b.

            - ``s`` : list
                Lagrange multipliers associated with the constraints
                x >= 0.

            - ``fun``
                Final objective value.

            - ``simplex_nit`` : int
                Number of iterations accomplished by the simplex
                solver.

            - ``ipm_nit`` : int
                Number of iterations accomplished by the interior-
                point solver.

        If model_status is not one of the above:

            - ``status`` : HighsModelStatus
                Model status code.

            - ``message`` : str
                Message corresponding to model status code.

    Notes
    -----
    If ``options['write_solution_to_file']`` is ``True`` but
    ``options['solution_file']`` is unset or ``''``, then the solution
    will be printed to ``stdout``.

    If any iteration limit is reached, no solution will be
    available.

    ``OptimizeWarning`` will be raised if any option value set by
    the user is found to be incorrect.

    References
    ----------
    .. [1] https://highs.dev/
    .. [2] https://www.maths.ed.ac.uk/hall/HiGHS/HighsOptions.html
    '''
    numcol = c.size
    numrow = rhs.size
    isMip = integrality is not None and np.sum(integrality) > 0

    # default "null" return values
    res = {
        "x": None,
        "fun": None,
    }

    # Fill up a HighsLp object
    lp = _h.HighsLp()
    lp.num_col_ = numcol
    lp.num_row_ = numrow
    lp.a_matrix_.num_col_ = numcol
    lp.a_matrix_.num_row_ = numrow
    lp.a_matrix_.format_ = _h.MatrixFormat.kColwise
    lp.col_cost_ = c
    lp.col_lower_ = lb
    lp.col_upper_ = ub
    lp.row_lower_ = lhs
    lp.row_upper_ = rhs
    lp.a_matrix_.start_ = indptr
    lp.a_matrix_.index_ = indices
    lp.a_matrix_.value_ = data
    if integrality.size > 0:
        lp.integrality_ = [_h.HighsVarType(i) for i in integrality]

    # Make a Highs object and pass it everything
    highs = _h._Highs()
    highs_options = _h.HighsOptions()
    hoptmanager = hopt.HighsOptionsManager()
    for key, val in options.items():
        # handle filtering of unsupported and default options
        if val is None or key in ("sense",):
            continue

        # ask for the option type
        opt_type = hoptmanager.get_option_type(key)
        if -1 == opt_type:
            warn(
                f"Unrecognized options detected: {dict({key: val})}",
                OptimizeWarning,
                stacklevel=2,
            )
            continue
        else:
            if key in ("presolve", "parallel"):
                # handle fake bools (require bool -> str conversions)
                if isinstance(val, bool):
                    val = "on" if val else "off"
                else:
                    warn(
                        f'Option f"{key}" is "{val}", but only True or False is '
                        f"allowed. Using default.",
                        OptimizeWarning,
                        stacklevel=2,
                    )
                    continue
            opt_type = _h.HighsOptionType(opt_type)
            status, msg = check_option(highs, key, val)
            if opt_type == _h.HighsOptionType.kBool:
                if not isinstance(val, bool):
                    warn(
                        f'Option f"{key}" is "{val}", but only True or False is '
                        f"allowed. Using default.",
                        OptimizeWarning,
                        stacklevel=2,
                    )
                    continue

            # warn or set option
            if status != 0:
                warn(msg, OptimizeWarning, stacklevel=2)
            else:
                setattr(highs_options, key, val)

    opt_status = highs.passOptions(highs_options)
    if opt_status == _h.HighsStatus.kError:
        res.update(
            {
                "status": highs.getModelStatus(),
                "message": highs.modelStatusToString(highs.getModelStatus()),
            }
        )
        return res

    init_status = highs.passModel(lp)
    if init_status == _h.HighsStatus.kError:
        # if model fails to load, highs.getModelStatus() will be NOT_SET
        err_model_status = _h.HighsModelStatus.kModelError
        res.update(
            {
                "status": err_model_status,
                "message": highs.modelStatusToString(err_model_status),
            }
        )
        return res

    # Solve the LP
    run_status = highs.run()
    if run_status == _h.HighsStatus.kError:
        res.update(
            {
                "status": highs.getModelStatus(),
                "message": highs.modelStatusToString(highs.getModelStatus()),
            }
        )
        return res

    # Extract what we need from the solution
    model_status = highs.getModelStatus()

    # it should always be safe to get the info object
    info = highs.getInfo()

    # Failure modes:
    #     LP: if we have anything other than an Optimal status, it
    #         is unsafe (and unhelpful) to read any results
    #    MIP: has a non-Optimal status or has timed out/reached max iterations
    #             1) If not Optimal/TimedOut/MaxIter status, there is no solution
    #             2) If TimedOut/MaxIter status, there may be a feasible solution.
    #                if the objective function value is not Infinity, then the
    #                current solution is feasible and can be returned.  Else, there
    #                is no solution.
    mipFailCondition = model_status not in (
        _h.HighsModelStatus.kOptimal,
        _h.HighsModelStatus.kTimeLimit,
        _h.HighsModelStatus.kIterationLimit,
        _h.HighsModelStatus.kSolutionLimit,
    ) or (
        model_status
        in {
            _h.HighsModelStatus.kTimeLimit,
            _h.HighsModelStatus.kIterationLimit,
            _h.HighsModelStatus.kSolutionLimit,
        }
        and (info.objective_function_value == _h.kHighsInf)
    )
    lpFailCondition = model_status != _h.HighsModelStatus.kOptimal
    if (isMip and mipFailCondition) or (not isMip and lpFailCondition):
        res.update(
            {
                "status": model_status,
                "message": "model_status is "
                f"{highs.modelStatusToString(model_status)}; "
                "primal_status is "
                f"{highs.solutionStatusToString(info.primal_solution_status)}",
                "simplex_nit": info.simplex_iteration_count,
                "ipm_nit": info.ipm_iteration_count,
                "crossover_nit": info.crossover_iteration_count,
            }
        )
        return res

    # Should be safe to read the solution:
    solution = highs.getSolution()
    basis = highs.getBasis()

    # Lagrangians for bounds based on column statuses
    marg_bnds = np.zeros((2, numcol))
    basis_col_status = basis.col_status
    solution_col_dual = solution.col_dual
    for ii in range(numcol):
        if basis_col_status[ii] == _h.HighsBasisStatus.kLower:
            marg_bnds[0, ii] = solution_col_dual[ii]
        elif basis_col_status[ii] == _h.HighsBasisStatus.kUpper:
            marg_bnds[1, ii] = solution_col_dual[ii]

    res.update(
        {
            "status": model_status,
            "message": highs.modelStatusToString(model_status),
            # Primal solution
            "x": np.array(solution.col_value),
            # Ax + s = b => Ax = b - s
            # Note: this is for all constraints (A_ub and A_eq)
            "slack": rhs - solution.row_value,
            # lambda are the lagrange multipliers associated with Ax=b
            "lambda": np.array(solution.row_dual),
            "marg_bnds": marg_bnds,
            "fun": info.objective_function_value,
            "simplex_nit": info.simplex_iteration_count,
            "ipm_nit": info.ipm_iteration_count,
            "crossover_nit": info.crossover_iteration_count,
        }
    )

    if isMip:
        res.update(
            {
                "mip_node_count": info.mip_node_count,
                "mip_dual_bound": info.mip_dual_bound,
                "mip_gap": info.mip_gap,
            }
        )

    return res


def check_option(highs_inst, option, value):
    status, option_type = highs_inst.getOptionType(option)
    hoptmanager = hopt.HighsOptionsManager()

    if status != _h.HighsStatus.kOk:
        return -1, "Invalid option name."

    valid_types = {
        _h.HighsOptionType.kBool: bool,
        _h.HighsOptionType.kInt: int,
        _h.HighsOptionType.kDouble: float,
        _h.HighsOptionType.kString: str,
    }

    expected_type = valid_types.get(option_type, None)

    if expected_type is str:
        if not hoptmanager.check_string_option(option, value):
            return -1, "Invalid option value."
    if expected_type is float:
        if not hoptmanager.check_double_option(option, value):
            return -1, "Invalid option value."
    if expected_type is int:
        if not hoptmanager.check_int_option(option, value):
            return -1, "Invalid option value."

    if expected_type is None:
        return 3, "Unknown option type."

    status, current_value = highs_inst.getOptionValue(option)
    if status != _h.HighsStatus.kOk:
        return 4, "Failed to validate option value."
    return 0, "Check option succeeded."
