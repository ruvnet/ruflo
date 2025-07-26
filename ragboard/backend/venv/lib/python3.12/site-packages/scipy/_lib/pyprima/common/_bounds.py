import numpy as np
from scipy.optimize import Bounds

def process_bounds(bounds, lenx0):
    '''
    `bounds` can either be an object with the properties lb and ub, or a list of tuples
    indicating a lower bound and an upper bound for each variable. If the list contains
    fewer entries than the length of x0, the remaining entries will generated as -/+ infinity.
    Some examples of valid lists of tuple, assuming len(x0) == 3:
    [(0, 1), (2, 3), (4, 5)] -> returns [0, 2, 4], [1, 3, 5]
    [(0, 1), (None, 3)]      -> returns [0, -inf, -inf], [1, 3, inf]
    [(0, 1), (-np.inf, 3)]   -> returns [0, -inf, -inf], [1, 3, inf]
    '''

    if bounds is None:
        lb = np.array([-np.inf]*lenx0, dtype=np.float64)
        ub = np.array([np.inf]*lenx0, dtype=np.float64)
        return lb, ub
    
    if isinstance(bounds, Bounds):
        lb = np.array(bounds.lb, dtype=np.float64)
        ub = np.array(bounds.ub, dtype=np.float64)
        lb = np.concatenate((lb, -np.inf*np.ones(lenx0 - len(lb))))
        ub = np.concatenate((ub, np.inf*np.ones(lenx0 - len(ub))))
        return lb, ub
    
    # If neither of the above conditions are true, we assume that bounds is a list of tuples
    lb = np.array([bound[0] if bound[0] is not None else -np.inf for bound in bounds], dtype=np.float64)
    ub = np.array([bound[1] if bound[1] is not None else np.inf for bound in bounds], dtype=np.float64)
    # If there were fewer bounds than variables, pad the rest with -/+ infinity
    lb = np.concatenate((lb, -np.inf*np.ones(lenx0 - len(lb))))
    ub = np.concatenate((ub, np.inf*np.ones(lenx0 - len(ub))))
    
    return lb, ub
