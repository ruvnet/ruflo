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

# pylint: disable=too-many-lines

from enum import Enum

from typing_extensions import deprecated


@deprecated(
    "Use attributes defined in the :py:const:`opentelemetry.semconv.attributes` and :py:const:`opentelemetry.semconv._incubating.attributes` modules instead. Deprecated since version 1.25.0.",
)
class SpanAttributes:
    SCHEMA_URL = "https://opentelemetry.io/schemas/1.21.0"
    """
    The URL of the OpenTelemetry schema for these keys and values.
    """
    CLIENT_ADDRESS = "client.address"
    """
    Client address - unix domain socket name, IPv4 or IPv6 address.
    Note: When observed from the server side, and when communicating through an intermediary, `client.address` SHOULD represent client address behind any intermediaries (e.g. proxies) if it's available.
    """

    CLIENT_PORT = "client.port"
    """
    Client port number.
    Note: When observed from the server side, and when communicating through an intermediary, `client.port` SHOULD represent client port behind any intermediaries (e.g. proxies) if it's available.
    """

    CLIENT_SOCKET_ADDRESS = "client.socket.address"
    """
    Immediate client peer address - unix domain socket name, IPv4 or IPv6 address.
    """

    CLIENT_SOCKET_PORT = "client.socket.port"
    """
    Immediate client peer port number.
    """

    HTTP_METHOD = "http.method"
    """
    Deprecated, use `http.request.method` instead.
    """

    HTTP_STATUS_CODE = "http.status_code"
    """
    Deprecated, use `http.response.status_code` instead.
    """

    HTTP_SCHEME = "http.scheme"
    """
    Deprecated, use `url.scheme` instead.
    """

    HTTP_URL = "http.url"
    """
    Deprecated, use `url.full` instead.
    """

    HTTP_TARGET = "http.target"
    """
    Deprecated, use `url.path` and `url.query` instead.
    """

    HTTP_REQUEST_CONTENT_LENGTH = "http.request_content_length"
    """
    Deprecated, use `http.request.body.size` instead.
    """

    HTTP_RESPONSE_CONTENT_LENGTH = "http.response_content_length"
    """
    Deprecated, use `http.response.body.size` instead.
    """

    NET_SOCK_PEER_NAME = "net.sock.peer.name"
    """
    Deprecated, use `server.socket.domain` on client spans.
    """

    NET_SOCK_PEER_ADDR = "net.sock.peer.addr"
    """
    Deprecated, use `server.socket.address` on client spans and `client.socket.address` on server spans.
    """

    NET_SOCK_PEER_PORT = "net.sock.peer.port"
    """
    Deprecated, use `server.socket.port` on client spans and `client.socket.port` on server spans.
    """

    NET_PEER_NAME = "net.peer.name"
    """
    Deprecated, use `server.address` on client spans and `client.address` on server spans.
    """

    NET_PEER_PORT = "net.peer.port"
    """
    Deprecated, use `server.port` on client spans and `client.port` on server spans.
    """

    NET_HOST_NAME = "net.host.name"
    """
    Deprecated, use `server.address`.
    """

    NET_HOST_PORT = "net.host.port"
    """
    Deprecated, use `server.port`.
    """

    NET_SOCK_HOST_ADDR = "net.sock.host.addr"
    """
    Deprecated, use `server.socket.address`.
    """

    NET_SOCK_HOST_PORT = "net.sock.host.port"
    """
    Deprecated, use `server.socket.port`.
    """

    NET_TRANSPORT = "net.transport"
    """
    Deprecated, use `network.transport`.
    """

    NET_PROTOCOL_NAME = "net.protocol.name"
    """
    Deprecated, use `network.protocol.name`.
    """

    NET_PROTOCOL_VERSION = "net.protocol.version"
    """
    Deprecated, use `network.protocol.version`.
    """

    NET_SOCK_FAMILY = "net.sock.family"
    """
    Deprecated, use `network.transport` and `network.type`.
    """

    DESTINATION_DOMAIN = "destination.domain"
    """
    The domain name of the destination system.
    Note: This value may be a host name, a fully qualified domain name, or another host naming format.
    """

    DESTINATION_ADDRESS = "destination.address"
    """
    Peer address, for example IP address or UNIX socket name.
    """

    DESTINATION_PORT = "destination.port"
    """
    Peer port number.
    """

    EXCEPTION_TYPE = "exception.type"
    """
    The type of the exception (its fully-qualified class name, if applicable). The dynamic type of the exception should be preferred over the static type in languages that support it.
    """

    EXCEPTION_MESSAGE = "exception.message"
    """
    The exception message.
    """

    EXCEPTION_STACKTRACE = "exception.stacktrace"
    """
    A stacktrace as a string in the natural representation for the language runtime. The representation is to be determined and documented by each language SIG.
    """

    HTTP_REQUEST_METHOD = "http.request.method"
    """
    HTTP request method.
    Note: HTTP request method value SHOULD be "known" to the instrumentation.
    By default, this convention defines "known" methods as the ones listed in [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-methods)
    and the PATCH method defined in [RFC5789](https://www.rfc-editor.org/rfc/rfc5789.html).

    If the HTTP request method is not known to instrumentation, it MUST set the `http.request.method` attribute to `_OTHER` and, except if reporting a metric, MUST
    set the exact method received in the request line as value of the `http.request.method_original` attribute.

    If the HTTP instrumentation could end up converting valid HTTP request methods to `_OTHER`, then it MUST provide a way to override
    the list of known HTTP methods. If this override is done via environment variable, then the environment variable MUST be named
    OTEL_INSTRUMENTATION_HTTP_KNOWN_METHODS and support a comma-separated list of case-sensitive known HTTP methods
    (this list MUST be a full override of the default known method, it is not a list of known methods in addition to the defaults).

    HTTP method names are case-sensitive and `http.request.method` attribute value MUST match a known HTTP method name exactly.
    Instrumentations for specific web frameworks that consider HTTP methods to be case insensitive, SHOULD populate a canonical equivalent.
    Tracing instrumentations that do so, MUST also set `http.request.method_original` to the original value.
    """

    HTTP_RESPONSE_STATUS_CODE = "http.response.status_code"
    """
    [HTTP response status code](https://tools.ietf.org/html/rfc7231#section-6).
    """

    NETWORK_PROTOCOL_NAME = "network.protocol.name"
    """
    [OSI Application Layer](https://osi-model.com/application-layer/) or non-OSI equivalent. The value SHOULD be normalized to lowercase.
    """

    NETWORK_PROTOCOL_VERSION = "network.protocol.version"
    """
    Version of the application layer protocol used. See note below.
    Note: `network.protocol.version` refers to the version of the protocol used and might be different from the protocol client's version. If the HTTP client used has a version of `0.27.2`, but sends HTTP version `1.1`, this attribute should be set to `1.1`.
    """

    SERVER_ADDRESS = "server.address"
    """
    Host identifier of the ["URI origin"](https://www.rfc-editor.org/rfc/rfc9110.html#name-uri-origin) HTTP request is sent to.
    Note: Determined by using the first of the following that applies

    - Host identifier of the [request target](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)
      if it's sent in absolute-form
    - Host identifier of the `Host` header

    SHOULD NOT be set if capturing it would require an extra DNS lookup.
    """

    SERVER_PORT = "server.port"
    """
    Port identifier of the ["URI origin"](https://www.rfc-editor.org/rfc/rfc9110.html#name-uri-origin) HTTP request is sent to.
    Note: When [request target](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) is absolute URI, `server.port` MUST match URI port identifier, otherwise it MUST match `Host` header port identifier.
    """

    HTTP_ROUTE = "http.route"
    """
    The matched route (path template in the format used by the respective server framework). See note below.
    Note: MUST NOT be populated when this is not supported by the HTTP server framework as the route attribute should have low-cardinality and the URI path can NOT substitute it.
    SHOULD include the [application root](/docs/http/http-spans.md#http-server-definitions) if there is one.
    """

    URL_SCHEME = "url.scheme"
    """
    The [URI scheme](https://www.rfc-editor.org/rfc/rfc3986#section-3.1) component identifying the used protocol.
    """

    EVENT_NAME = "event.name"
    """
    The name identifies the event.
    """

    EVENT_DOMAIN = "event.domain"
    """
    The domain identifies the business context for the events.
    Note: Events across different domains may have same `event.name`, yet be
    unrelated events.
    """

    LOG_RECORD_UID = "log.record.uid"
    """
    A unique identifier for the Log Record.
    Note: If an id is provided, other log records with the same id will be considered duplicates and can be removed safely. This means, that two distinguishable log records MUST have different values.
    The id MAY be an [Universally Unique Lexicographically Sortable Identifier (ULID)](https://github.com/ulid/spec), but other identifiers (e.g. UUID) may be used as needed.
    """

    FEATURE_FLAG_KEY = "feature_flag.key"
    """
    The unique identifier of the feature flag.
    """

    FEATURE_FLAG_PROVIDER_NAME = "feature_flag.provider_name"
    """
    The name of the service provider that performs the flag evaluation.
    """

    FEATURE_FLAG_VARIANT = "feature_flag.variant"
    """
    SHOULD be a semantic identifier for a value. If one is unavailable, a stringified version of the value can be used.
    Note: A semantic identifier, commonly referred to as a variant, provides a means
    for referring to a value without including the value itself. This can
    provide additional context for understanding the meaning behind a value.
    For example, the variant `red` maybe be used for the value `#c05543`.

    A stringified version of the value can be used in situations where a
    semantic identifier is unavailable. String representation of the value
    should be determined by the implementer.
    """

    LOG_IOSTREAM = "log.iostream"
    """
    The stream associated with the log. See below for a list of well-known values.
    """

    LOG_FILE_NAME = "log.file.name"
    """
    The basename of the file.
    """

    LOG_FILE_PATH = "log.file.path"
    """
    The full path to the file.
    """

    LOG_FILE_NAME_RESOLVED = "log.file.name_resolved"
    """
    The basename of the file, with symlinks resolved.
    """

    LOG_FILE_PATH_RESOLVED = "log.file.path_resolved"
    """
    The full path to the file, with symlinks resolved.
    """

    SERVER_SOCKET_ADDRESS = "server.socket.address"
    """
    Physical server IP address or Unix socket address. If set from the client, should simply use the socket's peer address, and not attempt to find any actual server IP (i.e., if set from client, this may represent some proxy server instead of the logical server).
    """

    POOL = "pool"
    """
    Name of the buffer pool.
    Note: Pool names are generally obtained via [BufferPoolMXBean#getName()](https://docs.oracle.com/en/java/javase/11/docs/api/java.management/java/lang/management/BufferPoolMXBean.html#getName()).
    """

    TYPE = "type"
    """
    The type of memory.
    """

    SERVER_SOCKET_DOMAIN = "server.socket.domain"
    """
    The domain name of an immediate peer.
    Note: Typically observed from the client side, and represents a proxy or other intermediary domain name.
    """

    SERVER_SOCKET_PORT = "server.socket.port"
    """
    Physical server port.
    """

    SOURCE_DOMAIN = "source.domain"
    """
    The domain name of the source system.
    Note: This value may be a host name, a fully qualified domain name, or another host naming format.
    """

    SOURCE_ADDRESS = "source.address"
    """
    Source address, for example IP address or Unix socket name.
    """

    SOURCE_PORT = "source.port"
    """
    Source port number.
    """

    AWS_LAMBDA_INVOKED_ARN = "aws.lambda.invoked_arn"
    """
    The full invoked ARN as provided on the `Context` passed to the function (`Lambda-Runtime-Invoked-Function-Arn` header on the `/runtime/invocation/next` applicable).
    Note: This may be different from `cloud.resource_id` if an alias is involved.
    """

    CLOUDEVENTS_EVENT_ID = "cloudevents.event_id"
    """
    The [event_id](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#id) uniquely identifies the event.
    """

    CLOUDEVENTS_EVENT_SOURCE = "cloudevents.event_source"
    """
    The [source](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#source-1) identifies the context in which an event happened.
    """

    CLOUDEVENTS_EVENT_SPEC_VERSION = "cloudevents.event_spec_version"
    """
    The [version of the CloudEvents specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#specversion) which the event uses.
    """

    CLOUDEVENTS_EVENT_TYPE = "cloudevents.event_type"
    """
    The [event_type](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#type) contains a value describing the type of event related to the originating occurrence.
    """

    CLOUDEVENTS_EVENT_SUBJECT = "cloudevents.event_subject"
    """
    The [subject](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#subject) of the event in the context of the event producer (identified by source).
    """

    OPENTRACING_REF_TYPE = "opentracing.ref_type"
    """
    Parent-child Reference type.
    Note: The causal relationship between a child Span and a parent Span.
    """

    DB_SYSTEM = "db.system"
    """
    An identifier for the database management system (DBMS) product being used. See below for a list of well-known identifiers.
    """

    DB_CONNECTION_STRING = "db.connection_string"
    """
    The connection string used to connect to the database. It is recommended to remove embedded credentials.
    """

    DB_USER = "db.user"
    """
    Username for accessing the database.
    """

    DB_JDBC_DRIVER_CLASSNAME = "db.jdbc.driver_classname"
    """
    The fully-qualified class name of the [Java Database Connectivity (JDBC)](https://docs.oracle.com/javase/8/docs/technotes/guides/jdbc/) driver used to connect.
    """

    DB_NAME = "db.name"
    """
    This attribute is used to report the name of the database being accessed. For commands that switch the database, this should be set to the target database (even if the command fails).
    Note: In some SQL databases, the database name to be used is called "schema name". In case there are multiple layers that could be considered for database name (e.g. Oracle instance name and schema name), the database name to be used is the more specific layer (e.g. Oracle schema name).
    """

    DB_STATEMENT = "db.statement"
    """
    The database statement being executed.
    """

    DB_OPERATION = "db.operation"
    """
    The name of the operation being executed, e.g. the [MongoDB command name](https://docs.mongodb.com/manual/reference/command/#database-operations) such as `findAndModify`, or the SQL keyword.
    Note: When setting this to an SQL keyword, it is not recommended to attempt any client-side parsing of `db.statement` just to get this property, but it should be set if the operation name is provided by the library being instrumented. If the SQL statement has an ambiguous operation, or performs more than one operation, this value may be omitted.
    """

    NETWORK_TRANSPORT = "network.transport"
    """
    [OSI Transport Layer](https://osi-model.com/transport-layer/) or [Inter-process Communication method](https://en.wikipedia.org/wiki/Inter-process_communication). The value SHOULD be normalized to lowercase.
    """

    NETWORK_TYPE = "network.type"
    """
    [OSI Network Layer](https://osi-model.com/network-layer/) or non-OSI equivalent. The value SHOULD be normalized to lowercase.
    """

    DB_MSSQL_INSTANCE_NAME = "db.mssql.instance_name"
    """
    The Microsoft SQL Server [instance name](https://docs.microsoft.com/en-us/sql/connect/jdbc/building-the-connection-url?view=sql-server-ver15) connecting to. This name is used to determine the port of a named instance.
    Note: If setting a `db.mssql.instance_name`, `server.port` is no longer required (but still recommended if non-standard).
    """

    DB_CASSANDRA_PAGE_SIZE = "db.cassandra.page_size"
    """
    The fetch size used for paging, i.e. how many rows will be returned at once.
    """

    DB_CASSANDRA_CONSISTENCY_LEVEL = "db.cassandra.consistency_level"
    """
    The consistency level of the query. Based on consistency values from [CQL](https://docs.datastax.com/en/cassandra-oss/3.0/cassandra/dml/dmlConfigConsistency.html).
    """

    DB_CASSANDRA_TABLE = "db.cassandra.table"
    """
    The name of the primary table that the operation is acting upon, including the keyspace name (if applicable).
    Note: This mirrors the db.sql.table attribute but references cassandra rather than sql. It is not recommended to attempt any client-side parsing of `db.statement` just to get this property, but it should be set if it is provided by the library being instrumented. If the operation is acting upon an anonymous table, or more than one table, this value MUST NOT be set.
    """

    DB_CASSANDRA_IDEMPOTENCE = "db.cassandra.idempotence"
    """
    Whether or not the query is idempotent.
    """

    DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = (
        "db.cassandra.speculative_execution_count"
    )
    """
    The number of times a query was speculatively executed. Not set or `0` if the query was not executed speculatively.
    """

    DB_CASSANDRA_COORDINATOR_ID = "db.cassandra.coordinator.id"
    """
    The ID of the coordinating node for a query.
    """

    DB_CASSANDRA_COORDINATOR_DC = "db.cassandra.coordinator.dc"
    """
    The data center of the coordinating node for a query.
    """

    DB_REDIS_DATABASE_INDEX = "db.redis.database_index"
    """
    The index of the database being accessed as used in the [`SELECT` command](https://redis.io/commands/select), provided as an integer. To be used instead of the generic `db.name` attribute.
    """

    DB_MONGODB_COLLECTION = "db.mongodb.collection"
    """
    The collection being accessed within the database stated in `db.name`.
    """

    URL_FULL = "url.full"
    """
    Absolute URL describing a network resource according to [RFC3986](https://www.rfc-editor.org/rfc/rfc3986).
    Note: For network calls, URL usually has `scheme://host[:port][path][?query][#fragment]` format, where the fragment is not transmitted over HTTP, but if it is known, it should be included nevertheless.
    `url.full` MUST NOT contain credentials passed via URL in form of `https://username:password@www.example.com/`. In such case username and password should be redacted and attribute's value should be `https://REDACTED:REDACTED@www.example.com/`.
    `url.full` SHOULD capture the absolute URL when it is available (or can be reconstructed) and SHOULD NOT be validated or modified except for sanitizing purposes.
    """

    DB_SQL_TABLE = "db.sql.table"
    """
    The name of the primary table that the operation is acting upon, including the database name (if applicable).
    Note: It is not recommended to attempt any client-side parsing of `db.statement` just to get this property, but it should be set if it is provided by the library being instrumented. If the operation is acting upon an anonymous table, or more than one table, this value MUST NOT be set.
    """

    DB_COSMOSDB_CLIENT_ID = "db.cosmosdb.client_id"
    """
    Unique Cosmos client instance id.
    """

    DB_COSMOSDB_OPERATION_TYPE = "db.cosmosdb.operation_type"
    """
    CosmosDB Operation Type.
    """

    USER_AGENT_ORIGINAL = "user_agent.original"
    """
    Full user-agent string is generated by Cosmos DB SDK.
    Note: The user-agent value is generated by SDK which is a combination of<br> `sdk_version` : Current version of SDK. e.g. 'cosmos-netstandard-sdk/3.23.0'<br> `direct_pkg_version` : Direct package version used by Cosmos DB SDK. e.g. '3.23.1'<br> `number_of_client_instances` : Number of cosmos client instances created by the application. e.g. '1'<br> `type_of_machine_architecture` : Machine architecture. e.g. 'X64'<br> `operating_system` : Operating System. e.g. 'Linux 5.4.0-1098-azure 104 18'<br> `runtime_framework` : Runtime Framework. e.g. '.NET Core 3.1.32'<br> `failover_information` : Generated key to determine if region failover enabled.
       Format Reg-{D (Disabled discovery)}-S(application region)|L(List of preferred regions)|N(None, user did not configure it).
       Default value is "NS".
    """

    DB_COSMOSDB_CONNECTION_MODE = "db.cosmosdb.connection_mode"
    """
    Cosmos client connection mode.
    """

    DB_COSMOSDB_CONTAINER = "db.cosmosdb.container"
    """
    Cosmos DB container name.
    """

    DB_COSMOSDB_REQUEST_CONTENT_LENGTH = "db.cosmosdb.request_content_length"
    """
    Request payload size in bytes.
    """

    DB_COSMOSDB_STATUS_CODE = "db.cosmosdb.status_code"
    """
    Cosmos DB status code.
    """

    DB_COSMOSDB_SUB_STATUS_CODE = "db.cosmosdb.sub_status_code"
    """
    Cosmos DB sub status code.
    """

    DB_COSMOSDB_REQUEST_CHARGE = "db.cosmosdb.request_charge"
    """
    RU consumed for that operation.
    """

    OTEL_STATUS_CODE = "otel.status_code"
    """
    Name of the code, either "OK" or "ERROR". MUST NOT be set if the status code is UNSET.
    """

    OTEL_STATUS_DESCRIPTION = "otel.status_description"
    """
    Description of the Status if it has a value, otherwise not set.
    """

    FAAS_TRIGGER = "faas.trigger"
    """
    Type of the trigger which caused this function invocation.
    Note: For the server/consumer span on the incoming side,
    `faas.trigger` MUST be set.

    Clients invoking FaaS instances usually cannot set `faas.trigger`,
    since they would typically need to look in the payload to determine
    the event type. If clients set it, it should be the same as the
    trigger that corresponding incoming would have (i.e., this has
    nothing to do with the underlying transport used to make the API
    call to invoke the lambda, which is often HTTP).
    """

    FAAS_INVOCATION_ID = "faas.invocation_id"
    """
    The invocation ID of the current function invocation.
    """

    CLOUD_RESOURCE_ID = "cloud.resource_id"
    """
    Cloud provider-specific native identifier of the monitored cloud resource (e.g. an [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) on AWS, a [fully qualified resource ID](https://learn.microsoft.com/en-us/rest/api/resources/resources/get-by-id) on Azure, a [full resource name](https://cloud.google.com/apis/design/resource_names#full_resource_name) on GCP).
    Note: On some cloud providers, it may not be possible to determine the full ID at startup,
    so it may be necessary to set `cloud.resource_id` as a span attribute instead.

    The exact value to use for `cloud.resource_id` depends on the cloud provider.
    The following well-known definitions MUST be used if you set this attribute and they apply:

    * **AWS Lambda:** The function [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html).
      Take care not to use the "invoked ARN" directly but replace any
      [alias suffix](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
      with the resolved function version, as the same runtime instance may be invokable with
      multiple different aliases.
    * **GCP:** The [URI of the resource](https://cloud.google.com/iam/docs/full-resource-names)
    * **Azure:** The [Fully Qualified Resource ID](https://docs.microsoft.com/en-us/rest/api/resources/resources/get-by-id) of the invoked function,
      *not* the function app, having the form
      `/subscriptions/<SUBSCIPTION_GUID>/resourceGroups/<RG>/providers/Microsoft.Web/sites/<FUNCAPP>/functions/<FUNC>`.
      This means that a span attribute MUST be used, as an Azure function app can host multiple functions that would usually share
      a TracerProvider.
    """

    FAAS_DOCUMENT_COLLECTION = "faas.document.collection"
    """
    The name of the source on which the triggering operation was performed. For example, in Cloud Storage or S3 corresponds to the bucket name, and in Cosmos DB to the database name.
    """

    FAAS_DOCUMENT_OPERATION = "faas.document.operation"
    """
    Describes the type of the operation that was performed on the data.
    """

    FAAS_DOCUMENT_TIME = "faas.document.time"
    """
    A string containing the time when the data was accessed in the [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format expressed in [UTC](https://www.w3.org/TR/NOTE-datetime).
    """

    FAAS_DOCUMENT_NAME = "faas.document.name"
    """
    The document name/table subjected to the operation. For example, in Cloud Storage or S3 is the name of the file, and in Cosmos DB the table name.
    """

    URL_PATH = "url.path"
    """
    The [URI path](https://www.rfc-editor.org/rfc/rfc3986#section-3.3) component.
    Note: When missing, the value is assumed to be `/`.
    """

    URL_QUERY = "url.query"
    """
    The [URI query](https://www.rfc-editor.org/rfc/rfc3986#section-3.4) component.
    Note: Sensitive content provided in query string SHOULD be scrubbed when instrumentations can identify it.
    """

    MESSAGING_SYSTEM = "messaging.system"
    """
    A string identifying the messaging system.
    """

    MESSAGING_OPERATION = "messaging.operation"
    """
    A string identifying the kind of messaging operation as defined in the [Operation names](#operation-names) section above.
    Note: If a custom value is used, it MUST be of low cardinality.
    """

    MESSAGING_BATCH_MESSAGE_COUNT = "messaging.batch.message_count"
    """
    The number of messages sent, received, or processed in the scope of the batching operation.
    Note: Instrumentations SHOULD NOT set `messaging.batch.message_count` on spans that operate with a single message. When a messaging client library supports both batch and single-message API for the same operation, instrumentations SHOULD use `messaging.batch.message_count` for batching APIs and SHOULD NOT use it for single-message APIs.
    """

    MESSAGING_CLIENT_ID = "messaging.client_id"
    """
    A unique identifier for the client that consumes or produces a message.
    """

    MESSAGING_DESTINATION_NAME = "messaging.destination.name"
    """
    The message destination name.
    Note: Destination name SHOULD uniquely identify a specific queue, topic or other entity within the broker. If
    the broker does not have such notion, the destination name SHOULD uniquely identify the broker.
    """

    MESSAGING_DESTINATION_TEMPLATE = "messaging.destination.template"
    """
    Low cardinality representation of the messaging destination name.
    Note: Destination names could be constructed from templates. An example would be a destination name involving a user name or product id. Although the destination name in this case is of high cardinality, the underlying template is of low cardinality and can be effectively used for grouping and aggregation.
    """

    MESSAGING_DESTINATION_TEMPORARY = "messaging.destination.temporary"
    """
    A boolean that is true if the message destination is temporary and might not exist anymore after messages are processed.
    """

    MESSAGING_DESTINATION_ANONYMOUS = "messaging.destination.anonymous"
    """
    A boolean that is true if the message destination is anonymous (could be unnamed or have auto-generated name).
    """

    MESSAGING_MESSAGE_ID = "messaging.message.id"
    """
    A value used by the messaging system as an identifier for the message, represented as a string.
    """

    MESSAGING_MESSAGE_CONVERSATION_ID = "messaging.message.conversation_id"
    """
    The [conversation ID](#conversations) identifying the conversation to which the message belongs, represented as a string. Sometimes called "Correlation ID".
    """

    MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = (
        "messaging.message.payload_size_bytes"
    )
    """
    The (uncompressed) size of the message payload in bytes. Also use this attribute if it is unknown whether the compressed or uncompressed payload size is reported.
    """

    MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = (
        "messaging.message.payload_compressed_size_bytes"
    )
    """
    The compressed size of the message payload in bytes.
    """

    FAAS_TIME = "faas.time"
    """
    A string containing the function invocation time in the [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format expressed in [UTC](https://www.w3.org/TR/NOTE-datetime).
    """

    FAAS_CRON = "faas.cron"
    """
    A string containing the schedule period as [Cron Expression](https://docs.oracle.com/cd/E12058_01/doc/doc.1014/e12030/cron_expressions.htm).
    """

    FAAS_COLDSTART = "faas.coldstart"
    """
    A boolean that is true if the serverless function is executed for the first time (aka cold-start).
    """

    FAAS_INVOKED_NAME = "faas.invoked_name"
    """
    The name of the invoked function.
    Note: SHOULD be equal to the `faas.name` resource attribute of the invoked function.
    """

    FAAS_INVOKED_PROVIDER = "faas.invoked_provider"
    """
    The cloud provider of the invoked function.
    Note: SHOULD be equal to the `cloud.provider` resource attribute of the invoked function.
    """

    FAAS_INVOKED_REGION = "faas.invoked_region"
    """
    The cloud region of the invoked function.
    Note: SHOULD be equal to the `cloud.region` resource attribute of the invoked function.
    """

    NETWORK_CONNECTION_TYPE = "network.connection.type"
    """
    The internet connection type.
    """

    NETWORK_CONNECTION_SUBTYPE = "network.connection.subtype"
    """
    This describes more details regarding the connection.type. It may be the type of cell technology connection, but it could be used for describing details about a wifi connection.
    """

    NETWORK_CARRIER_NAME = "network.carrier.name"
    """
    The name of the mobile carrier.
    """

    NETWORK_CARRIER_MCC = "network.carrier.mcc"
    """
    The mobile carrier country code.
    """

    NETWORK_CARRIER_MNC = "network.carrier.mnc"
    """
    The mobile carrier network code.
    """

    NETWORK_CARRIER_ICC = "network.carrier.icc"
    """
    The ISO 3166-1 alpha-2 2-character country code associated with the mobile carrier network.
    """

    PEER_SERVICE = "peer.service"
    """
    The [`service.name`](/docs/resource/README.md#service) of the remote service. SHOULD be equal to the actual `service.name` resource attribute of the remote service if any.
    """

    ENDUSER_ID = "enduser.id"
    """
    Username or client_id extracted from the access token or [Authorization](https://tools.ietf.org/html/rfc7235#section-4.2) header in the inbound request from outside the system.
    """

    ENDUSER_ROLE = "enduser.role"
    """
    Actual/assumed role the client is making the request under extracted from token or application security context.
    """

    ENDUSER_SCOPE = "enduser.scope"
    """
    Scopes or granted authorities the client currently possesses extracted from token or application security context. The value would come from the scope associated with an [OAuth 2.0 Access Token](https://tools.ietf.org/html/rfc6749#section-3.3) or an attribute value in a [SAML 2.0 Assertion](http://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html).
    """

    THREAD_ID = "thread.id"
    """
    Current "managed" thread ID (as opposed to OS thread ID).
    """

    THREAD_NAME = "thread.name"
    """
    Current thread name.
    """

    CODE_FUNCTION = "code.function"
    """
    The method or function name, or equivalent (usually rightmost part of the code unit's name).
    """

    CODE_NAMESPACE = "code.namespace"
    """
    The "namespace" within which `code.function` is defined. Usually the qualified class or module name, such that `code.namespace` + some separator + `code.function` form a unique identifier for the code unit.
    """

    CODE_FILEPATH = "code.filepath"
    """
    The source code file name that identifies the code unit as uniquely as possible (preferably an absolute file path).
    """

    CODE_LINENO = "code.lineno"
    """
    The line number in `code.filepath` best representing the operation. It SHOULD point within the code unit named in `code.function`.
    """

    CODE_COLUMN = "code.column"
    """
    The column number in `code.filepath` best representing the operation. It SHOULD point within the code unit named in `code.function`.
    """

    HTTP_REQUEST_METHOD_ORIGINAL = "http.request.method_original"
    """
    Original HTTP method sent by the client in the request line.
    """

    HTTP_REQUEST_BODY_SIZE = "http.request.body.size"
    """
    The size of the request payload body in bytes. This is the number of bytes transferred excluding headers and is often, but not always, present as the [Content-Length](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-length) header. For requests using transport encoding, this should be the compressed size.
    """

    HTTP_RESPONSE_BODY_SIZE = "http.response.body.size"
    """
    The size of the response payload body in bytes. This is the number of bytes transferred excluding headers and is often, but not always, present as the [Content-Length](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-length) header. For requests using transport encoding, this should be the compressed size.
    """

    HTTP_RESEND_COUNT = "http.resend_count"
    """
    The ordinal number of request resending attempt (for any reason, including redirects).
    Note: The resend count SHOULD be updated each time an HTTP request gets resent by the client, regardless of what was the cause of the resending (e.g. redirection, authorization failure, 503 Server Unavailable, network issues, or any other).
    """

    RPC_SYSTEM = "rpc.system"
    """
    The value `aws-api`.
    """

    RPC_SERVICE = "rpc.service"
    """
    The name of the service to which a request is made, as returned by the AWS SDK.
    Note: This is the logical name of the service from the RPC interface perspective, which can be different from the name of any implementing class. The `code.namespace` attribute may be used to store the latter (despite the attribute name, it may include a class name; e.g., class with method actually executing the call on the server side, RPC client stub class on the client side).
    """

    RPC_METHOD = "rpc.method"
    """
    The name of the operation corresponding to the request, as returned by the AWS SDK.
    Note: This is the logical name of the method from the RPC interface perspective, which can be different from the name of any implementing method/function. The `code.function` attribute may be used to store the latter (e.g., method actually executing the call on the server side, RPC client stub method on the client side).
    """

    AWS_REQUEST_ID = "aws.request_id"
    """
    The AWS request ID as returned in the response headers `x-amz-request-id` or `x-amz-requestid`.
    """

    AWS_DYNAMODB_TABLE_NAMES = "aws.dynamodb.table_names"
    """
    The keys in the `RequestItems` object field.
    """

    AWS_DYNAMODB_CONSUMED_CAPACITY = "aws.dynamodb.consumed_capacity"
    """
    The JSON-serialized value of each item in the `ConsumedCapacity` response field.
    """

    AWS_DYNAMODB_ITEM_COLLECTION_METRICS = (
        "aws.dynamodb.item_collection_metrics"
    )
    """
    The JSON-serialized value of the `ItemCollectionMetrics` response field.
    """

    AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = (
        "aws.dynamodb.provisioned_read_capacity"
    )
    """
    The value of the `ProvisionedThroughput.ReadCapacityUnits` request parameter.
    """

    AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = (
        "aws.dynamodb.provisioned_write_capacity"
    )
    """
    The value of the `ProvisionedThroughput.WriteCapacityUnits` request parameter.
    """

    AWS_DYNAMODB_CONSISTENT_READ = "aws.dynamodb.consistent_read"
    """
    The value of the `ConsistentRead` request parameter.
    """

    AWS_DYNAMODB_PROJECTION = "aws.dynamodb.projection"
    """
    The value of the `ProjectionExpression` request parameter.
    """

    AWS_DYNAMODB_LIMIT = "aws.dynamodb.limit"
    """
    The value of the `Limit` request parameter.
    """

    AWS_DYNAMODB_ATTRIBUTES_TO_GET = "aws.dynamodb.attributes_to_get"
    """
    The value of the `AttributesToGet` request parameter.
    """

    AWS_DYNAMODB_INDEX_NAME = "aws.dynamodb.index_name"
    """
    The value of the `IndexName` request parameter.
    """

    AWS_DYNAMODB_SELECT = "aws.dynamodb.select"
    """
    The value of the `Select` request parameter.
    """

    AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = (
        "aws.dynamodb.global_secondary_indexes"
    )
    """
    The JSON-serialized value of each item of the `GlobalSecondaryIndexes` request field.
    """

    AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = (
        "aws.dynamodb.local_secondary_indexes"
    )
    """
    The JSON-serialized value of each item of the `LocalSecondaryIndexes` request field.
    """

    AWS_DYNAMODB_EXCLUSIVE_START_TABLE = "aws.dynamodb.exclusive_start_table"
    """
    The value of the `ExclusiveStartTableName` request parameter.
    """

    AWS_DYNAMODB_TABLE_COUNT = "aws.dynamodb.table_count"
    """
    The the number of items in the `TableNames` response parameter.
    """

    AWS_DYNAMODB_SCAN_FORWARD = "aws.dynamodb.scan_forward"
    """
    The value of the `ScanIndexForward` request parameter.
    """

    AWS_DYNAMODB_SEGMENT = "aws.dynamodb.segment"
    """
    The value of the `Segment` request parameter.
    """

    AWS_DYNAMODB_TOTAL_SEGMENTS = "aws.dynamodb.total_segments"
    """
    The value of the `TotalSegments` request parameter.
    """

    AWS_DYNAMODB_COUNT = "aws.dynamodb.count"
    """
    The value of the `Count` response parameter.
    """

    AWS_DYNAMODB_SCANNED_COUNT = "aws.dynamodb.scanned_count"
    """
    The value of the `ScannedCount` response parameter.
    """

    AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = "aws.dynamodb.attribute_definitions"
    """
    The JSON-serialized value of each item in the `AttributeDefinitions` request field.
    """

    AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = (
        "aws.dynamodb.global_secondary_index_updates"
    )
    """
    The JSON-serialized value of each item in the the `GlobalSecondaryIndexUpdates` request field.
    """

    AWS_S3_BUCKET = "aws.s3.bucket"
    """
    The S3 bucket name the request refers to. Corresponds to the `--bucket` parameter of the [S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/index.html) operations.
    Note: The `bucket` attribute is applicable to all S3 operations that reference a bucket, i.e. that require the bucket name as a mandatory parameter.
    This applies to almost all S3 operations except `list-buckets`.
    """

    AWS_S3_KEY = "aws.s3.key"
    """
    The S3 object key the request refers to. Corresponds to the `--key` parameter of the [S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/index.html) operations.
    Note: The `key` attribute is applicable to all object-related S3 operations, i.e. that require the object key as a mandatory parameter.
    This applies in particular to the following operations:

    - [copy-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/copy-object.html)
    - [delete-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-object.html)
    - [get-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html)
    - [head-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html)
    - [put-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html)
    - [restore-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/restore-object.html)
    - [select-object-content](https://docs.aws.amazon.com/cli/latest/reference/s3api/select-object-content.html)
    - [abort-multipart-upload](https://docs.aws.amazon.com/cli/latest/reference/s3api/abort-multipart-upload.html)
    - [complete-multipart-upload](https://docs.aws.amazon.com/cli/latest/reference/s3api/complete-multipart-upload.html)
    - [create-multipart-upload](https://docs.aws.amazon.com/cli/latest/reference/s3api/create-multipart-upload.html)
    - [list-parts](https://docs.aws.amazon.com/cli/latest/reference/s3api/list-parts.html)
    - [upload-part](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html)
    - [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html).
    """

    AWS_S3_COPY_SOURCE = "aws.s3.copy_source"
    """
    The source object (in the form `bucket`/`key`) for the copy operation.
    Note: The `copy_source` attribute applies to S3 copy operations and corresponds to the `--copy-source` parameter
    of the [copy-object operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/copy-object.html).
    This applies in particular to the following operations:

    - [copy-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/copy-object.html)
    - [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html).
    """

    AWS_S3_UPLOAD_ID = "aws.s3.upload_id"
    """
    Upload ID that identifies the multipart upload.
    Note: The `upload_id` attribute applies to S3 multipart-upload operations and corresponds to the `--upload-id` parameter
    of the [S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/index.html) multipart operations.
    This applies in particular to the following operations:

    - [abort-multipart-upload](https://docs.aws.amazon.com/cli/latest/reference/s3api/abort-multipart-upload.html)
    - [complete-multipart-upload](https://docs.aws.amazon.com/cli/latest/reference/s3api/complete-multipart-upload.html)
    - [list-parts](https://docs.aws.amazon.com/cli/latest/reference/s3api/list-parts.html)
    - [upload-part](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html)
    - [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html).
    """

    AWS_S3_DELETE = "aws.s3.delete"
    """
    The delete request container that specifies the objects to be deleted.
    Note: The `delete` attribute is only applicable to the [delete-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-object.html) operation.
    The `delete` attribute corresponds to the `--delete` parameter of the
    [delete-objects operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-objects.html).
    """

    AWS_S3_PART_NUMBER = "aws.s3.part_number"
    """
    The part number of the part being uploaded in a multipart-upload operation. This is a positive integer between 1 and 10,000.
    Note: The `part_number` attribute is only applicable to the [upload-part](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html)
    and [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html) operations.
    The `part_number` attribute corresponds to the `--part-number` parameter of the
    [upload-part operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html).
    """

    GRAPHQL_OPERATION_NAME = "graphql.operation.name"
    """
    The name of the operation being executed.
    """

    GRAPHQL_OPERATION_TYPE = "graphql.operation.type"
    """
    The type of the operation being executed.
    """

    GRAPHQL_DOCUMENT = "graphql.document"
    """
    The GraphQL document being executed.
    Note: The value may be sanitized to exclude sensitive information.
    """

    MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY = (
        "messaging.rabbitmq.destination.routing_key"
    )
    """
    RabbitMQ message routing key.
    """

    MESSAGING_KAFKA_MESSAGE_KEY = "messaging.kafka.message.key"
    """
    Message keys in Kafka are used for grouping alike messages to ensure they're processed on the same partition. They differ from `messaging.message.id` in that they're not unique. If the key is `null`, the attribute MUST NOT be set.
    Note: If the key type is not string, it's string representation has to be supplied for the attribute. If the key has no unambiguous, canonical string form, don't include its value.
    """

    MESSAGING_KAFKA_CONSUMER_GROUP = "messaging.kafka.consumer.group"
    """
    Name of the Kafka Consumer Group that is handling the message. Only applies to consumers, not producers.
    """

    MESSAGING_KAFKA_DESTINATION_PARTITION = (
        "messaging.kafka.destination.partition"
    )
    """
    Partition the message is sent to.
    """

    MESSAGING_KAFKA_MESSAGE_OFFSET = "messaging.kafka.message.offset"
    """
    The offset of a record in the corresponding Kafka partition.
    """

    MESSAGING_KAFKA_MESSAGE_TOMBSTONE = "messaging.kafka.message.tombstone"
    """
    A boolean that is true if the message is a tombstone.
    """

    MESSAGING_ROCKETMQ_NAMESPACE = "messaging.rocketmq.namespace"
    """
    Namespace of RocketMQ resources, resources in different namespaces are individual.
    """

    MESSAGING_ROCKETMQ_CLIENT_GROUP = "messaging.rocketmq.client_group"
    """
    Name of the RocketMQ producer/consumer group that is handling the message. The client type is identified by the SpanKind.
    """

    MESSAGING_ROCKETMQ_MESSAGE_DELIVERY_TIMESTAMP = (
        "messaging.rocketmq.message.delivery_timestamp"
    )
    """
    The timestamp in milliseconds that the delay message is expected to be delivered to consumer.
    """

    MESSAGING_ROCKETMQ_MESSAGE_DELAY_TIME_LEVEL = (
        "messaging.rocketmq.message.delay_time_level"
    )
    """
    The delay time level for delay message, which determines the message delay time.
    """

    MESSAGING_ROCKETMQ_MESSAGE_GROUP = "messaging.rocketmq.message.group"
    """
    It is essential for FIFO message. Messages that belong to the same message group are always processed one by one within the same consumer group.
    """

    MESSAGING_ROCKETMQ_MESSAGE_TYPE = "messaging.rocketmq.message.type"
    """
    Type of message.
    """

    MESSAGING_ROCKETMQ_MESSAGE_TAG = "messaging.rocketmq.message.tag"
    """
    The secondary classifier of message besides topic.
    """

    MESSAGING_ROCKETMQ_MESSAGE_KEYS = "messaging.rocketmq.message.keys"
    """
    Key(s) of message, another way to mark message besides message id.
    """

    MESSAGING_ROCKETMQ_CONSUMPTION_MODEL = (
        "messaging.rocketmq.consumption_model"
    )
    """
    Model of message consumption. This only applies to consumer spans.
    """

    RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code"
    """
    The [numeric status code](https://github.com/grpc/grpc/blob/v1.33.2/doc/statuscodes.md) of the gRPC request.
    """

    RPC_JSONRPC_VERSION = "rpc.jsonrpc.version"
    """
    Protocol version as in `jsonrpc` property of request/response. Since JSON-RPC 1.0 does not specify this, the value can be omitted.
    """

    RPC_JSONRPC_REQUEST_ID = "rpc.jsonrpc.request_id"
    """
    `id` property of request or response. Since protocol allows id to be int, string, `null` or missing (for notifications), value is expected to be cast to string for simplicity. Use empty string in case of `null` value. Omit entirely if this is a notification.
    """

    RPC_JSONRPC_ERROR_CODE = "rpc.jsonrpc.error_code"
    """
    `error.code` property of response if it is an error response.
    """

    RPC_JSONRPC_ERROR_MESSAGE = "rpc.jsonrpc.error_message"
    """
    `error.message` property of response if it is an error response.
    """

    MESSAGE_TYPE = "message.type"
    """
    Whether this is a received or sent message.
    """

    MESSAGE_ID = "message.id"
    """
    MUST be calculated as two different counters starting from `1` one for sent messages and one for received message.
    Note: This way we guarantee that the values will be consistent between different implementations.
    """

    MESSAGE_COMPRESSED_SIZE = "message.compressed_size"
    """
    Compressed size of the message in bytes.
    """

    MESSAGE_UNCOMPRESSED_SIZE = "message.uncompressed_size"
    """
    Uncompressed size of the message in bytes.
    """

    RPC_CONNECT_RPC_ERROR_CODE = "rpc.connect_rpc.error_code"
    """
    The [error codes](https://connect.build/docs/protocol/#error-codes) of the Connect request. Error codes are always string values.
    """

    EXCEPTION_ESCAPED = "exception.escaped"
    """
    SHOULD be set to true if the exception event is recorded at a point where it is known that the exception is escaping the scope of the span.
    Note: An exception is considered to have escaped (or left) the scope of a span,
    if that span is ended while the exception is still logically "in flight".
    This may be actually "in flight" in some languages (e.g. if the exception
    is passed to a Context manager's `__exit__` method in Python) but will
    usually be caught at the point of recording the exception in most languages.

    It is usually not possible to determine at the point where an exception is thrown
    whether it will escape the scope of a span.
    However, it is trivial to know that an exception
    will escape, if one checks for an active exception just before ending the span,
    as done in the [example above](#recording-an-exception).

    It follows that an exception may still escape the scope of the span
    even if the `exception.escaped` attribute was not set or set to false,
    since the event might have been recorded at a time where it was not
    clear whether the exception will escape.
    """

    URL_FRAGMENT = "url.fragment"
    """
    The [URI fragment](https://www.rfc-editor.org/rfc/rfc3986#section-3.5) component.
    """

    # Manually defined deprecated attributes

    NET_PEER_IP = "net.peer.ip"
    """
    Deprecated, use the `client.socket.address` attribute.
    """

    NET_HOST_IP = "net.host.ip"
    """
    Deprecated, use the `server.socket.address` attribute.
    """

    HTTP_SERVER_NAME = "http.server_name"
    """
    Deprecated, use the `server.address` attribute.
    """

    HTTP_HOST = "http.host"
    """
    Deprecated, use the `server.address` and `server.port` attributes.
    """

    HTTP_RETRY_COUNT = "http.retry_count"
    """
    Deprecated, use the `http.resend_count` attribute.
    """

    HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = (
        "http.request_content_length_uncompressed"
    )
    """
    Deprecated, use the `http.request.body.size` attribute.
    """

    HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = (
        "http.response_content_length_uncompressed"
    )
    """
    Deprecated, use the `http.response.body.size` attribute.
    """

    MESSAGING_DESTINATION = "messaging.destination"
    """
    Deprecated, use the `messaging.destination.name` attribute.
    """

    MESSAGING_DESTINATION_KIND = "messaging.destination_kind"
    """
    Deprecated.
    """

    MESSAGING_TEMP_DESTINATION = "messaging.temp_destination"
    """
    Deprecated. Use `messaging.destination.temporary` attribute.
    """

    MESSAGING_PROTOCOL = "messaging.protocol"
    """
    Deprecated. Use `network.protocol.name` attribute.
    """

    MESSAGING_PROTOCOL_VERSION = "messaging.protocol_version"
    """
    Deprecated. Use `network.protocol.version` attribute.
    """

    MESSAGING_URL = "messaging.url"
    """
    Deprecated. Use `server.address` and `server.port` attributes.
    """

    MESSAGING_CONVERSATION_ID = "messaging.conversation_id"
    """
    Deprecated. Use `messaging.message.conversation.id` attribute.
    """

    MESSAGING_KAFKA_PARTITION = "messaging.kafka.partition"
    """
    Deprecated. Use `messaging.kafka.destination.partition` attribute.
    """

    FAAS_EXECUTION = "faas.execution"
    """
    Deprecated. Use `faas.invocation_id` attribute.
    """

    HTTP_USER_AGENT = "http.user_agent"
    """
    Deprecated. Use `user_agent.original` attribute.
    """

    MESSAGING_RABBITMQ_ROUTING_KEY = "messaging.rabbitmq.routing_key"
    """
    Deprecated. Use `messaging.rabbitmq.destination.routing_key` attribute.
    """

    MESSAGING_KAFKA_TOMBSTONE = "messaging.kafka.tombstone"
    """
    Deprecated. Use `messaging.kafka.destination.tombstone` attribute.
    """

    NET_APP_PROTOCOL_NAME = "net.app.protocol.name"
    """
    Deprecated. Use `network.protocol.name` attribute.
    """

    NET_APP_PROTOCOL_VERSION = "net.app.protocol.version"
    """
    Deprecated. Use `network.protocol.version` attribute.
    """

    HTTP_CLIENT_IP = "http.client_ip"
    """
    Deprecated. Use `client.address` attribute.
    """

    HTTP_FLAVOR = "http.flavor"
    """
    Deprecated. Use `network.protocol.name` and `network.protocol.version` attributes.
    """

    NET_HOST_CONNECTION_TYPE = "net.host.connection.type"
    """
    Deprecated. Use `network.connection.type` attribute.
    """

    NET_HOST_CONNECTION_SUBTYPE = "net.host.connection.subtype"
    """
    Deprecated. Use `network.connection.subtype` attribute.
    """

    NET_HOST_CARRIER_NAME = "net.host.carrier.name"
    """
    Deprecated. Use `network.carrier.name` attribute.
    """

    NET_HOST_CARRIER_MCC = "net.host.carrier.mcc"
    """
    Deprecated. Use `network.carrier.mcc` attribute.
    """

    NET_HOST_CARRIER_MNC = "net.host.carrier.mnc"
    """
    Deprecated. Use `network.carrier.mnc` attribute.
    """

    MESSAGING_CONSUMER_ID = "messaging.consumer_id"
    """
    Deprecated. Use `messaging.client_id` attribute.
    """

    MESSAGING_KAFKA_CLIENT_ID = "messaging.kafka.client_id"
    """
    Deprecated. Use `messaging.client_id` attribute.
    """

    MESSAGING_ROCKETMQ_CLIENT_ID = "messaging.rocketmq.client_id"
    """
    Deprecated. Use `messaging.client_id` attribute.
    """


