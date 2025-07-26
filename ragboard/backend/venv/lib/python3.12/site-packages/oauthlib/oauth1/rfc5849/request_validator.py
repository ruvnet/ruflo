"""
oauthlib.oauth1.rfc5849
~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for signing and checking OAuth 1.0 RFC 5849 requests.
"""
from . import SIGNATURE_METHODS, utils


class RequestValidator:

    """A validator/datastore interaction base class for OAuth 1 providers.

    OAuth providers should inherit from RequestValidator and implement the
    methods and properties outlined below. Further details are provided in the
    documentation for each method and property.

    Methods used to check the format of input parameters. Common tests include
    length, character set, membership, range or pattern. These tests are
    referred to as `whitelisting or blacklisting`_. Whitelisting is better
    but blacklisting can be useful to spot malicious activity.
    The following have methods a default implementation:

    - check_client_key
    - check_request_token
    - check_access_token
    - check_nonce
    - check_verifier
    - check_realms

    The methods above default to whitelist input parameters, checking that they
    are alphanumerical and between a minimum and maximum length. Rather than
    overloading the methods a few properties can be used to configure these
    methods.

    * @safe_characters -> (character set)
    * @client_key_length -> (min, max)
    * @request_token_length -> (min, max)
    * @access_token_length -> (min, max)
    * @nonce_length -> (min, max)
    * @verifier_length -> (min, max)
    * @realms -> [list, of, realms]

    Methods used to validate/invalidate input parameters. These checks usually
    hit either persistent or temporary storage such as databases or the
    filesystem. See each methods documentation for detailed usage.
    The following methods must be implemented:

    - validate_client_key
    - validate_request_token
    - validate_access_token
    - validate_timestamp_and_nonce
    - validate_redirect_uri
    - validate_requested_realms
    - validate_realms
    - validate_verifier
    - invalidate_request_token

    Methods used to retrieve sensitive information from storage.
    The following methods must be implemented:

    - get_client_secret
    - get_request_token_secret
    - get_access_token_secret
    - get_rsa_key
    - get_realms
    - get_default_realms
    - get_redirect_uri

    Methods used to save credentials.
    The following methods must be implemented:

    - save_request_token
    - save_verifier
    - save_access_token

    Methods used to verify input parameters. This methods are used during
    authorizing request token by user (AuthorizationEndpoint), to check if
    parameters are valid. During token authorization request is not signed,
    thus 'validation' methods can not be used. The following methods must be
    implemented:

    - verify_realms
    - verify_request_token

    To prevent timing attacks it is necessary to not exit early even if the
    client key or resource owner key is invalid. Instead dummy values should
    be used during the remaining verification process. It is very important
    that the dummy client and token are valid input parameters to the methods
    get_client_secret, get_rsa_key and get_(access/request)_token_secret and
    that the running time of those methods when given a dummy value remain
    equivalent to the running time when given a valid client/resource owner.
    The following properties must be implemented:

    * @dummy_client
    * @dummy_request_token
    * @dummy_access_token

    Example implementations have been provided, note that the database used is
    a simple dictionary and serves only an illustrative purpose. Use whichever
    database suits your project and how to access it is entirely up to you.
    The methods are introduced in an order which should make understanding
    their use more straightforward and as such it could be worth reading what
    follows in chronological order.

    .. _`whitelisting or blacklisting`: https://www.schneier.com/blog/archives/2011/01/whitelisting_vs.html
    """

    def __init__(self):
        pass

    @property
    def allowed_signature_methods(self):
        return SIGNATURE_METHODS

    @property
    def safe_characters(self):
        return set(utils.UNICODE_ASCII_CHARACTER_SET)

    @property
    def client_key_length(self):
        return 20, 30

    @property
    def request_token_length(self):
        return 20, 30

    @property
    def access_token_length(self):
        return 20, 30

    @property
    def timestamp_lifetime(self):
        return 600

    @property
    def nonce_length(self):
        return 20, 30

    @property
    def verifier_length(self):
        return 20, 30

    @property
    def realms(self):
        return []

    @property
    def enforce_ssl(self):
        return True

    def check_client_key(self, client_key):
        """Check that the client key only contains safe characters
        and is no shorter than lower and no longer than upper.
        """
        lower, upper = self.client_key_length
        return (set(client_key) <= self.safe_characters and
                lower <= len(client_key) <= upper)

    def check_request_token(self, request_token):
        """Checks that the request token contains only safe characters
        and is no shorter than lower and no longer than upper.
        """
        lower, upper = self.request_token_length
        return (set(request_token) <= self.safe_characters and
                lower <= len(request_token) <= upper)

    def check_access_token(self, request_token):
        """Checks that the token contains only safe characters
        and is no shorter than lower and no longer than upper.
        """
        lower, upper = self.access_token_length
        return (set(request_token) <= self.safe_characters and
                lower <= len(request_token) <= upper)

    def check_nonce(self, nonce):
        """Checks that the nonce only contains only safe characters
        and is no shorter than lower and no longer than upper.
        """
        lower, upper = self.nonce_length
        return (set(nonce) <= self.safe_characters and
                lower <= len(nonce) <= upper)

    def check_verifier(self, verifier):
        """Checks that the verifier contains only safe characters
        and is no shorter than lower and no longer than upper.
        """
        lower, upper = self.verifier_length
        return (set(verifier) <= self.safe_characters and
                lower <= len(verifier) <= upper)

    def check_realms(self, realms):
        """Check that the realm is one of a set allowed realms."""
        return all(r in self.realms for r in realms)

    def _subclass_must_implement(self, fn):
        """
        Returns a NotImplementedError for a function that should be implemented.
        :param fn: name of the function
        """
        m = "Missing function implementation in {}: {}".format(type(self), fn)
        return NotImplementedError(m)

    @property
    def dummy_client(self):
        """Dummy client used when an invalid client key is supplied.

        :returns: The dummy client key string.

        The dummy client should be associated with either a client secret,
        a rsa key or both depending on which signature methods are supported.
        Providers should make sure that

        get_client_secret(dummy_client)
        get_rsa_key(dummy_client)

        return a valid secret or key for the dummy client.

        This method is used by

        * AccessTokenEndpoint
        * RequestTokenEndpoint
        * ResourceEndpoint
        * SignatureOnlyEndpoint
        """
        raise self._subclass_must_implement("dummy_client")

    @property
    def dummy_request_token(self):
        """Dummy request token used when an invalid token was supplied.

        :returns: The dummy request token string.

        The dummy request token should be associated with a request token
        secret such that get_request_token_secret(.., dummy_request_token)
        returns a valid secret.

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("dummy_request_token")

    @property
    def dummy_access_token(self):
        """Dummy access token used when an invalid token was supplied.

        :returns: The dummy access token string.

        The dummy access token should be associated with an access token
        secret such that get_access_token_secret(.., dummy_access_token)
        returns a valid secret.

        This method is used by

        * ResourceEndpoint
        """
        raise self._subclass_must_implement("dummy_access_token")

    def get_client_secret(self, client_key, request):
        """Retrieves the client secret associated with the client key.

        :param client_key: The client/consumer key.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The client secret as a string.

        This method must allow the use of a dummy client_key value.
        Fetching the secret using the dummy key must take the same amount of
        time as fetching a secret for a valid client::

            # Unlikely to be near constant time as it uses two database
            # lookups for a valid client, and only one for an invalid.
            from your_datastore import ClientSecret
            if ClientSecret.has(client_key):
                return ClientSecret.get(client_key)
            else:
                return 'dummy'

            # Aim to mimic number of latency inducing operations no matter
            # whether the client is valid or not.
            from your_datastore import ClientSecret
            return ClientSecret.get(client_key, 'dummy')

        Note that the returned key must be in plaintext.

        This method is used by

        * AccessTokenEndpoint
        * RequestTokenEndpoint
        * ResourceEndpoint
        * SignatureOnlyEndpoint
        """
        raise self._subclass_must_implement('get_client_secret')

    def get_request_token_secret(self, client_key, token, request):
        """Retrieves the shared secret associated with the request token.

        :param client_key: The client/consumer key.
        :param token: The request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The token secret as a string.

        This method must allow the use of a dummy values and the running time
        must be roughly equivalent to that of the running time of valid values::

            # Unlikely to be near constant time as it uses two database
            # lookups for a valid client, and only one for an invalid.
            from your_datastore import RequestTokenSecret
            if RequestTokenSecret.has(client_key):
                return RequestTokenSecret.get((client_key, request_token))
            else:
                return 'dummy'

            # Aim to mimic number of latency inducing operations no matter
            # whether the client is valid or not.
            from your_datastore import RequestTokenSecret
            return ClientSecret.get((client_key, request_token), 'dummy')

        Note that the returned key must be in plaintext.

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement('get_request_token_secret')

    def get_access_token_secret(self, client_key, token, request):
        """Retrieves the shared secret associated with the access token.

        :param client_key: The client/consumer key.
        :param token: The access token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The token secret as a string.

        This method must allow the use of a dummy values and the running time
        must be roughly equivalent to that of the running time of valid values::

            # Unlikely to be near constant time as it uses two database
            # lookups for a valid client, and only one for an invalid.
            from your_datastore import AccessTokenSecret
            if AccessTokenSecret.has(client_key):
                return AccessTokenSecret.get((client_key, request_token))
            else:
                return 'dummy'

            # Aim to mimic number of latency inducing operations no matter
            # whether the client is valid or not.
            from your_datastore import AccessTokenSecret
            return ClientSecret.get((client_key, request_token), 'dummy')

        Note that the returned key must be in plaintext.

        This method is used by

        * ResourceEndpoint
        """
        raise self._subclass_must_implement("get_access_token_secret")

    def get_default_realms(self, client_key, request):
        """Get the default realms for a client.

        :param client_key: The client/consumer key.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The list of default realms associated with the client.

        The list of default realms will be set during client registration and
        is outside the scope of OAuthLib.

        This method is used by

        * RequestTokenEndpoint
        """
        raise self._subclass_must_implement("get_default_realms")

    def get_realms(self, token, request):
        """Get realms associated with a request token.

        :param token: The request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The list of realms associated with the request token.

        This method is used by

        * AuthorizationEndpoint
        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("get_realms")

    def get_redirect_uri(self, token, request):
        """Get the redirect URI associated with a request token.

        :param token: The request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The redirect URI associated with the request token.

        It may be desirable to return a custom URI if the redirect is set to "oob".
        In this case, the user will be redirected to the returned URI and at that
        endpoint the verifier can be displayed.

        This method is used by

        * AuthorizationEndpoint
        """
        raise self._subclass_must_implement("get_redirect_uri")

    def get_rsa_key(self, client_key, request):
        """Retrieves a previously stored client provided RSA key.

        :param client_key: The client/consumer key.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: The rsa public key as a string.

        This method must allow the use of a dummy client_key value. Fetching
        the rsa key using the dummy key must take the same amount of time
        as fetching a key for a valid client. The dummy key must also be of
        the same bit length as client keys.

        Note that the key must be returned in plaintext.

        This method is used by

        * AccessTokenEndpoint
        * RequestTokenEndpoint
        * ResourceEndpoint
        * SignatureOnlyEndpoint
        """
        raise self._subclass_must_implement("get_rsa_key")

    def invalidate_request_token(self, client_key, request_token, request):
        """Invalidates a used request token.

        :param client_key: The client/consumer key.
        :param request_token: The request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: None

        Per `Section 2.3`_ of the spec:

        "The server MUST (...) ensure that the temporary
        credentials have not expired or been used before."

        .. _`Section 2.3`: https://tools.ietf.org/html/rfc5849#section-2.3

        This method should ensure that provided token won't validate anymore.
        It can be simply removing RequestToken from storage or setting
        specific flag that makes it invalid (note that such flag should be
        also validated during request token validation).

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("invalidate_request_token")

    def validate_client_key(self, client_key, request):
        """Validates that supplied client key is a registered and valid client.

        :param client_key: The client/consumer key.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        Note that if the dummy client is supplied it should validate in same
        or nearly the same amount of time as a valid one.

        Ensure latency inducing tasks are mimiced even for dummy clients.
        For example, use::

            from your_datastore import Client
            try:
                return Client.exists(client_key, access_token)
            except DoesNotExist:
                return False

        Rather than::

            from your_datastore import Client
            if access_token == self.dummy_access_token:
                return False
            else:
                return Client.exists(client_key, access_token)

        This method is used by

        * AccessTokenEndpoint
        * RequestTokenEndpoint
        * ResourceEndpoint
        * SignatureOnlyEndpoint
        """
        raise self._subclass_must_implement("validate_client_key")

    def validate_request_token(self, client_key, token, request):
        """Validates that supplied request token is registered and valid.

        :param client_key: The client/consumer key.
        :param token: The request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        Note that if the dummy request_token is supplied it should validate in
        the same nearly the same amount of time as a valid one.

        Ensure latency inducing tasks are mimiced even for dummy clients.
        For example, use::

            from your_datastore import RequestToken
            try:
                return RequestToken.exists(client_key, access_token)
            except DoesNotExist:
                return False

        Rather than::

            from your_datastore import RequestToken
            if access_token == self.dummy_access_token:
                return False
            else:
                return RequestToken.exists(client_key, access_token)

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("validate_request_token")

    def validate_access_token(self, client_key, token, request):
        """Validates that supplied access token is registered and valid.

        :param client_key: The client/consumer key.
        :param token: The access token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        Note that if the dummy access token is supplied it should validate in
        the same or nearly the same amount of time as a valid one.

        Ensure latency inducing tasks are mimiced even for dummy clients.
        For example, use::

            from your_datastore import AccessToken
            try:
                return AccessToken.exists(client_key, access_token)
            except DoesNotExist:
                return False

        Rather than::

            from your_datastore import AccessToken
            if access_token == self.dummy_access_token:
                return False
            else:
                return AccessToken.exists(client_key, access_token)

        This method is used by

        * ResourceEndpoint
        """
        raise self._subclass_must_implement("validate_access_token")

    def validate_timestamp_and_nonce(self, client_key, timestamp, nonce,
                                     request, request_token=None, access_token=None):
        """Validates that the nonce has not been used before.

        :param client_key: The client/consumer key.
        :param timestamp: The ``oauth_timestamp`` parameter.
        :param nonce: The ``oauth_nonce`` parameter.
        :param request_token: Request token string, if any.
        :param access_token: Access token string, if any.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        Per `Section 3.3`_ of the spec.

        "A nonce is a random string, uniquely generated by the client to allow
        the server to verify that a request has never been made before and
        helps prevent replay attacks when requests are made over a non-secure
        channel.  The nonce value MUST be unique across all requests with the
        same timestamp, client credentials, and token combinations."

        .. _`Section 3.3`: https://tools.ietf.org/html/rfc5849#section-3.3

        One of the first validation checks that will be made is for the validity
        of the nonce and timestamp, which are associated with a client key and
        possibly a token. If invalid then immediately fail the request
        by returning False. If the nonce/timestamp pair has been used before and
        you may just have detected a replay attack. Therefore it is an essential
        part of OAuth security that you not allow nonce/timestamp reuse.
        Note that this validation check is done before checking the validity of
        the client and token.::

           nonces_and_timestamps_database = [
              (u'foo', 1234567890, u'rannoMstrInghere', u'bar')
           ]

           def validate_timestamp_and_nonce(self, client_key, timestamp, nonce,
              request_token=None, access_token=None):

              return ((client_key, timestamp, nonce, request_token or access_token)
                       not in self.nonces_and_timestamps_database)

        This method is used by

        * AccessTokenEndpoint
        * RequestTokenEndpoint
        * ResourceEndpoint
        * SignatureOnlyEndpoint
        """
        raise self._subclass_must_implement("validate_timestamp_and_nonce")

    def validate_redirect_uri(self, client_key, redirect_uri, request):
        """Validates the client supplied redirection URI.

        :param client_key: The client/consumer key.
        :param redirect_uri: The URI the client which to redirect back to after
                             authorization is successful.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        It is highly recommended that OAuth providers require their clients
        to register all redirection URIs prior to using them in requests and
        register them as absolute URIs. See `CWE-601`_ for more information
        about open redirection attacks.

        By requiring registration of all redirection URIs it should be
        straightforward for the provider to verify whether the supplied
        redirect_uri is valid or not.

        Alternatively per `Section 2.1`_ of the spec:

        "If the client is unable to receive callbacks or a callback URI has
        been established via other means, the parameter value MUST be set to
        "oob" (case sensitive), to indicate an out-of-band configuration."

        .. _`CWE-601`: http://cwe.mitre.org/top25/index.html#CWE-601
        .. _`Section 2.1`: https://tools.ietf.org/html/rfc5849#section-2.1

        This method is used by

        * RequestTokenEndpoint
        """
        raise self._subclass_must_implement("validate_redirect_uri")

    def validate_requested_realms(self, client_key, realms, request):
        """Validates that the client may request access to the realm.

        :param client_key: The client/consumer key.
        :param realms: The list of realms that client is requesting access to.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        This method is invoked when obtaining a request token and should
        tie a realm to the request token and after user authorization
        this realm restriction should transfer to the access token.

        This method is used by

        * RequestTokenEndpoint
        """
        raise self._subclass_must_implement("validate_requested_realms")

    def validate_realms(self, client_key, token, request, uri=None,
                        realms=None):
        """Validates access to the request realm.

        :param client_key: The client/consumer key.
        :param token: A request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :param uri: The URI the realms is protecting.
        :param realms: A list of realms that must have been granted to
                       the access token.
        :returns: True or False

        How providers choose to use the realm parameter is outside the OAuth
        specification but it is commonly used to restrict access to a subset
        of protected resources such as "photos".

        realms is a convenience parameter which can be used to provide
        a per view method pre-defined list of allowed realms.

        Can be as simple as::

            from your_datastore import RequestToken
            request_token = RequestToken.get(token, None)

            if not request_token:
                return False
            return set(request_token.realms).issuperset(set(realms))

        This method is used by

        * ResourceEndpoint
        """
        raise self._subclass_must_implement("validate_realms")

    def validate_verifier(self, client_key, token, verifier, request):
        """Validates a verification code.

        :param client_key: The client/consumer key.
        :param token: A request token string.
        :param verifier: The authorization verifier string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        OAuth providers issue a verification code to clients after the
        resource owner authorizes access. This code is used by the client to
        obtain token credentials and the provider must verify that the
        verifier is valid and associated with the client as well as the
        resource owner.

        Verifier validation should be done in near constant time
        (to avoid verifier enumeration). To achieve this we need a
        constant time string comparison which is provided by OAuthLib
        in ``oauthlib.common.safe_string_equals``::

            from your_datastore import Verifier
            correct_verifier = Verifier.get(client_key, request_token)
            from oauthlib.common import safe_string_equals
            return safe_string_equals(verifier, correct_verifier)

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("validate_verifier")

    def verify_request_token(self, token, request):
        """Verify that the given OAuth1 request token is valid.

        :param token: A request token string.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        This method is used only in AuthorizationEndpoint to check whether the
        oauth_token given in the authorization URL is valid or not.
        This request is not signed and thus similar ``validate_request_token``
        method can not be used.

        This method is used by

        * AuthorizationEndpoint
        """
        raise self._subclass_must_implement("verify_request_token")

    def verify_realms(self, token, realms, request):
        """Verify authorized realms to see if they match those given to token.

        :param token: An access token string.
        :param realms: A list of realms the client attempts to access.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :returns: True or False

        This prevents the list of authorized realms sent by the client during
        the authorization step to be altered to include realms outside what
        was bound with the request token.

        Can be as simple as::

            valid_realms = self.get_realms(token)
            return all((r in valid_realms for r in realms))

        This method is used by

        * AuthorizationEndpoint
        """
        raise self._subclass_must_implement("verify_realms")

    def save_access_token(self, token, request):
        """Save an OAuth1 access token.

        :param token: A dict with token credentials.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request

        The token dictionary will at minimum include

        * ``oauth_token`` the access token string.
        * ``oauth_token_secret`` the token specific secret used in signing.
        * ``oauth_authorized_realms`` a space separated list of realms.

        Client key can be obtained from ``request.client_key``.

        The list of realms (not joined string) can be obtained from
        ``request.realm``.

        This method is used by

        * AccessTokenEndpoint
        """
        raise self._subclass_must_implement("save_access_token")

    def save_request_token(self, token, request):
        """Save an OAuth1 request token.

        :param token: A dict with token credentials.
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request

        The token dictionary will at minimum include

        * ``oauth_token`` the request token string.
        * ``oauth_token_secret`` the token specific secret used in signing.
        * ``oauth_callback_confirmed`` the string ``true``.

        Client key can be obtained from ``request.client_key``.

        This method is used by

        * RequestTokenEndpoint
        """
        raise self._subclass_must_implement("save_request_token")

    def save_verifier(self, token, verifier, request):
        """Associate an authorization verifier with a request token.

        :param token: A request token string.
        :param verifier: A dictionary containing the oauth_verifier and
                        oauth_token
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request

        We need to associate verifiers with tokens for validation during the
        access token request.

        Note that unlike save_x_token token here is the ``oauth_token`` token
        string from the request token saved previously.

        This method is used by

        * AuthorizationEndpoint
        """
        raise self._subclass_must_implement("save_verifier")
