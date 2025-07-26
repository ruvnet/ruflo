import time
from typing import Optional, Dict, Any, Union, List, cast, NamedTuple

from .index_host_store import IndexHostStore

from pinecone.config import PineconeConfig, Config

from pinecone.core.client.api.manage_indexes_api import ManageIndexesApi
from pinecone.core.client.api_client import ApiClient
from pinecone.utils import get_user_agent, normalize_host
from pinecone.core.client.models import (
    CreateCollectionRequest,
    CreateIndexRequest,
    ConfigureIndexRequest,
    ConfigureIndexRequestSpec,
    ConfigureIndexRequestSpecPod
)
from pinecone.models import ServerlessSpec, PodSpec, IndexList, CollectionList

from pinecone.data import Index

class Pinecone:

    def __init__(
        self,
        api_key: Optional[str] = None,
        host: Optional[str] = None,
        config: Optional[Config] = None,
        additional_headers: Optional[Dict[str, str]] = {},
        pool_threads: Optional[int] = 1,
        index_api: Optional[ManageIndexesApi] = None,
        **kwargs,
    ):
        """
        The `Pinecone` class is the main entry point for interacting with Pinecone via this Python SDK. 
        It is used to create, delete, and manage your indexes and collections.

        :param api_key: The API key to use for authentication. If not passed via kwarg, the API key will be read from the environment variable `PINECONE_API_KEY`.
        :type api_key: str, optional
        :param host: The control plane host to connect to.
        :type host: str, optional
        :param config: A `pinecone.config.Config` object. If passed, the `api_key` and `host` parameters will be ignored.
        :type config: pinecone.config.Config, optional
        :param additional_headers: Additional headers to pass to the API. Default: `{}`
        :type additional_headers: Dict[str, str], optional
        :param pool_threads: The number of threads to use for the connection pool. Default: `1`
        :type pool_threads: int, optional
        :param index_api: An instance of `pinecone.core.client.api.manage_indexes_api.ManageIndexesApi`. If passed, the `host` parameter will be ignored.
        :type index_api: pinecone.core.client.api.manage_indexes_api.ManageIndexesApi, optional

        
        ### Configuration with environment variables

        If you instantiate the Pinecone client with no arguments, it will attempt to read the API key from the environment variable `PINECONE_API_KEY`.

        ```python
        from pinecone import Pinecone

        pc = Pinecone()
        ```

        ### Configuration with keyword arguments

        If you prefer being more explicit in your code, you can also pass the API  as a keyword argument.

        ```python
        import os
        from pinecone import Pinecone

        pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
        ```

        ### Environment variables

        The Pinecone client supports the following environment variables:

        - `PINECONE_API_KEY`: The API key to use for authentication. If not passed via 
        kwarg, the API key will be read from the environment variable `PINECONE_API_KEY`.

        - `PINECONE_DEBUG_CURL`: When troubleshooting it can be very useful to run curl 
        commands against the control plane API to see exactly what data is being sent 
        and received without all the abstractions and transformations applied by the Python
        SDK. If you set this environment variable to `true`, the Pinecone client will use
        request parameters to print out an equivalent curl command that you can run yourself
        or share with Pinecone support. **Be very careful with this option, as it will print out 
        your API key** which forms part of a required authentication header. Default: `false`
        """
        if config or kwargs.get("config"):
            configKwarg = config or kwargs.get("config")
            if not isinstance(configKwarg, Config):
                raise TypeError("config must be of type pinecone.config.Config")
            else:
                self.config = configKwarg
        else:
            self.config = PineconeConfig.build(api_key=api_key, host=host, additional_headers=additional_headers, **kwargs)

        if index_api:
            self.index_api = index_api
        else:
            self.pool_threads = pool_threads
            api_client = ApiClient(configuration=self.config.openapi_config, pool_threads=self.pool_threads)
            api_client.user_agent = get_user_agent()
            extra_headers = self.config.additional_headers or {}
            for key, value in extra_headers.items():
                api_client.set_default_header(key, value)
            self.index_api = ManageIndexesApi(api_client)

        self.index_host_store = IndexHostStore()
        """ @private """

    def create_index(
        self,
        name: str,
        dimension: int,
        spec: Union[Dict, ServerlessSpec, PodSpec],
        metric: Optional[str] = "cosine",
        timeout: Optional[int] = None,
    ):
        """Creates a Pinecone index.

        :param name: The name of the index to create. Must be unique within your project and 
            cannot be changed once created. Allowed characters are lowercase letters, numbers, 
            and hyphens and the name may not begin or end with hyphens. Maximum length is 45 characters.
        :type name: str
        :param dimension: The dimension of vectors that will be inserted in the index. This should
            match the dimension of the embeddings you will be inserting. For example, if you are using
            OpenAI's CLIP model, you should use `dimension=1536`.
        :type dimension: int
        :param metric: Type of metric used in the vector index when querying, one of `{"cosine", "dotproduct", "euclidean"}`. Defaults to `"cosine"`.
            Defaults to `"cosine"`.
        :type metric: str, optional
        :param spec: A dictionary containing configurations describing how the index should be deployed. For serverless indexes,
            specify region and cloud. For pod indexes, specify replicas, shards, pods, pod_type, metadata_config, and source_collection.
        :type spec: Dict
        :type timeout: int, optional
        :param timeout: Specify the number of seconds to wait until index gets ready. If None, wait indefinitely; if >=0, time out after this many seconds;
            if -1, return immediately and do not wait. Default: None

        ### Creating a serverless index
        
        ```python
        import os
        from pinecone import Pinecone, ServerlessSpec

        client = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

        client.create_index(
            name="my_index", 
            dimension=1536, 
            metric="cosine", 
            spec=ServerlessSpec(cloud="aws", region="us-west-2")
        )
        ```

        ### Creating a pod index

        ```python
        import os
        from pinecone import Pinecone, PodSpec

        client = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

        client.create_index(
            name="my_index",
            dimension=1536,
            metric="cosine",
            spec=PodSpec(
                environment="us-east1-gcp", 
                pod_type="p1.x1"
            )
        )
        ```
        """

        api_instance = self.index_api

        if isinstance(spec, dict):
            api_instance.create_index(create_index_request=CreateIndexRequest(name=name, dimension=dimension, metric=metric, spec=spec))
        elif isinstance(spec, ServerlessSpec):
            api_instance.create_index(create_index_request=CreateIndexRequest(name=name, dimension=dimension, metric=metric, spec=spec.asdict()))
        elif isinstance(spec, PodSpec):
            api_instance.create_index(create_index_request=CreateIndexRequest(name=name, dimension=dimension, metric=metric, spec=spec.asdict()))
        else:
            raise TypeError("spec must be of type dict, ServerlessSpec, or PodSpec")

        def is_ready():
            status = self._get_status(name)
            ready = status["ready"]
            return ready

        if timeout == -1:
            return
        if timeout is None:
            while not is_ready():
                time.sleep(5)
        else:
            while (not is_ready()) and timeout >= 0:
                time.sleep(5)
                timeout -= 5
        if timeout and timeout < 0:
            raise (
                TimeoutError(
                    "Please call the describe_index API ({}) to confirm index status.".format(
                        "https://www.pinecone.io/docs/api/operation/describe_index/"
                    )
                )
            )

    def delete_index(self, name: str, timeout: Optional[int] = None):
        """Deletes a Pinecone index.

        Deleting an index is an irreversible operation. All data in the index will be lost.
        When you use this command, a request is sent to the Pinecone control plane to delete 
        the index, but the termination is not synchronous because resources take a few moments to
        be released. 
        
        You can check the status of the index by calling the `describe_index()` command.
        With repeated polling of the describe_index command, you will see the index transition to a 
        `Terminating` state before eventually resulting in a 404 after it has been removed.

        :param name: the name of the index.
        :type name: str
        :param timeout: Number of seconds to poll status checking whether the index has been deleted. If None, 
            wait indefinitely; if >=0, time out after this many seconds;
            if -1, return immediately and do not wait. Default: None
        :type timeout: int, optional
        """
        api_instance = self.index_api
        api_instance.delete_index(name)
        self.index_host_store.delete_host(self.config, name)

        def get_remaining():
            return name in self.list_indexes().names()

        if timeout == -1:
            return

        if timeout is None:
            while get_remaining():
                time.sleep(5)
        else:
            while get_remaining() and timeout >= 0:
                time.sleep(5)
                timeout -= 5
        if timeout and timeout < 0:
            raise (
                TimeoutError(
                    "Please call the list_indexes API ({}) to confirm if index is deleted".format(
                        "https://www.pinecone.io/docs/api/operation/list_indexes/"
                    )
                )
            )

    def list_indexes(self) -> IndexList:
        """Lists all indexes.
        
        The results include a description of all indexes in your project, including the 
        index name, dimension, metric, status, and spec.

        :return: Returns an `IndexList` object, which is iterable and contains a 
            list of `IndexDescription` objects. It also has a convenience method `names()`
            which returns a list of index names.

        ```python
        from pinecone import Pinecone

        client = Pinecone()

        index_name = "my_index"
        if index_name not in client.list_indexes().names():
            print("Index does not exist, creating...")
            client.create_index(
                name=index_name,
                dimension=768,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-west-2")
            )
        ```
        
        You can also use the `list_indexes()` method to iterate over all indexes in your project
        and get other information besides just names.

        ```python
        from pinecone import Pinecone

        client = Pinecone()

        for index in client.list_indexes():
            print(index.name)
            print(index.dimension)
            print(index.metric)
            print(index.status)
            print(index.host)
            print(index.spec)
        ```

        """
        response = self.index_api.list_indexes()
        return IndexList(response)

    def describe_index(self, name: str):
        """Describes a Pinecone index.

        :param name: the name of the index to describe.
        :return: Returns an `IndexDescription` object
        which gives access to properties such as the 
        index name, dimension, metric, host url, status, 
        and spec.

        ### Getting your index host url

        In a real production situation, you probably want to
        store the host url in an environment variable so you
        don't have to call describe_index and re-fetch it 
        every time you want to use the index. But this example
        shows how to get the value from the API using describe_index.

        ```python
        from pinecone import Pinecone, Index

        client = Pinecone()

        description = client.describe_index("my_index")
        
        host = description.host
        print(f"Your index is hosted at {description.host}")

        index = client.Index(name="my_index", host=host)
        index.upsert(vectors=[...])
        ```
        """
        api_instance = self.index_api
        description = api_instance.describe_index(name)
        host = description.host
        self.index_host_store.set_host(self.config, name, host)

        return description

    def configure_index(self, name: str, replicas: Optional[int] = None, pod_type: Optional[str] = None):
        """This method is used to scale configuration fields for your pod-based Pinecone index. 

        :param: name: the name of the Index
        :param: replicas: the desired number of replicas, lowest value is 0.
        :param: pod_type: the new pod_type for the index. To learn more about the
            available pod types, please see [Understanding Indexes](https://docs.pinecone.io/docs/indexes)
        
        
        ```python
        from pinecone import Pinecone

        client = Pinecone()

        # Make a configuration change
        client.configure_index(name="my_index", replicas=4)

        # Call describe_index to see the index status as the 
        # change is applied.
        client.describe_index("my_index")
        ```

        """
        api_instance = self.index_api
        config_args: Dict[str, Any] = {}
        if pod_type:
            config_args.update(pod_type=pod_type)
        if replicas:
            config_args.update(replicas=replicas)
        configure_index_request = ConfigureIndexRequest(
            spec=ConfigureIndexRequestSpec(
                pod=ConfigureIndexRequestSpecPod(**config_args)
            )
        )
        api_instance.configure_index(name, configure_index_request=configure_index_request)

    def create_collection(self, name: str, source: str):
        """Create a collection from a pod-based index

        :param name: Name of the collection
        :param source: Name of the source index
        """
        api_instance = self.index_api
        api_instance.create_collection(create_collection_request=CreateCollectionRequest(name=name, source=source))

    def list_collections(self) -> CollectionList:
        """List all collections
        
        ```python
        from pinecone import Pinecone

        client = Pinecone()

        for collection in client.list_collections():
            print(collection.name)
            print(collection.source)

        # You can also iterate specifically over the collection
        # names with the .names() helper.
        collection_name="my_collection"
        for collection_name in client.list_collections().names():
            print(collection_name)
        ```
        """
        api_instance = self.index_api
        response = api_instance.list_collections()
        return CollectionList(response)

    def delete_collection(self, name: str):
        """Deletes a collection.

        :param: name: The name of the collection

        Deleting a collection is an irreversible operation. All data 
        in the collection will be lost.

        This method tells Pinecone you would like to delete a collection,
        but it takes a few moments to complete the operation. Use the 
        `describe_collection()` method to confirm that the collection 
        has been deleted.
        """
        api_instance = self.index_api
        api_instance.delete_collection(name)

    def describe_collection(self, name: str):
        """Describes a collection.
        :param: The name of the collection
        :return: Description of the collection

        ```python
        from pinecone import Pinecone
        
        client = Pinecone()

        description = client.describe_collection("my_collection")
        print(description.name)
        print(description.source)
        print(description.status)
        print(description.size)
        print(description.)
        ```
        """
        api_instance = self.index_api
        return api_instance.describe_collection(name).to_dict()

    def _get_status(self, name: str):
        api_instance = self.index_api
        response = api_instance.describe_index(name)
        return response["status"]

    def Index(self, name: str = '', host: str = ''):
        """
        Target an index for data operations.

        ### Target an index by host url

        In production situations, you want to uspert or query your data as quickly
        as possible. If you know in advance the host url of your index, you can
        eliminate a round trip to the Pinecone control plane by specifying the 
        host of the index.

        ```python
        import os
        from pinecone import Pinecone

        api_key = os.environ.get("PINECONE_API_KEY")
        index_host = os.environ.get("PINECONE_INDEX_HOST")
        
        pc = Pinecone(api_key=api_key)
        index = pc.Index(host=index_host)

        # Now you're ready to perform data operations
        index.query(vector=[...], top_k=10)
        ```

        To find your host url, you can use the Pinecone control plane to describe
        the index. The host url is returned in the response. Or, alternatively, the
        host is displayed in the Pinecone web console.

        ```python
        import os
        from pinecone import Pinecone

        pc = Pinecone(
            api_key=os.environ.get("PINECONE_API_KEY")
        )

        host = pc.describe_index('index-name').host
        ```

        ### Target an index by name (not recommended for production)

        For more casual usage, such as when you are playing and exploring with Pinecone
        in a notebook setting, you can also target an index by name. If you use this
        approach, the client may need to perform an extra call to the Pinecone control 
        plane to get the host url on your behalf to get the index host.

        The client will cache the index host for future use whenever it is seen, so you 
        will only incur the overhead of only one call. But this approach is not 
        recommended for production usage.

        ```python
        import os
        from pinecone import Pinecone, ServerlessSpec

        api_key = os.environ.get("PINECONE_API_KEY")
        
        pc = Pinecone(api_key=api_key)
        pc.create_index(
            name='my-index',
            dimension=1536,
            metric='cosine',
            spec=ServerlessSpec(cloud='aws', region='us-west-2')
        )
        index = pc.Index('my-index')

        # Now you're ready to perform data operations
        index.query(vector=[...], top_k=10)
        ```
        """
        if name == '' and host == '':
            raise ValueError("Either name or host must be specified")

        if host != '':
            # Use host url if it is provided
            return Index(api_key=self.config.api_key, host=normalize_host(host), pool_threads=self.pool_threads)

        if name != '':
            # Otherwise, get host url from describe_index using the index name
            index_host = self.index_host_store.get_host(self.index_api, self.config, name)
            return Index(api_key=self.config.api_key, host=index_host, pool_threads=self.pool_threads)
