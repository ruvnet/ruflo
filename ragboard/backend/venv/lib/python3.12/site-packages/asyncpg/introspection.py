# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


_TYPEINFO_13 = '''\
    (
        SELECT
            t.oid                           AS oid,
            ns.nspname                      AS ns,
            t.typname                       AS name,
            t.typtype                       AS kind,
            (CASE WHEN t.typtype = 'd' THEN
                (WITH RECURSIVE typebases(oid, depth) AS (
                    SELECT
                        t2.typbasetype      AS oid,
                        0                   AS depth
                    FROM
                        pg_type t2
                    WHERE
                        t2.oid = t.oid

                    UNION ALL

                    SELECT
                        t2.typbasetype      AS oid,
                        tb.depth + 1        AS depth
                    FROM
                        pg_type t2,
                        typebases tb
                    WHERE
                       tb.oid = t2.oid
                       AND t2.typbasetype != 0
               ) SELECT oid FROM typebases ORDER BY depth DESC LIMIT 1)

               ELSE NULL
            END)                            AS basetype,
            t.typelem                       AS elemtype,
            elem_t.typdelim                 AS elemdelim,
            range_t.rngsubtype              AS range_subtype,
            (CASE WHEN t.typtype = 'c' THEN
                (SELECT
                    array_agg(ia.atttypid ORDER BY ia.attnum)
                FROM
                    pg_attribute ia
                    INNER JOIN pg_class c
                        ON (ia.attrelid = c.oid)
                WHERE
                    ia.attnum > 0 AND NOT ia.attisdropped
                    AND c.reltype = t.oid)

                ELSE NULL
            END)                            AS attrtypoids,
            (CASE WHEN t.typtype = 'c' THEN
                (SELECT
                    array_agg(ia.attname::text ORDER BY ia.attnum)
                FROM
                    pg_attribute ia
                    INNER JOIN pg_class c
                        ON (ia.attrelid = c.oid)
                WHERE
                    ia.attnum > 0 AND NOT ia.attisdropped
                    AND c.reltype = t.oid)

                ELSE NULL
            END)                            AS attrnames
        FROM
            pg_catalog.pg_type AS t
            INNER JOIN pg_catalog.pg_namespace ns ON (
                ns.oid = t.typnamespace)
            LEFT JOIN pg_type elem_t ON (
                t.typlen = -1 AND
                t.typelem != 0 AND
                t.typelem = elem_t.oid
            )
            LEFT JOIN pg_range range_t ON (
                t.oid = range_t.rngtypid
            )
    )
'''


INTRO_LOOKUP_TYPES_13 = '''\
WITH RECURSIVE typeinfo_tree(
    oid, ns, name, kind, basetype, elemtype, elemdelim,
    range_subtype, attrtypoids, attrnames, depth)
AS (
    SELECT
        ti.oid, ti.ns, ti.name, ti.kind, ti.basetype,
        ti.elemtype, ti.elemdelim, ti.range_subtype,
        ti.attrtypoids, ti.attrnames, 0
    FROM
        {typeinfo} AS ti
    WHERE
        ti.oid = any($1::oid[])

    UNION ALL

    SELECT
        ti.oid, ti.ns, ti.name, ti.kind, ti.basetype,
        ti.elemtype, ti.elemdelim, ti.range_subtype,
        ti.attrtypoids, ti.attrnames, tt.depth + 1
    FROM
        {typeinfo} ti,
        typeinfo_tree tt
    WHERE
        (tt.elemtype IS NOT NULL AND ti.oid = tt.elemtype)
        OR (tt.attrtypoids IS NOT NULL AND ti.oid = any(tt.attrtypoids))
        OR (tt.range_subtype IS NOT NULL AND ti.oid = tt.range_subtype)
        OR (tt.basetype IS NOT NULL AND ti.oid = tt.basetype)
)

SELECT DISTINCT
    *,
    basetype::regtype::text AS basetype_name,
    elemtype::regtype::text AS elemtype_name,
    range_subtype::regtype::text AS range_subtype_name
FROM
    typeinfo_tree
ORDER BY
    depth DESC
'''.format(typeinfo=_TYPEINFO_13)


