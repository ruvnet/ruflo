from .operations.base import Operations

# create proxy functions for
# each method on the Operations class.
Operations.create_module_class_proxy(globals(), locals())
