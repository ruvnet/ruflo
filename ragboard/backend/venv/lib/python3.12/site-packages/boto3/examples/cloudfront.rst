Generate a signed URL for Amazon CloudFront
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The following example shows how to generate a signed URL for Amazon CloudFront.
Note that you will need the ``cryptography`` `library <https://cryptography.io/en/latest/>`__ to follow this example::

    import datetime

    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from botocore.signers import CloudFrontSigner


    def rsa_signer(message):
        with open('path/to/key.pem', 'rb') as key_file:
            private_key = serialization.load_pem_private_key(
                key_file.read(),
                password=None,
                backend=default_backend()
            )
        return private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())

    key_id = 'AKIAIOSFODNN7EXAMPLE'
    url = 'http://d2949o5mkkp72v.cloudfront.net/hello.txt'
    expire_date = datetime.datetime(2017, 1, 1)

    cloudfront_signer = CloudFrontSigner(key_id, rsa_signer)

    # Create a signed url that will be valid until the specific expiry date
    # provided using a canned policy.
    signed_url = cloudfront_signer.generate_presigned_url(
        url, date_less_than=expire_date)
    print(signed_url)
