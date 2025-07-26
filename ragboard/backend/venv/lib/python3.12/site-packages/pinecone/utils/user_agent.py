import urllib3

from .version import __version__

def get_user_agent():
    client_id = f"python-client-{__version__}"
    user_agent_details = {"urllib3": urllib3.__version__}
    user_agent = "{} ({})".format(client_id, ", ".join([f"{k}:{v}" for k, v in user_agent_details.items()]))
    return user_agent