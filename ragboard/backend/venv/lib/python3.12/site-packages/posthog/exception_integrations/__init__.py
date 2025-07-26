class IntegrationEnablingError(Exception):
    """
    The integration could not be enabled due to a user error like
    `django` not being installed for the `DjangoIntegration`.
    """
