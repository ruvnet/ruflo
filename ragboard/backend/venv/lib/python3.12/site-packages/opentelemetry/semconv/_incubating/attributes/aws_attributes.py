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

AWS_BEDROCK_GUARDRAIL_ID: Final = "aws.bedrock.guardrail.id"
"""
The unique identifier of the AWS Bedrock Guardrail. A [guardrail](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) helps safeguard and prevent unwanted behavior from model responses or user messages.
"""

AWS_BEDROCK_KNOWLEDGE_BASE_ID: Final = "aws.bedrock.knowledge_base.id"
"""
The unique identifier of the AWS Bedrock Knowledge base. A [knowledge base](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html) is a bank of information that can be queried by models to generate more relevant responses and augment prompts.
"""

AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS: Final = (
    "aws.dynamodb.attribute_definitions"
)
"""
The JSON-serialized value of each item in the `AttributeDefinitions` request field.
"""

AWS_DYNAMODB_ATTRIBUTES_TO_GET: Final = "aws.dynamodb.attributes_to_get"
"""
The value of the `AttributesToGet` request parameter.
"""

AWS_DYNAMODB_CONSISTENT_READ: Final = "aws.dynamodb.consistent_read"
"""
The value of the `ConsistentRead` request parameter.
"""

AWS_DYNAMODB_CONSUMED_CAPACITY: Final = "aws.dynamodb.consumed_capacity"
"""
The JSON-serialized value of each item in the `ConsumedCapacity` response field.
"""

AWS_DYNAMODB_COUNT: Final = "aws.dynamodb.count"
"""
The value of the `Count` response parameter.
"""

AWS_DYNAMODB_EXCLUSIVE_START_TABLE: Final = (
    "aws.dynamodb.exclusive_start_table"
)
"""
The value of the `ExclusiveStartTableName` request parameter.
"""

AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES: Final = (
    "aws.dynamodb.global_secondary_index_updates"
)
"""
The JSON-serialized value of each item in the `GlobalSecondaryIndexUpdates` request field.
"""

AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES: Final = (
    "aws.dynamodb.global_secondary_indexes"
)
"""
The JSON-serialized value of each item of the `GlobalSecondaryIndexes` request field.
"""

AWS_DYNAMODB_INDEX_NAME: Final = "aws.dynamodb.index_name"
"""
The value of the `IndexName` request parameter.
"""

AWS_DYNAMODB_ITEM_COLLECTION_METRICS: Final = (
    "aws.dynamodb.item_collection_metrics"
)
"""
The JSON-serialized value of the `ItemCollectionMetrics` response field.
"""

AWS_DYNAMODB_LIMIT: Final = "aws.dynamodb.limit"
"""
The value of the `Limit` request parameter.
"""

AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES: Final = (
    "aws.dynamodb.local_secondary_indexes"
)
"""
The JSON-serialized value of each item of the `LocalSecondaryIndexes` request field.
"""

AWS_DYNAMODB_PROJECTION: Final = "aws.dynamodb.projection"
"""
The value of the `ProjectionExpression` request parameter.
"""

AWS_DYNAMODB_PROVISIONED_READ_CAPACITY: Final = (
    "aws.dynamodb.provisioned_read_capacity"
)
"""
The value of the `ProvisionedThroughput.ReadCapacityUnits` request parameter.
"""

AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY: Final = (
    "aws.dynamodb.provisioned_write_capacity"
)
"""
The value of the `ProvisionedThroughput.WriteCapacityUnits` request parameter.
"""

AWS_DYNAMODB_SCAN_FORWARD: Final = "aws.dynamodb.scan_forward"
"""
The value of the `ScanIndexForward` request parameter.
"""

AWS_DYNAMODB_SCANNED_COUNT: Final = "aws.dynamodb.scanned_count"
"""
The value of the `ScannedCount` response parameter.
"""

AWS_DYNAMODB_SEGMENT: Final = "aws.dynamodb.segment"
"""
The value of the `Segment` request parameter.
"""

AWS_DYNAMODB_SELECT: Final = "aws.dynamodb.select"
"""
The value of the `Select` request parameter.
"""

AWS_DYNAMODB_TABLE_COUNT: Final = "aws.dynamodb.table_count"
"""
The number of items in the `TableNames` response parameter.
"""

AWS_DYNAMODB_TABLE_NAMES: Final = "aws.dynamodb.table_names"
"""
The keys in the `RequestItems` object field.
"""

AWS_DYNAMODB_TOTAL_SEGMENTS: Final = "aws.dynamodb.total_segments"
"""
The value of the `TotalSegments` request parameter.
"""

AWS_ECS_CLUSTER_ARN: Final = "aws.ecs.cluster.arn"
"""
The ARN of an [ECS cluster](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html).
"""

AWS_ECS_CONTAINER_ARN: Final = "aws.ecs.container.arn"
"""
The Amazon Resource Name (ARN) of an [ECS container instance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_instances.html).
"""

AWS_ECS_LAUNCHTYPE: Final = "aws.ecs.launchtype"
"""
The [launch type](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/launch_types.html) for an ECS task.
"""

AWS_ECS_TASK_ARN: Final = "aws.ecs.task.arn"
"""
The ARN of a running [ECS task](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-account-settings.html#ecs-resource-ids).
"""

AWS_ECS_TASK_FAMILY: Final = "aws.ecs.task.family"
"""
The family name of the [ECS task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) used to create the ECS task.
"""

AWS_ECS_TASK_ID: Final = "aws.ecs.task.id"
"""
The ID of a running ECS task. The ID MUST be extracted from `task.arn`.
"""

AWS_ECS_TASK_REVISION: Final = "aws.ecs.task.revision"
"""
The revision for the task definition used to create the ECS task.
"""

