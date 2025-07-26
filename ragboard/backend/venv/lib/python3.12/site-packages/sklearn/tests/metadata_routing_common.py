from functools import partial

import numpy as np

from sklearn.base import (
    BaseEstimator,
    ClassifierMixin,
    MetaEstimatorMixin,
    RegressorMixin,
    TransformerMixin,
    clone,
)
from sklearn.metrics._scorer import _Scorer, mean_squared_error
from sklearn.model_selection import BaseCrossValidator
from sklearn.model_selection._split import GroupsConsumerMixin
from sklearn.utils._metadata_requests import (
    SIMPLE_METHODS,
)
from sklearn.utils.metadata_routing import (
    MetadataRouter,
    process_routing,
)
from sklearn.utils.multiclass import _check_partial_fit_first_call


def record_metadata(obj, method, record_default=True, **kwargs):
    """Utility function to store passed metadata to a method.

    If record_default is False, kwargs whose values are "default" are skipped.
    This is so that checks on keyword arguments whose default was not changed
    are skipped.

    """
    if not hasattr(obj, "_records"):
        obj._records = {}
    if not record_default:
        kwargs = {
            key: val
            for key, val in kwargs.items()
            if not isinstance(val, str) or (val != "default")
        }
    obj._records[method] = kwargs


def check_recorded_metadata(obj, method, split_params=tuple(), **kwargs):
    """Check whether the expected metadata is passed to the object's method.

    Parameters
    ----------
    obj : estimator object
        sub-estimator to check routed params for
    method : str
        sub-estimator's method where metadata is routed to
    split_params : tuple, default=empty
        specifies any parameters which are to be checked as being a subset
        of the original values.
    """
    records = getattr(obj, "_records", dict()).get(method, dict())
    assert set(kwargs.keys()) == set(records.keys())
    for key, value in kwargs.items():
        recorded_value = records[key]
        # The following condition is used to check for any specified parameters
        # being a subset of the original values
        if key in split_params and recorded_value is not None:
            assert np.isin(recorded_value, value).all()
        else:
            assert recorded_value is value


record_metadata_not_default = partial(record_metadata, record_default=False)


def assert_request_is_empty(metadata_request, exclude=None):
    """Check if a metadata request dict is empty.

    One can exclude a method or a list of methods from the check using the
    ``exclude`` parameter. If metadata_request is a MetadataRouter, then
    ``exclude`` can be of the form ``{"object" : [method, ...]}``.
    """
    if isinstance(metadata_request, MetadataRouter):
        for name, route_mapping in metadata_request:
            if exclude is not None and name in exclude:
                _exclude = exclude[name]
            else:
                _exclude = None
            assert_request_is_empty(route_mapping.router, exclude=_exclude)
        return

    exclude = [] if exclude is None else exclude
    for method in SIMPLE_METHODS:
        if method in exclude:
            continue
        mmr = getattr(metadata_request, method)
        props = [
            prop
            for prop, alias in mmr.requests.items()
            if isinstance(alias, str) or alias is not None
        ]
        assert not props


def assert_request_equal(request, dictionary):
    for method, requests in dictionary.items():
        mmr = getattr(request, method)
        assert mmr.requests == requests

    empty_methods = [method for method in SIMPLE_METHODS if method not in dictionary]
    for method in empty_methods:
        assert not len(getattr(request, method).requests)


class _Registry(list):
    # This list is used to get a reference to the sub-estimators, which are not
    # necessarily stored on the metaestimator. We need to override __deepcopy__
    # because the sub-estimators are probably cloned, which would result in a
    # new copy of the list, but we need copy and deep copy both to return the
    # same instance.
    def __deepcopy__(self, memo):
        return self

    def __copy__(self):
        return self


class ConsumingRegressor(RegressorMixin, BaseEstimator):
    """A regressor consuming metadata.

    Parameters
    ----------
    registry : list, default=None
        If a list, the estimator will append itself to the list in order to have
        a reference to the estimator later on. Since that reference is not
        required in all tests, registration can be skipped by leaving this value
        as None.
    """

    def __init__(self, registry=None):
        self.registry = registry

    def partial_fit(self, X, y, sample_weight="default", metadata="default"):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(
            self, "partial_fit", sample_weight=sample_weight, metadata=metadata
        )
        return self

    def fit(self, X, y, sample_weight="default", metadata="default"):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(
            self, "fit", sample_weight=sample_weight, metadata=metadata
        )
        return self

    def predict(self, X, sample_weight="default", metadata="default"):
        pass  # pragma: no cover

        # when needed, uncomment the implementation
        # record_metadata_not_default(
        #     self, "predict", sample_weight=sample_weight, metadata=metadata
        # )
        # return np.zeros(shape=(len(X),))


