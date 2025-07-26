# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from enum import Enum
from typing import Final

from typing_extensions import deprecated

DB_CASSANDRA_CONSISTENCY_LEVEL: Final = "db.cassandra.consistency_level"
"""
Deprecated: Replaced by `cassandra.consistency.level`.
"""

DB_CASSANDRA_COORDINATOR_DC: Final = "db.cassandra.coordinator.dc"
"""
Deprecated: Replaced by `cassandra.coordinator.dc`.
"""

DB_CASSANDRA_COORDINATOR_ID: Final = "db.cassandra.coordinator.id"
"""
Deprecated: Replaced by `cassandra.coordinator.id`.
"""

DB_CASSANDRA_IDEMPOTENCE: Final = "db.cassandra.idempotence"
"""
Deprecated: Replaced by `cassandra.query.idempotent`.
"""

DB_CASSANDRA_PAGE_SIZE: Final = "db.cassandra.page_size"
"""
Deprecated: Replaced by `cassandra.page.size`.
"""

DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT: Final = (
    "db.cassandra.speculative_execution_count"
)
"""
Deprecated: Replaced by `cassandra.speculative_execution.count`.
"""

DB_CASSANDRA_TABLE: Final = "db.cassandra.table"
"""
Deprecated: Replaced by `db.collection.name`.
"""

DB_CLIENT_CONNECTION_POOL_NAME: Final = "db.client.connection.pool.name"
"""
The name of the connection pool; unique within the instrumented application. In case the connection pool implementation doesn't provide a name, instrumentation SHOULD use a combination of parameters that would make the name unique, for example, combining attributes `server.address`, `server.port`, and `db.namespace`, formatted as `server.address:server.port/db.namespace`. Instrumentations that generate connection pool name following different patterns SHOULD document it.
"""

DB_CLIENT_CONNECTION_STATE: Final = "db.client.connection.state"
"""
The state of a connection in the pool.
"""

DB_CLIENT_CONNECTIONS_POOL_NAME: Final = "db.client.connections.pool.name"
"""
Deprecated: Replaced by `db.client.connection.pool.name`.
"""

DB_CLIENT_CONNECTIONS_STATE: Final = "db.client.connections.state"
"""
Deprecated: Replaced by `db.client.connection.state`.
"""

