from typing import NamedTuple, Optional, Dict

class PodSpec(NamedTuple):
    """
    PodSpec represents the configuration used to deploy a pod-based index.
    
    To learn more about the options for each configuration, please see [Understanding Indexes](https://docs.pinecone.io/docs/indexes)
    """
    
    environment: str
    """
    The environment where the pod index will be deployed. Example: 'us-east1-gcp'
    """

    replicas: Optional[int] = None
    """
    The number of replicas to deploy for the pod index. Default: 1
    """

    shards: Optional[int] = None
    """
    The number of shards to use. Shards are used to expand the amount of vectors you can store beyond the capacity of a single pod. Default: 1
    """

    pods: Optional[int] = None
    """
    Number of pods to deploy. Default: 1
    """

    pod_type: Optional[str] = "p1.x1"
    """
    This value combines pod type and pod size into a single string. This configuration is your main lever for vertical scaling.
    """

    metadata_config: Optional[Dict] = {}
    """
    If you are storing a lot of metadata, you can use this configuration to limit the fields which are indexed for search. 

    This configuration should be a dictionary with the key 'indexed' and the value as a list of fields to index.

    For example, if your vectors have metadata along like this:
    
    ```python
    from pinecone import Vector

    vector = Vector(
        id='237438191', 
        values=[...], 
        metadata={
            'productId': '237438191',
            'description': 'Stainless Steel Tumbler with Straw',
            'category': 'kitchen',
            'price': '19.99'
        }
    )
    ```

    You might want to limit which fields are indexed with metadata config such as this: 
    ```
    {'indexed': ['field1', 'field2']}
    """

    def asdict(self):
        """
        Returns the PodSpec as a dictionary.
        """
        return {"pod": self._asdict()}