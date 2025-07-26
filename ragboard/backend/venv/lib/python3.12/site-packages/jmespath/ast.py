# AST nodes have this structure:
# {"type": <node type>", children: [], "value": ""}


def comparator(name, first, second):
    return {'type': 'comparator', 'children': [first, second], 'value': name}


def current_node():
    return {'type': 'current', 'children': []}


def expref(expression):
    return {'type': 'expref', 'children': [expression]}


def function_expression(name, args):
    return {'type': 'function_expression', 'children': args, 'value': name}


def field(name):
    return {"type": "field", "children": [], "value": name}


def filter_projection(left, right, comparator):
    return {'type': 'filter_projection', 'children': [left, right, comparator]}


def flatten(node):
    return {'type': 'flatten', 'children': [node]}


def identity():
    return {"type": "identity", 'children': []}


def index(index):
    return {"type": "index", "value": index, "children": []}


def index_expression(children):
    return {"type": "index_expression", 'children': children}


def key_val_pair(key_name, node):
    return {"type": "key_val_pair", 'children': [node], "value": key_name}


def literal(literal_value):
    return {'type': 'literal', 'value': literal_value, 'children': []}


def multi_select_dict(nodes):
    return {"type": "multi_select_dict", "children": nodes}


def multi_select_list(nodes):
    return {"type": "multi_select_list", "children": nodes}


def or_expression(left, right):
    return {"type": "or_expression", "children": [left, right]}


def and_expression(left, right):
    return {"type": "and_expression", "children": [left, right]}


def not_expression(expr):
    return {"type": "not_expression", "children": [expr]}


def pipe(left, right):
    return {'type': 'pipe', 'children': [left, right]}


def projection(left, right):
    return {'type': 'projection', 'children': [left, right]}


def subexpression(children):
    return {"type": "subexpression", 'children': children}


def slice(start, end, step):
    return {"type": "slice", "children": [start, end, step]}


def value_projection(left, right):
    return {'type': 'value_projection', 'children': [left, right]}