AWS_EKS_CLUSTER_ARN: Final = "aws.eks.cluster.arn"
"""
The ARN of an EKS cluster.
"""

AWS_EXTENDED_REQUEST_ID: Final = "aws.extended_request_id"
"""
The AWS extended request ID as returned in the response header `x-amz-id-2`.
"""

AWS_KINESIS_STREAM_NAME: Final = "aws.kinesis.stream_name"
"""
The name of the AWS Kinesis [stream](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) the request refers to. Corresponds to the `--stream-name` parameter of the Kinesis [describe-stream](https://docs.aws.amazon.com/cli/latest/reference/kinesis/describe-stream.html) operation.
"""

AWS_LAMBDA_INVOKED_ARN: Final = "aws.lambda.invoked_arn"
"""
The full invoked ARN as provided on the `Context` passed to the function (`Lambda-Runtime-Invoked-Function-Arn` header on the `/runtime/invocation/next` applicable).
Note: This may be different from `cloud.resource_id` if an alias is involved.
"""

AWS_LAMBDA_RESOURCE_MAPPING_ID: Final = "aws.lambda.resource_mapping.id"
"""
The UUID of the [AWS Lambda EvenSource Mapping](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-eventsourcemapping.html). An event source is mapped to a lambda function. It's contents are read by Lambda and used to trigger a function. This isn't available in the lambda execution context or the lambda runtime environtment. This is going to be populated by the AWS SDK for each language when that UUID is present. Some of these operations are Create/Delete/Get/List/Update EventSourceMapping.
"""

AWS_LOG_GROUP_ARNS: Final = "aws.log.group.arns"
"""
The Amazon Resource Name(s) (ARN) of the AWS log group(s).
Note: See the [log group ARN format documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html#CWL_ARN_Format).
"""

AWS_LOG_GROUP_NAMES: Final = "aws.log.group.names"
"""
The name(s) of the AWS log group(s) an application is writing to.
Note: Multiple log groups must be supported for cases like multi-container applications, where a single application has sidecar containers, and each write to their own log group.
"""

AWS_LOG_STREAM_ARNS: Final = "aws.log.stream.arns"
"""
The ARN(s) of the AWS log stream(s).
Note: See the [log stream ARN format documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html#CWL_ARN_Format). One log group can contain several log streams, so these ARNs necessarily identify both a log group and a log stream.
"""

AWS_LOG_STREAM_NAMES: Final = "aws.log.stream.names"
"""
The name(s) of the AWS log stream(s) an application is writing to.
"""

AWS_REQUEST_ID: Final = "aws.request_id"
"""
The AWS request ID as returned in the response headers `x-amzn-requestid`, `x-amzn-request-id` or `x-amz-request-id`.
"""

AWS_S3_BUCKET: Final = "aws.s3.bucket"
"""
The S3 bucket name the request refers to. Corresponds to the `--bucket` parameter of the [S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/index.html) operations.
Note: The `bucket` attribute is applicable to all S3 operations that reference a bucket, i.e. that require the bucket name as a mandatory parameter.
This applies to almost all S3 operations except `list-buckets`.
"""

AWS_S3_COPY_SOURCE: Final = "aws.s3.copy_source"
"""
The source object (in the form `bucket`/`key`) for the copy operation.
Note: The `copy_source` attribute applies to S3 copy operations and corresponds to the `--copy-source` parameter
of the [copy-object operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/copy-object.html).
This applies in particular to the following operations:

- [copy-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/copy-object.html)
- [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html).
"""

AWS_S3_DELETE: Final = "aws.s3.delete"
"""
The delete request container that specifies the objects to be deleted.
Note: The `delete` attribute is only applicable to the [delete-object](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-object.html) operation.
The `delete` attribute corresponds to the `--delete` parameter of the
[delete-objects operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-objects.html).
"""

AWS_S3_KEY: Final = "aws.s3.key"
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

AWS_S3_PART_NUMBER: Final = "aws.s3.part_number"
"""
The part number of the part being uploaded in a multipart-upload operation. This is a positive integer between 1 and 10,000.
Note: The `part_number` attribute is only applicable to the [upload-part](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html)
and [upload-part-copy](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part-copy.html) operations.
The `part_number` attribute corresponds to the `--part-number` parameter of the
[upload-part operation within the S3 API](https://docs.aws.amazon.com/cli/latest/reference/s3api/upload-part.html).
"""

AWS_S3_UPLOAD_ID: Final = "aws.s3.upload_id"
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

AWS_SECRETSMANAGER_SECRET_ARN: Final = "aws.secretsmanager.secret.arn"
"""
The ARN of the Secret stored in the Secrets Mangger.
"""

AWS_SNS_TOPIC_ARN: Final = "aws.sns.topic.arn"
"""
The ARN of the AWS SNS Topic. An Amazon SNS [topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html) is a logical access point that acts as a communication channel.
"""

AWS_SQS_QUEUE_URL: Final = "aws.sqs.queue.url"
"""
The URL of the AWS SQS Queue. It's a unique identifier for a queue in Amazon Simple Queue Service (SQS) and is used to access the queue and perform actions on it.
"""

AWS_STEP_FUNCTIONS_ACTIVITY_ARN: Final = "aws.step_functions.activity.arn"
"""
The ARN of the AWS Step Functions Activity.
"""

AWS_STEP_FUNCTIONS_STATE_MACHINE_ARN: Final = (
    "aws.step_functions.state_machine.arn"
)
"""
The ARN of the AWS Step Functions State Machine.
"""


class AwsEcsLaunchtypeValues(Enum):
    EC2 = "ec2"
    """ec2."""
    FARGATE = "fargate"
    """fargate."""
