'''
This module provides subroutines that handle the X/F/C histories of the solver, taking into
account that MAXHIST may be smaller than NF.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

def savehist(maxhist, x, xhist, f, fhist, cstrv, chist, constr, conhist):
    '''
    Save the data values to the history lists.

    The implementation of this function is vastly different from the Fortran implementation.
    This is mostly due to the ease of creating and appending to lists in Python

    However just like the Fortran version we should be concerned about both performance
    and memory constraints. It will probably be better to initialize an array of NaN for
    each of the histories and keep track of how many indices we have stored. Not needed for
    the moment.
    '''
    if len(xhist) < maxhist:
        xhist.append(x)
        fhist.append(f)
        chist.append(cstrv)
        conhist.append(constr)
    else:
        # This effectively accomplishes what rangehist does in the Fortran implementation
        xhist.pop(0)
        fhist.pop(0)
        chist.pop(0)
        conhist.pop(0)
        xhist.append(x)
        fhist.append(f)
        chist.append(cstrv)
        conhist.append(constr)