class NonConsumingClassifier(ClassifierMixin, BaseEstimator):
    """A classifier which accepts no metadata on any method."""

    def __init__(self, registry=None):
        self.registry = registry

    def fit(self, X, y):
        if self.registry is not None:
            self.registry.append(self)

        self.classes_ = np.unique(y)
        return self

    def predict(self, X):
        return np.ones(len(X))  # pragma: no cover


class ConsumingClassifier(ClassifierMixin, BaseEstimator):
    """A classifier consuming metadata.

    Parameters
    ----------
    registry : list, default=None
        If a list, the estimator will append itself to the list in order to have
        a reference to the estimator later on. Since that reference is not
        required in all tests, registration can be skipped by leaving this value
        as None.

    alpha : float, default=0
        This parameter is only used to test the ``*SearchCV`` objects, and
        doesn't do anything.
    """

    def __init__(self, registry=None, alpha=0.0):
        self.alpha = alpha
        self.registry = registry

    def partial_fit(
        self, X, y, classes=None, sample_weight="default", metadata="default"
    ):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(
            self, "partial_fit", sample_weight=sample_weight, metadata=metadata
        )
        _check_partial_fit_first_call(self, classes)
        return self

    def fit(self, X, y, sample_weight="default", metadata="default"):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(
            self, "fit", sample_weight=sample_weight, metadata=metadata
        )
        self.classes_ = np.unique(y)
        return self

    def predict(self, X, sample_weight="default", metadata="default"):
        record_metadata_not_default(
            self, "predict", sample_weight=sample_weight, metadata=metadata
        )
        return np.zeros(shape=(len(X),))

    def predict_proba(self, X, sample_weight="default", metadata="default"):
        pass  # pragma: no cover

        # uncomment when needed
        # record_metadata_not_default(
        #     self, "predict_proba", sample_weight=sample_weight, metadata=metadata
        # )
        # return np.asarray([[0.0, 1.0]] * len(X))

    def predict_log_proba(self, X, sample_weight="default", metadata="default"):
        pass  # pragma: no cover

        # uncomment when needed
        # record_metadata_not_default(
        #     self, "predict_log_proba", sample_weight=sample_weight, metadata=metadata
        # )
        # return np.zeros(shape=(len(X), 2))

    def decision_function(self, X, sample_weight="default", metadata="default"):
        record_metadata_not_default(
            self, "predict_proba", sample_weight=sample_weight, metadata=metadata
        )
        return np.zeros(shape=(len(X),))


class ConsumingTransformer(TransformerMixin, BaseEstimator):
    """A transformer which accepts metadata on fit and transform.

    Parameters
    ----------
    registry : list, default=None
        If a list, the estimator will append itself to the list in order to have
        a reference to the estimator later on. Since that reference is not
        required in all tests, registration can be skipped by leaving this value
        as None.
    """

    def __init__(self, registry=None):
        self.registry = registry

    def fit(self, X, y=None, sample_weight=None, metadata=None):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(
            self, "fit", sample_weight=sample_weight, metadata=metadata
        )
        return self

    def transform(self, X, sample_weight=None, metadata=None):
        record_metadata(
            self, "transform", sample_weight=sample_weight, metadata=metadata
        )
        return X

    def fit_transform(self, X, y, sample_weight=None, metadata=None):
        # implementing ``fit_transform`` is necessary since
        # ``TransformerMixin.fit_transform`` doesn't route any metadata to
        # ``transform``, while here we want ``transform`` to receive
        # ``sample_weight`` and ``metadata``.
        record_metadata(
            self, "fit_transform", sample_weight=sample_weight, metadata=metadata
        )
        return self.fit(X, y, sample_weight=sample_weight, metadata=metadata).transform(
            X, sample_weight=sample_weight, metadata=metadata
        )

    def inverse_transform(self, X, sample_weight=None, metadata=None):
        record_metadata(
            self, "inverse_transform", sample_weight=sample_weight, metadata=metadata
        )
        return X