DB_COLLECTION_NAME: Final = "db.collection.name"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_COLLECTION_NAME`.
"""

DB_CONNECTION_STRING: Final = "db.connection_string"
"""
Deprecated: Replaced by `server.address` and `server.port`.
"""

DB_COSMOSDB_CLIENT_ID: Final = "db.cosmosdb.client_id"
"""
Deprecated: Replaced by `azure.client.id`.
"""

DB_COSMOSDB_CONNECTION_MODE: Final = "db.cosmosdb.connection_mode"
"""
Deprecated: Replaced by `azure.cosmosdb.connection.mode`.
"""

DB_COSMOSDB_CONSISTENCY_LEVEL: Final = "db.cosmosdb.consistency_level"
"""
Deprecated: Replaced by `azure.cosmosdb.consistency.level`.
"""

DB_COSMOSDB_CONTAINER: Final = "db.cosmosdb.container"
"""
Deprecated: Replaced by `db.collection.name`.
"""

DB_COSMOSDB_OPERATION_TYPE: Final = "db.cosmosdb.operation_type"
"""
Deprecated: Removed, no replacement at this time.
"""

DB_COSMOSDB_REGIONS_CONTACTED: Final = "db.cosmosdb.regions_contacted"
"""
Deprecated: Replaced by `azure.cosmosdb.operation.contacted_regions`.
"""

DB_COSMOSDB_REQUEST_CHARGE: Final = "db.cosmosdb.request_charge"
"""
Deprecated: Replaced by `azure.cosmosdb.operation.request_charge`.
"""

DB_COSMOSDB_REQUEST_CONTENT_LENGTH: Final = (
    "db.cosmosdb.request_content_length"
)
"""
Deprecated: Replaced by `azure.cosmosdb.request.body.size`.
"""

DB_COSMOSDB_STATUS_CODE: Final = "db.cosmosdb.status_code"
"""
Deprecated: Replaced by `db.response.status_code`.
"""

DB_COSMOSDB_SUB_STATUS_CODE: Final = "db.cosmosdb.sub_status_code"
"""
Deprecated: Replaced by `azure.cosmosdb.response.sub_status_code`.
"""

DB_ELASTICSEARCH_CLUSTER_NAME: Final = "db.elasticsearch.cluster.name"
"""
Deprecated: Replaced by `db.namespace`.
"""

DB_ELASTICSEARCH_NODE_NAME: Final = "db.elasticsearch.node.name"
"""
Deprecated: Replaced by `elasticsearch.node.name`.
"""

DB_ELASTICSEARCH_PATH_PARTS_TEMPLATE: Final = "db.elasticsearch.path_parts"
"""
Deprecated: Replaced by `db.operation.parameter`.
"""

DB_INSTANCE_ID: Final = "db.instance.id"
"""
Deprecated: Removed, no general replacement at this time. For Elasticsearch, use `db.elasticsearch.node.name` instead.
"""

DB_JDBC_DRIVER_CLASSNAME: Final = "db.jdbc.driver_classname"
"""
Deprecated: Removed, no replacement at this time.
"""

DB_MONGODB_COLLECTION: Final = "db.mongodb.collection"
"""
Deprecated: Replaced by `db.collection.name`.
"""

DB_MSSQL_INSTANCE_NAME: Final = "db.mssql.instance_name"
"""
Deprecated: Removed, no replacement at this time.
"""

DB_NAME: Final = "db.name"
"""
Deprecated: Replaced by `db.namespace`.
"""

DB_NAMESPACE: Final = "db.namespace"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_NAMESPACE`.
"""

DB_OPERATION: Final = "db.operation"
"""
Deprecated: Replaced by `db.operation.name`.
"""

DB_OPERATION_BATCH_SIZE: Final = "db.operation.batch.size"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_OPERATION_BATCH_SIZE`.
"""

DB_OPERATION_NAME: Final = "db.operation.name"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_OPERATION_NAME`.
"""

DB_OPERATION_PARAMETER_TEMPLATE: Final = "db.operation.parameter"
"""
A database operation parameter, with `<key>` being the parameter name, and the attribute value being a string representation of the parameter value.
Note: For example, a client-side maximum number of rows to read from the database
MAY be recorded as the `db.operation.parameter.max_rows` attribute.

`db.query.text` parameters SHOULD be captured using `db.query.parameter.<key>`
instead of `db.operation.parameter.<key>`.
"""

DB_QUERY_PARAMETER_TEMPLATE: Final = "db.query.parameter"
"""
A database query parameter, with `<key>` being the parameter name, and the attribute value being a string representation of the parameter value.
Note: If a query parameter has no name and instead is referenced only by index,
then `<key>` SHOULD be the 0-based index.

`db.query.parameter.<key>` SHOULD match
up with the parameterized placeholders present in `db.query.text`.

`db.query.parameter.<key>` SHOULD NOT be captured on batch operations.

Examples:

- For a query `SELECT * FROM users where username =  %s` with the parameter `"jdoe"`,
  the attribute `db.query.parameter.0` SHOULD be set to `"jdoe"`.

- For a query `"SELECT * FROM users WHERE username = %(username)s;` with parameter
  `username = "jdoe"`, the attribute `db.query.parameter.username` SHOULD be set to `"jdoe"`.
"""

DB_QUERY_SUMMARY: Final = "db.query.summary"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_QUERY_SUMMARY`.
"""