@deprecated(
    "Removed from the specification in favor of `network.protocol.name` and `network.protocol.version` attributes. Deprecated since version 1.18.0.",
)
class HttpFlavorValues(Enum):
    HTTP_1_0 = "1.0"

    HTTP_1_1 = "1.1"

    HTTP_2_0 = "2.0"

    HTTP_3_0 = "3.0"

    SPDY = "SPDY"

    QUIC = "QUIC"


@deprecated(
    "Removed from the specification. Deprecated since version 1.18.0.",
)
class MessagingDestinationKindValues(Enum):
    QUEUE = "queue"
    """A message sent to a queue."""

    TOPIC = "topic"
    """A message sent to a topic."""


@deprecated(
    "Renamed to NetworkConnectionTypeValues. Deprecated since version 1.21.0.",
)
class NetHostConnectionTypeValues(Enum):
    WIFI = "wifi"
    """wifi."""

    WIRED = "wired"
    """wired."""

    CELL = "cell"
    """cell."""

    UNAVAILABLE = "unavailable"
    """unavailable."""

    UNKNOWN = "unknown"
    """unknown."""


@deprecated(
    "Renamed to NetworkConnectionSubtypeValues. Deprecated since version 1.21.0.",
)
class NetHostConnectionSubtypeValues(Enum):
    GPRS = "gprs"
    """GPRS."""

    EDGE = "edge"
    """EDGE."""

    UMTS = "umts"
    """UMTS."""

    CDMA = "cdma"
    """CDMA."""

    EVDO_0 = "evdo_0"
    """EVDO Rel. 0."""

    EVDO_A = "evdo_a"
    """EVDO Rev. A."""

    CDMA2000_1XRTT = "cdma2000_1xrtt"
    """CDMA2000 1XRTT."""

    HSDPA = "hsdpa"
    """HSDPA."""

    HSUPA = "hsupa"
    """HSUPA."""

    HSPA = "hspa"
    """HSPA."""

    IDEN = "iden"
    """IDEN."""

    EVDO_B = "evdo_b"
    """EVDO Rev. B."""

    LTE = "lte"
    """LTE."""

    EHRPD = "ehrpd"
    """EHRPD."""

    HSPAP = "hspap"
    """HSPAP."""

    GSM = "gsm"
    """GSM."""

    TD_SCDMA = "td_scdma"
    """TD-SCDMA."""

    IWLAN = "iwlan"
    """IWLAN."""

    NR = "nr"
    """5G NR (New Radio)."""

    NRNSA = "nrnsa"
    """5G NRNSA (New Radio Non-Standalone)."""

    LTE_CA = "lte_ca"
    """LTE CA."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv.attributes.NetworkTransportValues` instead. Deprecated since version 1.25.0.",
)
class NetTransportValues(Enum):
    IP_TCP = "ip_tcp"
    """ip_tcp."""

    IP_UDP = "ip_udp"
    """ip_udp."""

    PIPE = "pipe"
    """Named or anonymous pipe."""

    INPROC = "inproc"
    """In-process communication."""

    OTHER = "other"
    """Something else (non IP-based)."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv.attributes.NetworkType` instead. Deprecated since version 1.25.0.",
)
class NetSockFamilyValues(Enum):
    INET = "inet"
    """IPv4 address."""

    INET6 = "inet6"
    """IPv6 address."""

    UNIX = "unix"
    """Unix domain socket path."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv.attributes.HttpRequestMethodValues` instead. Deprecated since version 1.25.0.",
)
class HttpRequestMethodValues(Enum):
    CONNECT = "CONNECT"
    """CONNECT method."""

    DELETE = "DELETE"
    """DELETE method."""

    GET = "GET"
    """GET method."""

    HEAD = "HEAD"
    """HEAD method."""

    OPTIONS = "OPTIONS"
    """OPTIONS method."""

    PATCH = "PATCH"
    """PATCH method."""

    POST = "POST"
    """POST method."""

    PUT = "PUT"
    """PUT method."""

    TRACE = "TRACE"
    """TRACE method."""

    OTHER = "_OTHER"
    """Any HTTP method that the instrumentation has no prior knowledge of."""


@deprecated("Removed from the specification. Deprecated since version 1.25.0.")
class EventDomainValues(Enum):
    BROWSER = "browser"
    """Events from browser apps."""

    DEVICE = "device"
    """Events from mobile apps."""

    K8S = "k8s"
    """Events from Kubernetes."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.LogIostreamValues` instead. Deprecated since version 1.25.0.",
)
class LogIostreamValues(Enum):
    STDOUT = "stdout"
    """Logs from stdout stream."""

    STDERR = "stderr"
    """Events from stderr stream."""