class ConsumingScorer(_Scorer):
    def __init__(self, registry=None):
        super().__init__(
            score_func=mean_squared_error, sign=1, kwargs={}, response_method="predict"
        )
        self.registry = registry

    def _score(self, method_caller, clf, X, y, **kwargs):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(self, "score", **kwargs)

        sample_weight = kwargs.get("sample_weight", None)
        return super()._score(method_caller, clf, X, y, sample_weight=sample_weight)


class ConsumingSplitter(BaseCrossValidator, GroupsConsumerMixin):
    def __init__(self, registry=None):
        self.registry = registry

    def split(self, X, y=None, groups="default", metadata="default"):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata_not_default(self, "split", groups=groups, metadata=metadata)

        split_index = len(X) // 2
        train_indices = list(range(0, split_index))
        test_indices = list(range(split_index, len(X)))
        yield test_indices, train_indices
        yield train_indices, test_indices

    def get_n_splits(self, X=None, y=None, groups=None, metadata=None):
        return 2

    def _iter_test_indices(self, X=None, y=None, groups=None):
        split_index = len(X) // 2
        train_indices = list(range(0, split_index))
        test_indices = list(range(split_index, len(X)))
        yield test_indices
        yield train_indices


class MetaRegressor(MetaEstimatorMixin, RegressorMixin, BaseEstimator):
    """A meta-regressor which is only a router."""

    def __init__(self, estimator):
        self.estimator = estimator

    def fit(self, X, y, **fit_params):
        params = process_routing(self, "fit", **fit_params)
        self.estimator_ = clone(self.estimator).fit(X, y, **params.estimator.fit)

    def get_metadata_routing(self):
        router = MetadataRouter(owner=self.__class__.__name__).add(
            estimator=self.estimator, method_mapping="one-to-one"
        )
        return router


class WeightedMetaRegressor(MetaEstimatorMixin, RegressorMixin, BaseEstimator):
    """A meta-regressor which is also a consumer."""

    def __init__(self, estimator, registry=None):
        self.estimator = estimator
        self.registry = registry

    def fit(self, X, y, sample_weight=None, **fit_params):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata(self, "fit", sample_weight=sample_weight)
        params = process_routing(self, "fit", sample_weight=sample_weight, **fit_params)
        self.estimator_ = clone(self.estimator).fit(X, y, **params.estimator.fit)
        return self

    def predict(self, X, **predict_params):
        params = process_routing(self, "predict", **predict_params)
        return self.estimator_.predict(X, **params.estimator.predict)

    def get_metadata_routing(self):
        router = (
            MetadataRouter(owner=self.__class__.__name__)
            .add_self_request(self)
            .add(estimator=self.estimator, method_mapping="one-to-one")
        )
        return router


class WeightedMetaClassifier(MetaEstimatorMixin, ClassifierMixin, BaseEstimator):
    """A meta-estimator which also consumes sample_weight itself in ``fit``."""

    def __init__(self, estimator, registry=None):
        self.estimator = estimator
        self.registry = registry

    def fit(self, X, y, sample_weight=None, **kwargs):
        if self.registry is not None:
            self.registry.append(self)

        record_metadata(self, "fit", sample_weight=sample_weight)
        params = process_routing(self, "fit", sample_weight=sample_weight, **kwargs)
        self.estimator_ = clone(self.estimator).fit(X, y, **params.estimator.fit)
        return self

    def get_metadata_routing(self):
        router = (
            MetadataRouter(owner=self.__class__.__name__)
            .add_self_request(self)
            .add(estimator=self.estimator, method_mapping="fit")
        )
        return router


class MetaTransformer(MetaEstimatorMixin, TransformerMixin, BaseEstimator):
    """A simple meta-transformer."""

    def __init__(self, transformer):
        self.transformer = transformer

    def fit(self, X, y=None, **fit_params):
        params = process_routing(self, "fit", **fit_params)
        self.transformer_ = clone(self.transformer).fit(X, y, **params.transformer.fit)
        return self

    def transform(self, X, y=None, **transform_params):
        params = process_routing(self, "transform", **transform_params)
        return self.transformer_.transform(X, **params.transformer.transform)

    def get_metadata_routing(self):
        return MetadataRouter(owner=self.__class__.__name__).add(
            transformer=self.transformer, method_mapping="one-to-one"
        )
