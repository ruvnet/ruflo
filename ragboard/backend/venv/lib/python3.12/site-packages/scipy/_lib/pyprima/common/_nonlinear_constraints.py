import numpy as np
        
def transform_constraint_function(nlc):
    '''
    The Python interfaces receives the constraints as lb <= constraint(x) <= ub, 
    but the Fortran backend expects the nonlinear constraints to be constraint(x) <= 0.
    Thus a conversion is needed.
    
    In addition to the conversion, we add a check to ensure that the provided lower/upper bounds
    have a shape consistent with the output of the constraint function.
    '''

    def newconstraint(x):
        values = np.atleast_1d(np.array(nlc.fun(x), dtype=np.float64))
        
        # Upgrade the lower/upper bounds to vectors if necessary
        lb = nlc.lb
        try:
            _ = len(lb)
        except TypeError:
            lb = np.array([nlc.lb]*len(values), dtype=np.float64)

        ub = nlc.ub
        try:
            _ = len(ub)
        except TypeError:
            ub = np.array([nlc.ub]*len(values), dtype=np.float64)
        
        
        # Check the shapes and raise an exception if they do not match
        if len(values) != len(lb):
            raise ValueError("The number of elements in the constraint function's output does not match the number of elements in the lower bound.")
        if len(values) != len(ub):
            raise ValueError("The number of elements in the constraint function's output does not match the number of elements in the upper bound.")
        
        # Combine the upper and lower bounds to transform the function into the form
        # expected by the Fortran backend.
        return np.concatenate(([lb_ii - vi for lb_ii, vi in zip(lb, values) if lb_ii > -np.inf],
                               [vi - ub_ii for ub_ii, vi in zip(ub, values) if ub_ii < np.inf],
                            ))
    return newconstraint


def process_nl_constraints(nlcs):
    functions = []
    for nlc in nlcs:
        fun_i = transform_constraint_function(nlc)
        functions.append(fun_i)
    def constraint_function(x):
        values = np.empty(0, dtype=np.float64)
        for fun in functions:
            values = np.concatenate((values, fun(x)))
        return values
    return constraint_function
