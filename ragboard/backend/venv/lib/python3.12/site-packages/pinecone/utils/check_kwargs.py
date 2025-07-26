import inspect
import logging

def check_kwargs(caller, given):
    argspec = inspect.getfullargspec(caller)
    diff = set(given).difference(argspec.args)
    if diff:
        logging.exception(caller.__name__ + " had unexpected keyword argument(s): " + ", ".join(diff), exc_info=False)
