import threading
import time
from typing import Any, Callable, Dict, List, Optional, cast
from kubernetes import client, config, watch
from kubernetes.client.rest import ApiException
from overrides import EnforceOverrides, override
from chromadb.config import RoutingMode, System
from chromadb.segment.distributed import (
    Member,
    Memberlist,
    MemberlistProvider,
    SegmentDirectory,
)
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    add_attributes_to_current_span,
    trace_method,
)
from chromadb.types import Segment
from chromadb.utils.rendezvous_hash import assign, murmur3hasher

# These could go in config but given that they will rarely change, they are here for now to avoid
# polluting the config file further.
WATCH_TIMEOUT_SECONDS = 60
KUBERNETES_NAMESPACE = "chroma"
KUBERNETES_GROUP = "chroma.cluster"
HEADLESS_SERVICE = "svc.cluster.local"


class MockMemberlistProvider(MemberlistProvider, EnforceOverrides):
    """A mock memberlist provider for testing"""

    _memberlist: Memberlist

    def __init__(self, system: System):
        super().__init__(system)
        self._memberlist = [
            Member(id="a", ip="10.0.0.1", node="node1"),
            Member(id="b", ip="10.0.0.2", node="node2"),
            Member(id="c", ip="10.0.0.3", node="node3"),
        ]

    @override
    def get_memberlist(self) -> Memberlist:
        return self._memberlist

    @override
    def set_memberlist_name(self, memberlist: str) -> None:
        pass  # The mock provider does not need to set the memberlist name

    def update_memberlist(self, memberlist: Memberlist) -> None:
        """Updates the memberlist and calls all registered callbacks. This mocks an update from a k8s CR"""
        self._memberlist = memberlist
        for callback in self.callbacks:
            callback(memberlist)


class CustomResourceMemberlistProvider(MemberlistProvider, EnforceOverrides):
    """A memberlist provider that uses a k8s custom resource to store the memberlist"""

    _kubernetes_api: client.CustomObjectsApi
    _memberlist_name: Optional[str]
    _curr_memberlist: Optional[Memberlist]
    _curr_memberlist_mutex: threading.Lock
    _watch_thread: Optional[threading.Thread]
    _kill_watch_thread: threading.Event
    _done_waiting_for_reset: threading.Event

    def __init__(self, system: System):
        super().__init__(system)
        config.load_config()
        self._kubernetes_api = client.CustomObjectsApi()
        self._watch_thread = None
        self._memberlist_name = None
        self._curr_memberlist = None
        self._curr_memberlist_mutex = threading.Lock()
        self._kill_watch_thread = threading.Event()
        self._done_waiting_for_reset = threading.Event()

    @override
    def start(self) -> None:
        if self._memberlist_name is None:
            raise ValueError("Memberlist name must be set before starting")
        self.get_memberlist()
        self._done_waiting_for_reset.clear()
        self._watch_worker_memberlist()
        return super().start()

    @override
    def stop(self) -> None:
        self._curr_memberlist = None
        self._memberlist_name = None

        # Stop the watch thread
        self._kill_watch_thread.set()
        if self._watch_thread is not None:
            self._watch_thread.join()
        self._watch_thread = None
        self._kill_watch_thread.clear()
        self._done_waiting_for_reset.clear()
        return super().stop()

    @override
    def reset_state(self) -> None:
        # Reset the memberlist in kubernetes, and wait for it to
        # get propagated back again
        # Note that the component must be running in order to reset the state
        if not self._system.settings.require("allow_reset"):
            raise ValueError(
                "Resetting the database is not allowed. Set `allow_reset` to true in the config in tests or other non-production environments where reset should be permitted."
            )
        if self._memberlist_name:
            self._done_waiting_for_reset.clear()
            self._kubernetes_api.patch_namespaced_custom_object(
                group=KUBERNETES_GROUP,
                version="v1",
                namespace=KUBERNETES_NAMESPACE,
                plural="memberlists",
                name=self._memberlist_name,
                body={
                    "kind": "MemberList",
                    "spec": {"members": []},
                },
            )
            self._done_waiting_for_reset.wait(5.0)
            # TODO: For some reason the above can flake and the memberlist won't be populated
            # Given that this is a test harness, just sleep for an additional 500ms for now
            # We should understand why this flaps
            time.sleep(0.5)

    @override
    def get_memberlist(self) -> Memberlist:
        if self._curr_memberlist is None:
            self._curr_memberlist = self._fetch_memberlist()
        return self._curr_memberlist

    @override
    def set_memberlist_name(self, memberlist: str) -> None:
        self._memberlist_name = memberlist

    def _fetch_memberlist(self) -> Memberlist:
        api_response = self._kubernetes_api.get_namespaced_custom_object(
            group=KUBERNETES_GROUP,
            version="v1",
            namespace=KUBERNETES_NAMESPACE,
            plural="memberlists",
            name=f"{self._memberlist_name}",
        )
        api_response = cast(Dict[str, Any], api_response)
        if "spec" not in api_response:
            return []
        response_spec = cast(Dict[str, Any], api_response["spec"])
        return self._parse_response_memberlist(response_spec)

    def _watch_worker_memberlist(self) -> None:
        # TODO: We may want to make this watch function a library function that can be used by other
        # components that need to watch k8s custom resources.
        def run_watch() -> None:
            w = watch.Watch()

            def do_watch() -> None:
                for event in w.stream(
                    self._kubernetes_api.list_namespaced_custom_object,
                    group=KUBERNETES_GROUP,
                    version="v1",
                    namespace=KUBERNETES_NAMESPACE,
                    plural="memberlists",
                    field_selector=f"metadata.name={self._memberlist_name}",
                    timeout_seconds=WATCH_TIMEOUT_SECONDS,
                ):
                    event = cast(Dict[str, Any], event)
                    response_spec = event["object"]["spec"]
                    response_spec = cast(Dict[str, Any], response_spec)
                    with self._curr_memberlist_mutex:
                        self._curr_memberlist = self._parse_response_memberlist(
                            response_spec
                        )
                    self._notify(self._curr_memberlist)
                    if (
                        self._system.settings.require("allow_reset")
                        and not self._done_waiting_for_reset.is_set()
                        and len(self._curr_memberlist) > 0
                    ):
                        self._done_waiting_for_reset.set()

            # Watch the custom resource for changes
            # Watch with a timeout and retry so we can gracefully stop this if needed
            while not self._kill_watch_thread.is_set():
                try:
                    do_watch()
                except ApiException as e:
                    # If status code is 410, the watch has expired and we need to start a new one.
                    if e.status == 410:
                        pass
            return

        if self._watch_thread is None:
            thread = threading.Thread(target=run_watch, daemon=True)
            thread.start()
            self._watch_thread = thread
        else:
            raise Exception("A watch thread is already running.")

    def _parse_response_memberlist(
        self, api_response_spec: Dict[str, Any]
    ) -> Memberlist:
        if "members" not in api_response_spec:
            return []
        parsed = []
        for m in api_response_spec["members"]:
            id = m["member_id"]
            ip = m["member_ip"] if "member_ip" in m else ""
            node = m["member_node_name"] if "member_node_name" in m else ""
            parsed.append(Member(id=id, ip=ip, node=node))
        return parsed

    def _notify(self, memberlist: Memberlist) -> None:
        for callback in self.callbacks:
            callback(memberlist)