DB_QUERY_TEXT: Final = "db.query.text"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_QUERY_TEXT`.
"""

DB_REDIS_DATABASE_INDEX: Final = "db.redis.database_index"
"""
Deprecated: Replaced by `db.namespace`.
"""

DB_RESPONSE_RETURNED_ROWS: Final = "db.response.returned_rows"
"""
Number of rows returned by the operation.
"""

DB_RESPONSE_STATUS_CODE: Final = "db.response.status_code"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_RESPONSE_STATUS_CODE`.
"""

DB_SQL_TABLE: Final = "db.sql.table"
"""
Deprecated: Replaced by `db.collection.name`, but only if not extracting the value from `db.query.text`.
"""

DB_STATEMENT: Final = "db.statement"
"""
Deprecated: Replaced by `db.query.text`.
"""

DB_STORED_PROCEDURE_NAME: Final = "db.stored_procedure.name"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_STORED_PROCEDURE_NAME`.
"""

DB_SYSTEM: Final = "db.system"
"""
Deprecated: Replaced by `db.system.name`.
"""

DB_SYSTEM_NAME: Final = "db.system.name"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DB_SYSTEM_NAME`.
"""

DB_USER: Final = "db.user"
"""
Deprecated: Removed, no replacement at this time.
"""


@deprecated(
    "The attribute db.cassandra.consistency_level is deprecated - Replaced by `cassandra.consistency.level`"
)
class DbCassandraConsistencyLevelValues(Enum):
    ALL = "all"
    """all."""
    EACH_QUORUM = "each_quorum"
    """each_quorum."""
    QUORUM = "quorum"
    """quorum."""
    LOCAL_QUORUM = "local_quorum"
    """local_quorum."""
    ONE = "one"
    """one."""
    TWO = "two"
    """two."""
    THREE = "three"
    """three."""
    LOCAL_ONE = "local_one"
    """local_one."""
    ANY = "any"
    """any."""
    SERIAL = "serial"
    """serial."""
    LOCAL_SERIAL = "local_serial"
    """local_serial."""


class DbClientConnectionStateValues(Enum):
    IDLE = "idle"
    """idle."""
    USED = "used"
    """used."""


@deprecated(
    "The attribute db.client.connections.state is deprecated - Replaced by `db.client.connection.state`"
)
class DbClientConnectionsStateValues(Enum):
    IDLE = "idle"
    """idle."""
    USED = "used"
    """used."""


@deprecated(
    "The attribute db.cosmosdb.connection_mode is deprecated - Replaced by `azure.cosmosdb.connection.mode`"
)
class DbCosmosdbConnectionModeValues(Enum):
    GATEWAY = "gateway"
    """Gateway (HTTP) connection."""
    DIRECT = "direct"
    """Direct connection."""


@deprecated(
    "The attribute db.cosmosdb.consistency_level is deprecated - Replaced by `azure.cosmosdb.consistency.level`"
)
class DbCosmosdbConsistencyLevelValues(Enum):
    STRONG = "Strong"
    """strong."""
    BOUNDED_STALENESS = "BoundedStaleness"
    """bounded_staleness."""
    SESSION = "Session"
    """session."""
    EVENTUAL = "Eventual"
    """eventual."""
    CONSISTENT_PREFIX = "ConsistentPrefix"
    """consistent_prefix."""


@deprecated(
    "The attribute db.cosmosdb.operation_type is deprecated - Removed, no replacement at this time"
)
class DbCosmosdbOperationTypeValues(Enum):
    BATCH = "batch"
    """batch."""
    CREATE = "create"
    """create."""
    DELETE = "delete"
    """delete."""
    EXECUTE = "execute"
    """execute."""
    EXECUTE_JAVASCRIPT = "execute_javascript"
    """execute_javascript."""
    INVALID = "invalid"
    """invalid."""
    HEAD = "head"
    """head."""
    HEAD_FEED = "head_feed"
    """head_feed."""
    PATCH = "patch"
    """patch."""
    QUERY = "query"
    """query."""
    QUERY_PLAN = "query_plan"
    """query_plan."""
    READ = "read"
    """read."""
    READ_FEED = "read_feed"
    """read_feed."""
    REPLACE = "replace"
    """replace."""
    UPSERT = "upsert"
    """upsert."""


@deprecated(
    "The attribute db.system is deprecated - Replaced by `db.system.name`"
)
class DbSystemValues(Enum):
    OTHER_SQL = "other_sql"
    """Some other SQL database. Fallback only. See notes."""
    ADABAS = "adabas"
    """Adabas (Adaptable Database System)."""
    CACHE = "cache"
    """Deprecated: Replaced by `intersystems_cache`."""
    INTERSYSTEMS_CACHE = "intersystems_cache"
    """InterSystems Caché."""
    CASSANDRA = "cassandra"
    """Apache Cassandra."""
    CLICKHOUSE = "clickhouse"
    """ClickHouse."""
    CLOUDSCAPE = "cloudscape"
    """Deprecated: Replaced by `other_sql`."""
    COCKROACHDB = "cockroachdb"
    """CockroachDB."""
    COLDFUSION = "coldfusion"
    """Deprecated: Removed."""
    COSMOSDB = "cosmosdb"
    """Microsoft Azure Cosmos DB."""
    COUCHBASE = "couchbase"
    """Couchbase."""
    COUCHDB = "couchdb"
    """CouchDB."""
    DB2 = "db2"
    """IBM Db2."""
    DERBY = "derby"
    """Apache Derby."""
    DYNAMODB = "dynamodb"
    """Amazon DynamoDB."""
    EDB = "edb"
    """EnterpriseDB."""
    ELASTICSEARCH = "elasticsearch"
    """Elasticsearch."""
    FILEMAKER = "filemaker"
    """FileMaker."""
    FIREBIRD = "firebird"
    """Firebird."""
    FIRSTSQL = "firstsql"
    """Deprecated: Replaced by `other_sql`."""
    GEODE = "geode"
    """Apache Geode."""
    H2 = "h2"
    """H2."""
    HANADB = "hanadb"
    """SAP HANA."""
    HBASE = "hbase"
    """Apache HBase."""
    HIVE = "hive"
    """Apache Hive."""
    HSQLDB = "hsqldb"
    """HyperSQL DataBase."""
    INFLUXDB = "influxdb"
    """InfluxDB."""
    INFORMIX = "informix"
    """Informix."""
    INGRES = "ingres"
    """Ingres."""
    INSTANTDB = "instantdb"
    """InstantDB."""
    INTERBASE = "interbase"
    """InterBase."""
    MARIADB = "mariadb"
    """MariaDB."""
    MAXDB = "maxdb"
    """SAP MaxDB."""
    MEMCACHED = "memcached"
    """Memcached."""
    MONGODB = "mongodb"
    """MongoDB."""
    MSSQL = "mssql"
    """Microsoft SQL Server."""
    MSSQLCOMPACT = "mssqlcompact"
    """Deprecated: Removed, use `other_sql` instead."""
    MYSQL = "mysql"
    """MySQL."""
    NEO4J = "neo4j"
    """Neo4j."""
    NETEZZA = "netezza"
    """Netezza."""
    OPENSEARCH = "opensearch"
    """OpenSearch."""
    ORACLE = "oracle"
    """Oracle Database."""
    PERVASIVE = "pervasive"
    """Pervasive PSQL."""
    POINTBASE = "pointbase"
    """PointBase."""
    POSTGRESQL = "postgresql"
    """PostgreSQL."""
    PROGRESS = "progress"
    """Progress Database."""
    REDIS = "redis"
    """Redis."""
    REDSHIFT = "redshift"
    """Amazon Redshift."""
    SPANNER = "spanner"
    """Cloud Spanner."""
    SQLITE = "sqlite"
    """SQLite."""
    SYBASE = "sybase"
    """Sybase."""
    TERADATA = "teradata"
    """Teradata."""
    TRINO = "trino"
    """Trino."""
    VERTICA = "vertica"
    """Vertica."""


@deprecated(
    "Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DbSystemNameValues`."
)
class DbSystemNameValues(Enum):
    OTHER_SQL = "other_sql"
    """Some other SQL database. Fallback only."""
    SOFTWAREAG_ADABAS = "softwareag.adabas"
    """[Adabas (Adaptable Database System)](https://documentation.softwareag.com/?pf=adabas)."""
    ACTIAN_INGRES = "actian.ingres"
    """[Actian Ingres](https://www.actian.com/databases/ingres/)."""
    AWS_DYNAMODB = "aws.dynamodb"
    """[Amazon DynamoDB](https://aws.amazon.com/pm/dynamodb/)."""
    AWS_REDSHIFT = "aws.redshift"
    """[Amazon Redshift](https://aws.amazon.com/redshift/)."""
    AZURE_COSMOSDB = "azure.cosmosdb"
    """[Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db)."""
    INTERSYSTEMS_CACHE = "intersystems.cache"
    """[InterSystems Caché](https://www.intersystems.com/products/cache/)."""
    CASSANDRA = "cassandra"
    """[Apache Cassandra](https://cassandra.apache.org/)."""
    CLICKHOUSE = "clickhouse"
    """[ClickHouse](https://clickhouse.com/)."""
    COCKROACHDB = "cockroachdb"
    """[CockroachDB](https://www.cockroachlabs.com/)."""
    COUCHBASE = "couchbase"
    """[Couchbase](https://www.couchbase.com/)."""
    COUCHDB = "couchdb"
    """[Apache CouchDB](https://couchdb.apache.org/)."""
    DERBY = "derby"
    """[Apache Derby](https://db.apache.org/derby/)."""
    ELASTICSEARCH = "elasticsearch"
    """[Elasticsearch](https://www.elastic.co/elasticsearch)."""
    FIREBIRDSQL = "firebirdsql"
    """[Firebird](https://www.firebirdsql.org/)."""
    GCP_SPANNER = "gcp.spanner"
    """[Google Cloud Spanner](https://cloud.google.com/spanner)."""
    GEODE = "geode"
    """[Apache Geode](https://geode.apache.org/)."""
    H2DATABASE = "h2database"
    """[H2 Database](https://h2database.com/)."""
    HBASE = "hbase"
    """[Apache HBase](https://hbase.apache.org/)."""
    HIVE = "hive"
    """[Apache Hive](https://hive.apache.org/)."""
    HSQLDB = "hsqldb"
    """[HyperSQL Database](https://hsqldb.org/)."""
    IBM_DB2 = "ibm.db2"
    """[IBM Db2](https://www.ibm.com/db2)."""
    IBM_INFORMIX = "ibm.informix"
    """[IBM Informix](https://www.ibm.com/products/informix)."""
    IBM_NETEZZA = "ibm.netezza"
    """[IBM Netezza](https://www.ibm.com/products/netezza)."""
    INFLUXDB = "influxdb"
    """[InfluxDB](https://www.influxdata.com/)."""
    INSTANTDB = "instantdb"
    """[Instant](https://www.instantdb.com/)."""
    MARIADB = "mariadb"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DbSystemNameValues.MARIADB`."""
    MEMCACHED = "memcached"
    """[Memcached](https://memcached.org/)."""
    MONGODB = "mongodb"
    """[MongoDB](https://www.mongodb.com/)."""
    MICROSOFT_SQL_SERVER = "microsoft.sql_server"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DbSystemNameValues.MICROSOFT_SQL_SERVER`."""
    MYSQL = "mysql"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DbSystemNameValues.MYSQL`."""
    NEO4J = "neo4j"
    """[Neo4j](https://neo4j.com/)."""
    OPENSEARCH = "opensearch"
    """[OpenSearch](https://opensearch.org/)."""
    ORACLE_DB = "oracle.db"
    """[Oracle Database](https://www.oracle.com/database/)."""
    POSTGRESQL = "postgresql"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.db_attributes.DbSystemNameValues.POSTGRESQL`."""
    REDIS = "redis"
    """[Redis](https://redis.io/)."""
    SAP_HANA = "sap.hana"
    """[SAP HANA](https://www.sap.com/products/technology-platform/hana/what-is-sap-hana.html)."""
    SAP_MAXDB = "sap.maxdb"
    """[SAP MaxDB](https://maxdb.sap.com/)."""
    SQLITE = "sqlite"
    """[SQLite](https://www.sqlite.org/)."""
    TERADATA = "teradata"
    """[Teradata](https://www.teradata.com/)."""
    TRINO = "trino"
    """[Trino](https://trino.io/)."""
