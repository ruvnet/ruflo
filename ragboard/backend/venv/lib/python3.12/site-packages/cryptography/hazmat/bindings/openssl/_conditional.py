# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations


def cryptography_has_set_cert_cb() -> list[str]:
    return [
        "SSL_CTX_set_cert_cb",
        "SSL_set_cert_cb",
    ]


def cryptography_has_ssl_st() -> list[str]:
    return [
        "SSL_ST_BEFORE",
        "SSL_ST_OK",
        "SSL_ST_INIT",
        "SSL_ST_RENEGOTIATE",
    ]


def cryptography_has_tls_st() -> list[str]:
    return [
        "TLS_ST_BEFORE",
        "TLS_ST_OK",
    ]


def cryptography_has_ssl_sigalgs() -> list[str]:
    return [
        "SSL_CTX_set1_sigalgs_list",
    ]


def cryptography_has_psk() -> list[str]:
    return [
        "SSL_CTX_use_psk_identity_hint",
        "SSL_CTX_set_psk_server_callback",
        "SSL_CTX_set_psk_client_callback",
    ]


def cryptography_has_psk_tlsv13() -> list[str]:
    return [
        "SSL_CTX_set_psk_find_session_callback",
        "SSL_CTX_set_psk_use_session_callback",
        "Cryptography_SSL_SESSION_new",
        "SSL_CIPHER_find",
        "SSL_SESSION_set1_master_key",
        "SSL_SESSION_set_cipher",
        "SSL_SESSION_set_protocol_version",
    ]


def cryptography_has_custom_ext() -> list[str]:
    return [
        "SSL_CTX_add_client_custom_ext",
        "SSL_CTX_add_server_custom_ext",
        "SSL_extension_supported",
    ]


def cryptography_has_tlsv13_functions() -> list[str]:
    return [
        "SSL_CTX_set_ciphersuites",
    ]


def cryptography_has_tlsv13_hs_functions() -> list[str]:
    return [
        "SSL_VERIFY_POST_HANDSHAKE",
        "SSL_verify_client_post_handshake",
        "SSL_CTX_set_post_handshake_auth",
        "SSL_set_post_handshake_auth",
        "SSL_SESSION_get_max_early_data",
        "SSL_write_early_data",
        "SSL_read_early_data",
        "SSL_CTX_set_max_early_data",
    ]


def cryptography_has_engine() -> list[str]:
    return [
        "ENGINE_by_id",
        "ENGINE_init",
        "ENGINE_finish",
        "ENGINE_get_default_RAND",
        "ENGINE_set_default_RAND",
        "ENGINE_unregister_RAND",
        "ENGINE_ctrl_cmd",
        "ENGINE_free",
        "ENGINE_get_name",
        "ENGINE_ctrl_cmd_string",
        "ENGINE_load_builtin_engines",
        "ENGINE_load_private_key",
        "ENGINE_load_public_key",
        "SSL_CTX_set_client_cert_engine",
    ]


def cryptography_has_verified_chain() -> list[str]:
    return [
        "SSL_get0_verified_chain",
    ]


def cryptography_has_srtp() -> list[str]:
    return [
        "SSL_CTX_set_tlsext_use_srtp",
        "SSL_set_tlsext_use_srtp",
        "SSL_get_selected_srtp_profile",
    ]


def cryptography_has_op_no_renegotiation() -> list[str]:
    return [
        "SSL_OP_NO_RENEGOTIATION",
    ]


def cryptography_has_dtls_get_data_mtu() -> list[str]:
    return [
        "DTLS_get_data_mtu",
    ]


def cryptography_has_ssl_cookie() -> list[str]:
    return [
        "SSL_OP_COOKIE_EXCHANGE",
        "DTLSv1_listen",
        "SSL_CTX_set_cookie_generate_cb",
        "SSL_CTX_set_cookie_verify_cb",
    ]


def cryptography_has_prime_checks() -> list[str]:
    return [
        "BN_prime_checks_for_size",
    ]


def cryptography_has_unexpected_eof_while_reading() -> list[str]:
    return ["SSL_R_UNEXPECTED_EOF_WHILE_READING"]


def cryptography_has_ssl_op_ignore_unexpected_eof() -> list[str]:
    return [
        "SSL_OP_IGNORE_UNEXPECTED_EOF",
    ]


def cryptography_has_get_extms_support() -> list[str]:
    return ["SSL_get_extms_support"]


# This is a mapping of
# {condition: function-returning-names-dependent-on-that-condition} so we can
# loop over them and delete unsupported names at runtime. It will be removed
# when cffi supports #if in cdef. We use functions instead of just a dict of
# lists so we can use coverage to measure which are used.
CONDITIONAL_NAMES = {
    "Cryptography_HAS_SET_CERT_CB": cryptography_has_set_cert_cb,
    "Cryptography_HAS_SSL_ST": cryptography_has_ssl_st,
    "Cryptography_HAS_TLS_ST": cryptography_has_tls_st,
    "Cryptography_HAS_SIGALGS": cryptography_has_ssl_sigalgs,
    "Cryptography_HAS_PSK": cryptography_has_psk,
    "Cryptography_HAS_PSK_TLSv1_3": cryptography_has_psk_tlsv13,
    "Cryptography_HAS_CUSTOM_EXT": cryptography_has_custom_ext,
    "Cryptography_HAS_TLSv1_3_FUNCTIONS": cryptography_has_tlsv13_functions,
    "Cryptography_HAS_TLSv1_3_HS_FUNCTIONS": (
        cryptography_has_tlsv13_hs_functions
    ),
    "Cryptography_HAS_ENGINE": cryptography_has_engine,
    "Cryptography_HAS_VERIFIED_CHAIN": cryptography_has_verified_chain,
    "Cryptography_HAS_SRTP": cryptography_has_srtp,
    "Cryptography_HAS_OP_NO_RENEGOTIATION": (
        cryptography_has_op_no_renegotiation
    ),
    "Cryptography_HAS_DTLS_GET_DATA_MTU": cryptography_has_dtls_get_data_mtu,
    "Cryptography_HAS_SSL_COOKIE": cryptography_has_ssl_cookie,
    "Cryptography_HAS_PRIME_CHECKS": cryptography_has_prime_checks,
    "Cryptography_HAS_UNEXPECTED_EOF_WHILE_READING": (
        cryptography_has_unexpected_eof_while_reading
    ),
    "Cryptography_HAS_SSL_OP_IGNORE_UNEXPECTED_EOF": (
        cryptography_has_ssl_op_ignore_unexpected_eof
    ),
    "Cryptography_HAS_GET_EXTMS_SUPPORT": cryptography_has_get_extms_support,
}