_TYPEINFO = '''\
    (
        SELECT
            t.oid                           AS oid,
            ns.nspname                      AS ns,
            t.typname                       AS name,
            t.typtype                       AS kind,
            (CASE WHEN t.typtype = 'd' THEN
                (WITH RECURSIVE typebases(oid, depth) AS (
                    SELECT
                        t2.typbasetype      AS oid,
                        0                   AS depth
                    FROM
                        pg_type t2
                    WHERE
                        t2.oid = t.oid

                    UNION ALL

                    SELECT
                        t2.typbasetype      AS oid,
                        tb.depth + 1        AS depth
                    FROM
                        pg_type t2,
                        typebases tb
                    WHERE
                       tb.oid = t2.oid
                       AND t2.typbasetype != 0
               ) SELECT oid FROM typebases ORDER BY depth DESC LIMIT 1)

               ELSE NULL
            END)                            AS basetype,
            t.typelem                       AS elemtype,
            elem_t.typdelim                 AS elemdelim,
            COALESCE(
                range_t.rngsubtype,
                multirange_t.rngsubtype)    AS range_subtype,
            (CASE WHEN t.typtype = 'c' THEN
                (SELECT
                    array_agg(ia.atttypid ORDER BY ia.attnum)
                FROM
                    pg_attribute ia
                    INNER JOIN pg_class c
                        ON (ia.attrelid = c.oid)
                WHERE
                    ia.attnum > 0 AND NOT ia.attisdropped
                    AND c.reltype = t.oid)

                ELSE NULL
            END)                            AS attrtypoids,
            (CASE WHEN t.typtype = 'c' THEN
                (SELECT
                    array_agg(ia.attname::text ORDER BY ia.attnum)
                FROM
                    pg_attribute ia
                    INNER JOIN pg_class c
                        ON (ia.attrelid = c.oid)
                WHERE
                    ia.attnum > 0 AND NOT ia.attisdropped
                    AND c.reltype = t.oid)

                ELSE NULL
            END)                            AS attrnames
        FROM
            pg_catalog.pg_type AS t
            INNER JOIN pg_catalog.pg_namespace ns ON (
                ns.oid = t.typnamespace)
            LEFT JOIN pg_type elem_t ON (
                t.typlen = -1 AND
                t.typelem != 0 AND
                t.typelem = elem_t.oid
            )
            LEFT JOIN pg_range range_t ON (
                t.oid = range_t.rngtypid
            )
            LEFT JOIN pg_range multirange_t ON (
                t.oid = multirange_t.rngmultitypid
            )
    )
'''


INTRO_LOOKUP_TYPES = '''\
WITH RECURSIVE typeinfo_tree(
    oid, ns, name, kind, basetype, elemtype, elemdelim,
    range_subtype, attrtypoids, attrnames, depth)
AS (
    SELECT
        ti.oid, ti.ns, ti.name, ti.kind, ti.basetype,
        ti.elemtype, ti.elemdelim, ti.range_subtype,
        ti.attrtypoids, ti.attrnames, 0
    FROM
        {typeinfo} AS ti
    WHERE
        ti.oid = any($1::oid[])

    UNION ALL

    SELECT
        ti.oid, ti.ns, ti.name, ti.kind, ti.basetype,
        ti.elemtype, ti.elemdelim, ti.range_subtype,
        ti.attrtypoids, ti.attrnames, tt.depth + 1
    FROM
        {typeinfo} ti,
        typeinfo_tree tt
    WHERE
        (tt.elemtype IS NOT NULL AND ti.oid = tt.elemtype)
        OR (tt.attrtypoids IS NOT NULL AND ti.oid = any(tt.attrtypoids))
        OR (tt.range_subtype IS NOT NULL AND ti.oid = tt.range_subtype)
        OR (tt.basetype IS NOT NULL AND ti.oid = tt.basetype)
)

SELECT DISTINCT
    *,
    basetype::regtype::text AS basetype_name,
    elemtype::regtype::text AS elemtype_name,
    range_subtype::regtype::text AS range_subtype_name
FROM
    typeinfo_tree
ORDER BY
    depth DESC
'''.format(typeinfo=_TYPEINFO)


TYPE_BY_NAME = '''\
SELECT
    t.oid,
    t.typelem     AS elemtype,
    t.typtype     AS kind
FROM
    pg_catalog.pg_type AS t
    INNER JOIN pg_catalog.pg_namespace ns ON (ns.oid = t.typnamespace)
WHERE
    t.typname = $1 AND ns.nspname = $2
'''


TYPE_BY_OID = '''\
SELECT
    t.oid,
    t.typelem     AS elemtype,
    t.typtype     AS kind
FROM
    pg_catalog.pg_type AS t
WHERE
    t.oid = $1
'''


# 'b' for a base type, 'd' for a domain, 'e' for enum.
SCALAR_TYPE_KINDS = (b'b', b'd', b'e')


def is_scalar_type(typeinfo) -> bool:
    return (
        typeinfo['kind'] in SCALAR_TYPE_KINDS and
        not typeinfo['elemtype']
    )


def is_domain_type(typeinfo) -> bool:
    return typeinfo['kind'] == b'd'


def is_composite_type(typeinfo) -> bool:
    return typeinfo['kind'] == b'c'
