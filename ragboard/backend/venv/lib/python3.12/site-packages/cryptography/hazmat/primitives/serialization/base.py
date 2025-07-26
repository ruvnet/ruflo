# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from cryptography.hazmat.bindings._rust import openssl as rust_openssl

load_pem_private_key = rust_openssl.keys.load_pem_private_key
load_der_private_key = rust_openssl.keys.load_der_private_key

load_pem_public_key = rust_openssl.keys.load_pem_public_key
load_der_public_key = rust_openssl.keys.load_der_public_key

load_pem_parameters = rust_openssl.dh.from_pem_parameters
load_der_parameters = rust_openssl.dh.from_der_parameters