class RendezvousHashSegmentDirectory(SegmentDirectory, EnforceOverrides):
    _memberlist_provider: MemberlistProvider
    _curr_memberlist_mutex: threading.Lock
    _curr_memberlist: Optional[Memberlist]
    _routing_mode: RoutingMode

    def __init__(self, system: System):
        super().__init__(system)
        self._memberlist_provider = self.require(MemberlistProvider)
        memberlist_name = system.settings.require("worker_memberlist_name")
        self._memberlist_provider.set_memberlist_name(memberlist_name)
        self._routing_mode = system.settings.require(
            "chroma_segment_directory_routing_mode"
        )

        self._curr_memberlist = None
        self._curr_memberlist_mutex = threading.Lock()

    @override
    def start(self) -> None:
        self._curr_memberlist = self._memberlist_provider.get_memberlist()
        self._memberlist_provider.register_updated_memberlist_callback(
            self._update_memberlist
        )
        return super().start()

    @override
    def stop(self) -> None:
        self._memberlist_provider.unregister_updated_memberlist_callback(
            self._update_memberlist
        )
        return super().stop()

    @override
    def get_segment_endpoints(self, segment: Segment, n: int) -> List[str]:
        if self._curr_memberlist is None or len(self._curr_memberlist) == 0:
            raise ValueError("Memberlist is not initialized")

        # assign() will throw an error if n is greater than the number of members
        # clamp n to the number of members to align with the contract of this method
        # which is to return at most n endpoints
        n = min(n, len(self._curr_memberlist))

        # Check if all members in the memberlist have a node set,
        # if so, route using the node

        # NOTE(@hammadb) 1/8/2024: This is to handle the migration between routing
        # using the member id and routing using the node name
        # We want to route using the node name over the member id
        # because the node may have a disk cache that we want a
        # stable identifier for over deploys.
        can_use_node_routing = (
            all([m.node != "" and len(m.node) != 0 for m in self._curr_memberlist])
            and self._routing_mode == RoutingMode.NODE
        )
        if can_use_node_routing:
            # If we are using node routing and the segments
            assignments = assign(
                segment["collection"].hex,
                [m.node for m in self._curr_memberlist],
                murmur3hasher,
                n,
            )
        else:
            # Query to the same collection should end up on the same endpoint
            assignments = assign(
                segment["collection"].hex,
                [m.id for m in self._curr_memberlist],
                murmur3hasher,
                n,
            )
        assignments_set = set(assignments)
        out_endpoints = []
        for member in self._curr_memberlist:
            is_chosen_with_node_routing = (
                can_use_node_routing and member.node in assignments_set
            )
            is_chosen_with_id_routing = (
                not can_use_node_routing and member.id in assignments_set
            )
            if is_chosen_with_node_routing or is_chosen_with_id_routing:
                # If the memberlist has an ip, use it, otherwise use the member id with the headless service
                # this is for backwards compatibility with the old memberlist which only had ids
                if member.ip is not None and member.ip != "":
                    endpoint = f"{member.ip}:50051"
                    out_endpoints.append(endpoint)
                else:
                    service_name = self.extract_service_name(member.id)
                    endpoint = f"{member.id}.{service_name}.{KUBERNETES_NAMESPACE}.{HEADLESS_SERVICE}:50051"
                    out_endpoints.append(endpoint)
        return out_endpoints

    @override
    def register_updated_segment_callback(
        self, callback: Callable[[Segment], None]
    ) -> None:
        raise NotImplementedError()

    @trace_method(
        "RendezvousHashSegmentDirectory._update_memberlist",
        OpenTelemetryGranularity.ALL,
    )
    def _update_memberlist(self, memberlist: Memberlist) -> None:
        with self._curr_memberlist_mutex:
            add_attributes_to_current_span(
                {"new_memberlist": [m.id for m in memberlist]}
            )
            self._curr_memberlist = memberlist

    def extract_service_name(self, pod_name: str) -> Optional[str]:
        # Split the pod name by the hyphen
        parts = pod_name.split("-")
        # The service name is expected to be the prefix before the last hyphen
        if len(parts) > 1:
            return "-".join(parts[:-1])
        return None
