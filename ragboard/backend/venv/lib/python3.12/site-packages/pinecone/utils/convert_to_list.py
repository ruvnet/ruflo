def convert_to_list(obj):
    class_name = obj.__class__.__name__

    if class_name == 'list':
        return obj
    elif hasattr(obj, 'tolist') and callable(getattr(obj, 'tolist')):
        return obj.tolist()
    else:
        return list(obj)