@deprecated("Removed from the specification. Deprecated since version 1.25.0.")
class TypeValues(Enum):
    HEAP = "heap"
    """Heap memory."""

    NON_HEAP = "non_heap"
    """Non-heap memory."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.OpentracingRefTypeValues` instead. Deprecated since version 1.25.0.",
)
class OpentracingRefTypeValues(Enum):
    CHILD_OF = "child_of"
    """The parent Span depends on the child Span in some capacity."""

    FOLLOWS_FROM = "follows_from"
    """The parent Span does not depend in any way on the result of the child Span."""


class DbSystemValues(Enum):
    OTHER_SQL = "other_sql"
    """Some other SQL database. Fallback only. See notes."""

    MSSQL = "mssql"
    """Microsoft SQL Server."""

    MSSQLCOMPACT = "mssqlcompact"
    """Microsoft SQL Server Compact."""

    MYSQL = "mysql"
    """MySQL."""

    ORACLE = "oracle"
    """Oracle Database."""

    DB2 = "db2"
    """IBM Db2."""

    POSTGRESQL = "postgresql"
    """PostgreSQL."""

    REDSHIFT = "redshift"
    """Amazon Redshift."""

    HIVE = "hive"
    """Apache Hive."""

    CLOUDSCAPE = "cloudscape"
    """Cloudscape."""

    HSQLDB = "hsqldb"
    """HyperSQL DataBase."""

    PROGRESS = "progress"
    """Progress Database."""

    MAXDB = "maxdb"
    """SAP MaxDB."""

    HANADB = "hanadb"
    """SAP HANA."""

    INGRES = "ingres"
    """Ingres."""

    FIRSTSQL = "firstsql"
    """FirstSQL."""

    EDB = "edb"
    """EnterpriseDB."""

    CACHE = "cache"
    """InterSystems Caché."""

    ADABAS = "adabas"
    """Adabas (Adaptable Database System)."""

    FIREBIRD = "firebird"
    """Firebird."""

    DERBY = "derby"
    """Apache Derby."""

    FILEMAKER = "filemaker"
    """FileMaker."""

    INFORMIX = "informix"
    """Informix."""

    INSTANTDB = "instantdb"
    """InstantDB."""

    INTERBASE = "interbase"
    """InterBase."""

    MARIADB = "mariadb"
    """MariaDB."""

    NETEZZA = "netezza"
    """Netezza."""

    PERVASIVE = "pervasive"
    """Pervasive PSQL."""

    POINTBASE = "pointbase"
    """PointBase."""

    SQLITE = "sqlite"
    """SQLite."""

    SYBASE = "sybase"
    """Sybase."""

    TERADATA = "teradata"
    """Teradata."""

    VERTICA = "vertica"
    """Vertica."""

    H2 = "h2"
    """H2."""

    COLDFUSION = "coldfusion"
    """ColdFusion IMQ."""

    CASSANDRA = "cassandra"
    """Apache Cassandra."""

    HBASE = "hbase"
    """Apache HBase."""

    MONGODB = "mongodb"
    """MongoDB."""

    REDIS = "redis"
    """Redis."""

    COUCHBASE = "couchbase"
    """Couchbase."""

    COUCHDB = "couchdb"
    """CouchDB."""

    COSMOSDB = "cosmosdb"
    """Microsoft Azure Cosmos DB."""

    DYNAMODB = "dynamodb"
    """Amazon DynamoDB."""

    NEO4J = "neo4j"
    """Neo4j."""

    GEODE = "geode"
    """Apache Geode."""

    ELASTICSEARCH = "elasticsearch"
    """Elasticsearch."""

    MEMCACHED = "memcached"
    """Memcached."""

    COCKROACHDB = "cockroachdb"
    """CockroachDB."""

    OPENSEARCH = "opensearch"
    """OpenSearch."""

    CLICKHOUSE = "clickhouse"
    """ClickHouse."""

    SPANNER = "spanner"
    """Cloud Spanner."""

    TRINO = "trino"
    """Trino."""


class NetworkTransportValues(Enum):
    TCP = "tcp"
    """TCP."""

    UDP = "udp"
    """UDP."""

    PIPE = "pipe"
    """Named or anonymous pipe. See note below."""

    UNIX = "unix"
    """Unix domain socket."""


class NetworkTypeValues(Enum):
    IPV4 = "ipv4"
    """IPv4."""

    IPV6 = "ipv6"
    """IPv6."""


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


class DbCosmosdbOperationTypeValues(Enum):
    INVALID = "Invalid"
    """invalid."""

    CREATE = "Create"
    """create."""

    PATCH = "Patch"
    """patch."""

    READ = "Read"
    """read."""

    READ_FEED = "ReadFeed"
    """read_feed."""

    DELETE = "Delete"
    """delete."""

    REPLACE = "Replace"
    """replace."""

    EXECUTE = "Execute"
    """execute."""

    QUERY = "Query"
    """query."""

    HEAD = "Head"
    """head."""

    HEAD_FEED = "HeadFeed"
    """head_feed."""

    UPSERT = "Upsert"
    """upsert."""

    BATCH = "Batch"
    """batch."""

    QUERY_PLAN = "QueryPlan"
    """query_plan."""

    EXECUTE_JAVASCRIPT = "ExecuteJavaScript"
    """execute_javascript."""


class DbCosmosdbConnectionModeValues(Enum):
    GATEWAY = "gateway"
    """Gateway (HTTP) connections mode."""

    DIRECT = "direct"
    """Direct connection."""


class OtelStatusCodeValues(Enum):
    OK = "OK"
    """The operation has been validated by an Application developer or Operator to have completed successfully."""

    ERROR = "ERROR"
    """The operation contains an error."""


class FaasTriggerValues(Enum):
    DATASOURCE = "datasource"
    """A response to some data source operation such as a database or filesystem read/write."""

    HTTP = "http"
    """To provide an answer to an inbound HTTP request."""

    PUBSUB = "pubsub"
    """A function is set to be executed when messages are sent to a messaging system."""

    TIMER = "timer"
    """A function is scheduled to be executed regularly."""

    OTHER = "other"
    """If none of the others apply."""


class FaasDocumentOperationValues(Enum):
    INSERT = "insert"
    """When a new object is created."""

    EDIT = "edit"
    """When an object is modified."""

    DELETE = "delete"
    """When an object is deleted."""


class MessagingOperationValues(Enum):
    PUBLISH = "publish"
    """publish."""

    RECEIVE = "receive"
    """receive."""

    PROCESS = "process"
    """process."""


class FaasInvokedProviderValues(Enum):
    ALIBABA_CLOUD = "alibaba_cloud"
    """Alibaba Cloud."""

    AWS = "aws"
    """Amazon Web Services."""

    AZURE = "azure"
    """Microsoft Azure."""

    GCP = "gcp"
    """Google Cloud Platform."""

    TENCENT_CLOUD = "tencent_cloud"
    """Tencent Cloud."""


class NetworkConnectionTypeValues(Enum):
    WIFI = "wifi"
    """wifi."""

    WIRED = "wired"
    """wired."""

    CELL = "cell"
    """cell."""

    UNAVAILABLE = "unavailable"
    """unavailable."""

    UNKNOWN = "unknown"
    """unknown."""


class NetworkConnectionSubtypeValues(Enum):
    GPRS = "gprs"
    """GPRS."""

    EDGE = "edge"
    """EDGE."""

    UMTS = "umts"
    """UMTS."""

    CDMA = "cdma"
    """CDMA."""

    EVDO_0 = "evdo_0"
    """EVDO Rel. 0."""

    EVDO_A = "evdo_a"
    """EVDO Rev. A."""

    CDMA2000_1XRTT = "cdma2000_1xrtt"
    """CDMA2000 1XRTT."""

    HSDPA = "hsdpa"
    """HSDPA."""

    HSUPA = "hsupa"
    """HSUPA."""

    HSPA = "hspa"
    """HSPA."""

    IDEN = "iden"
    """IDEN."""

    EVDO_B = "evdo_b"
    """EVDO Rev. B."""

    LTE = "lte"
    """LTE."""

    EHRPD = "ehrpd"
    """EHRPD."""

    HSPAP = "hspap"
    """HSPAP."""

    GSM = "gsm"
    """GSM."""

    TD_SCDMA = "td_scdma"
    """TD-SCDMA."""

    IWLAN = "iwlan"
    """IWLAN."""

    NR = "nr"
    """5G NR (New Radio)."""

    NRNSA = "nrnsa"
    """5G NRNSA (New Radio Non-Standalone)."""

    LTE_CA = "lte_ca"
    """LTE CA."""


class RpcSystemValues(Enum):
    GRPC = "grpc"
    """gRPC."""

    JAVA_RMI = "java_rmi"
    """Java RMI."""

    DOTNET_WCF = "dotnet_wcf"
    """.NET WCF."""

    APACHE_DUBBO = "apache_dubbo"
    """Apache Dubbo."""

    CONNECT_RPC = "connect_rpc"
    """Connect RPC."""


class GraphqlOperationTypeValues(Enum):
    QUERY = "query"
    """GraphQL query."""

    MUTATION = "mutation"
    """GraphQL mutation."""

    SUBSCRIPTION = "subscription"
    """GraphQL subscription."""


class MessagingRocketmqMessageTypeValues(Enum):
    NORMAL = "normal"
    """Normal message."""

    FIFO = "fifo"
    """FIFO message."""

    DELAY = "delay"
    """Delay message."""

    TRANSACTION = "transaction"
    """Transaction message."""


class MessagingRocketmqConsumptionModelValues(Enum):
    CLUSTERING = "clustering"
    """Clustering consumption model."""

    BROADCASTING = "broadcasting"
    """Broadcasting consumption model."""


class RpcGrpcStatusCodeValues(Enum):
    OK = 0
    """OK."""

    CANCELLED = 1
    """CANCELLED."""

    UNKNOWN = 2
    """UNKNOWN."""

    INVALID_ARGUMENT = 3
    """INVALID_ARGUMENT."""

    DEADLINE_EXCEEDED = 4
    """DEADLINE_EXCEEDED."""

    NOT_FOUND = 5
    """NOT_FOUND."""

    ALREADY_EXISTS = 6
    """ALREADY_EXISTS."""

    PERMISSION_DENIED = 7
    """PERMISSION_DENIED."""

    RESOURCE_EXHAUSTED = 8
    """RESOURCE_EXHAUSTED."""

    FAILED_PRECONDITION = 9
    """FAILED_PRECONDITION."""

    ABORTED = 10
    """ABORTED."""

    OUT_OF_RANGE = 11
    """OUT_OF_RANGE."""

    UNIMPLEMENTED = 12
    """UNIMPLEMENTED."""

    INTERNAL = 13
    """INTERNAL."""

    UNAVAILABLE = 14
    """UNAVAILABLE."""

    DATA_LOSS = 15
    """DATA_LOSS."""

    UNAUTHENTICATED = 16
    """UNAUTHENTICATED."""


class MessageTypeValues(Enum):
    SENT = "SENT"
    """sent."""

    RECEIVED = "RECEIVED"
    """received."""


class RpcConnectRpcErrorCodeValues(Enum):
    CANCELLED = "cancelled"
    """cancelled."""

    UNKNOWN = "unknown"
    """unknown."""

    INVALID_ARGUMENT = "invalid_argument"
    """invalid_argument."""

    DEADLINE_EXCEEDED = "deadline_exceeded"
    """deadline_exceeded."""

    NOT_FOUND = "not_found"
    """not_found."""

    ALREADY_EXISTS = "already_exists"
    """already_exists."""

    PERMISSION_DENIED = "permission_denied"
    """permission_denied."""

    RESOURCE_EXHAUSTED = "resource_exhausted"
    """resource_exhausted."""

    FAILED_PRECONDITION = "failed_precondition"
    """failed_precondition."""

    ABORTED = "aborted"
    """aborted."""

    OUT_OF_RANGE = "out_of_range"
    """out_of_range."""

    UNIMPLEMENTED = "unimplemented"
    """unimplemented."""

    INTERNAL = "internal"
    """internal."""

    UNAVAILABLE = "unavailable"
    """unavailable."""

    DATA_LOSS = "data_loss"
    """data_loss."""

    UNAUTHENTICATED = "unauthenticated"
    """unauthenticated."""
