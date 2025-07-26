def normalize_host(host):
    if host is None:
        return host
    if host.startswith('https://'):
        return host
    if host.startswith('http://'):
        return host
    return 'https://' + host