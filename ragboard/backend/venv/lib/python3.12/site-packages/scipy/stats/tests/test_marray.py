import pytest
import numpy as np
from scipy import stats

from scipy._lib._array_api import xp_assert_close, xp_assert_equal
from scipy.stats._stats_py import _xp_mean, _xp_var, _length_nonmasked
from scipy.stats._axis_nan_policy import _axis_nan_policy_factory


marray = pytest.importorskip('marray')
skip_backend = pytest.mark.skip_xp_backends


def get_arrays(n_arrays, *, dtype='float64', xp=np, shape=(7, 8), seed=84912165484321):
    mxp = marray._get_namespace(xp)
    rng = np.random.default_rng(seed)

    datas, masks = [], []
    for i in range(n_arrays):
        data = rng.random(size=shape)
        if dtype.startswith('complex'):
            data = 10*data * 10j*rng.standard_normal(size=shape)
        data = data.astype(dtype)
        datas.append(data)
        mask = rng.random(size=shape) > 0.75
        masks.append(mask)

    marrays = []
    nan_arrays = []
    for array, mask in zip(datas, masks):
        marrays.append(mxp.asarray(array, mask=mask))
        nan_array = array.copy()
        nan_array[mask] = xp.nan
        nan_arrays.append(nan_array)

    return mxp, marrays, nan_arrays


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="marray#99")
@pytest.mark.parametrize('fun, kwargs', [(stats.gmean, {}),
                                         (stats.hmean, {}),
                                         (stats.pmean, {'p': 2})])
@pytest.mark.parametrize('axis', [0, 1])
def test_xmean(fun, kwargs, axis, xp):
    mxp, marrays, narrays = get_arrays(2, xp=xp)
    res = fun(marrays[0], weights=marrays[1], axis=axis, **kwargs)
    ref = fun(narrays[0], weights=narrays[1], nan_policy='omit', axis=axis, **kwargs)
    xp_assert_close(res.data, xp.asarray(ref))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="marray#99")
@pytest.mark.parametrize('axis', [0, 1, None])
@pytest.mark.parametrize('keepdims', [False, True])
def test_xp_mean(axis, keepdims, xp):
    mxp, marrays, narrays = get_arrays(2, xp=xp)
    kwargs = dict(axis=axis, keepdims=keepdims)
    res = _xp_mean(marrays[0], weights=marrays[1], **kwargs)
    ref = _xp_mean(narrays[0], weights=narrays[1], nan_policy='omit', **kwargs)
    xp_assert_close(res.data, xp.asarray(ref))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@pytest.mark.parametrize('fun, kwargs',
    [(stats.moment, {'order': 2}),
     (stats.skew, {}),
     (stats.skew, {'bias': False}),
     (stats.kurtosis, {}),
     (stats.kurtosis, {'bias': False}),
     (stats.sem, {}),
     (stats.kstat, {'n': 1}),
     (stats.kstat, {'n': 2}),
     (stats.kstat, {'n': 3}),
     (stats.kstat, {'n': 4}),
     (stats.kstatvar, {'n': 1}),
     (stats.kstatvar, {'n': 2}),
     (stats.circmean, {}),
     (stats.circvar, {}),
     (stats.circstd, {}),
     (_xp_var, {}),
     (stats.tmean, {'limits': (0.1, 0.9)}),
     (stats.tvar, {'limits': (0.1, 0.9)}),
     (stats.tmin, {'lowerlimit': 0.5}),
     (stats.tmax, {'upperlimit': 0.5}),
     (stats.tstd, {'limits': (0.1, 0.9)}),
     (stats.tsem, {'limits': (0.1, 0.9)}),
     ])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_several(fun, kwargs, axis, xp):
    mxp, marrays, narrays = get_arrays(1, xp=xp)
    kwargs = dict(axis=axis) | kwargs
    res = fun(marrays[0], **kwargs)
    ref = fun(narrays[0], nan_policy='omit', **kwargs)
    xp_assert_close(res.data, xp.asarray(ref))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@pytest.mark.parametrize('axis', [0, 1])
@pytest.mark.parametrize('kwargs', [{}])
def test_describe(axis, kwargs, xp):
    mxp, marrays, narrays = get_arrays(1, xp=xp)
    kwargs = dict(axis=axis) | kwargs
    res = stats.describe(marrays[0], **kwargs)
    ref = stats.describe(narrays[0], nan_policy='omit', **kwargs)
    xp_assert_close(res.nobs.data, xp.asarray(ref.nobs))
    xp_assert_close(res.minmax[0].data, xp.asarray(ref.minmax[0].data))
    xp_assert_close(res.minmax[1].data, xp.asarray(ref.minmax[1].data))
    xp_assert_close(res.variance.data, xp.asarray(ref.variance.data))
    xp_assert_close(res.skewness.data, xp.asarray(ref.skewness.data))
    xp_assert_close(res.kurtosis.data, xp.asarray(ref.kurtosis.data))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@pytest.mark.parametrize('fun', [stats.zscore, stats.gzscore, stats.zmap])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_zscore(fun, axis, xp):
    mxp, marrays, narrays = (get_arrays(2, xp=xp) if fun == stats.zmap
                             else get_arrays(1, xp=xp))
    res = fun(*marrays, axis=axis)
    ref = xp.asarray(fun(*narrays, nan_policy='omit', axis=axis))
    xp_assert_close(res.data[~res.mask], ref[~xp.isnan(ref)])
    xp_assert_equal(res.mask, marrays[0].mask)


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@skip_backend('cupy', reason="special functions won't work")
@pytest.mark.parametrize('f_name', ['ttest_1samp', 'ttest_rel', 'ttest_ind'])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_ttest(f_name, axis, xp):
    f = getattr(stats, f_name)
    mxp, marrays, narrays = get_arrays(2, xp=xp)
    if f_name == 'ttest_1samp':
        marrays[1] = mxp.mean(marrays[1], axis=axis, keepdims=axis is not None)
        narrays[1] = np.nanmean(narrays[1], axis=axis, keepdims=axis is not None)
    res = f(*marrays, axis=axis)
    ref = f(*narrays, nan_policy='omit', axis=axis)
    xp_assert_close(res.statistic.data, xp.asarray(ref.statistic))
    xp_assert_close(res.pvalue.data, xp.asarray(ref.pvalue))
    res_ci = res.confidence_interval()
    ref_ci = ref.confidence_interval()
    xp_assert_close(res_ci.low.data, xp.asarray(ref_ci.low))
    xp_assert_close(res_ci.high.data, xp.asarray(ref_ci.high))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@skip_backend('cupy', reason="special functions won't work")
@pytest.mark.filterwarnings("ignore::scipy.stats._axis_nan_policy.SmallSampleWarning")
@pytest.mark.parametrize('f_name', ['skewtest', 'kurtosistest',
                                    'normaltest', 'jarque_bera'])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_normality_tests(f_name, axis, xp):
    f = getattr(stats, f_name)
    mxp, marrays, narrays = get_arrays(1, xp=xp, shape=(10, 11))

    res = f(*marrays, axis=axis)
    ref = f(*narrays, nan_policy='omit', axis=axis)

    xp_assert_close(res.statistic.data, xp.asarray(ref.statistic))
    xp_assert_close(res.pvalue.data, xp.asarray(ref.pvalue))


def pd_nsamples(kwargs):
    return 2 if kwargs.get('f_exp', None) is not None else 1


@_axis_nan_policy_factory(lambda *args: tuple(args), paired=True, n_samples=pd_nsamples)
def power_divergence_ref(f_obs, f_exp=None, *,  ddof, lambda_, axis=0):
    return stats.power_divergence(f_obs, f_exp, axis=axis, ddof=ddof, lambda_=lambda_)


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@skip_backend('cupy', reason="special functions won't work")
@pytest.mark.parametrize('lambda_', ['pearson', 'log-likelihood', 'freeman-tukey',
                                     'mod-log-likelihood', 'neyman', 'cressie-read',
                                     'chisquare'])
@pytest.mark.parametrize('ddof', [0, 1])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_power_divergence_chisquare(lambda_, ddof, axis, xp):
    mxp, marrays, narrays = get_arrays(2, xp=xp, shape=(5, 6))

    kwargs = dict(axis=axis, ddof=ddof)
    if lambda_ == 'chisquare':
        lambda_ = "pearson"
        def f(*args, **kwargs):
            return stats.chisquare(*args, **kwargs)
    else:
        def f(*args, **kwargs):
            return stats.power_divergence(*args, lambda_=lambda_, **kwargs)

    # test 1-arg
    res = f(marrays[0], **kwargs)
    ref = power_divergence_ref(narrays[0], nan_policy='omit', lambda_=lambda_, **kwargs)

    xp_assert_close(res.statistic.data, xp.asarray(ref[0]))
    xp_assert_close(res.pvalue.data, xp.asarray(ref[1]))

    # test 2-arg
    common_mask = np.isnan(narrays[0]) | np.isnan(narrays[1])
    normalize = (np.nansum(narrays[1] * ~common_mask, axis=axis, keepdims=True)
                 / np.nansum(narrays[0] * ~common_mask, axis=axis, keepdims=True))
    marrays[0] *= xp.asarray(normalize)
    narrays[0] *= normalize

    res = f(*marrays, **kwargs)
    ref = power_divergence_ref(*narrays, nan_policy='omit', lambda_=lambda_, **kwargs)

    xp_assert_close(res.statistic.data, xp.asarray(ref[0]))
    xp_assert_close(res.pvalue.data, xp.asarray(ref[1]))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@skip_backend('cupy', reason="special functions won't work")
@pytest.mark.parametrize('method', ['fisher', 'pearson', 'mudholkar_george',
                                    'tippett', 'stouffer'])
@pytest.mark.parametrize('axis', [0, 1, None])
def test_combine_pvalues(method, axis, xp):
    mxp, marrays, narrays = get_arrays(2, xp=xp, shape=(10, 11))

    kwargs = dict(method=method, axis=axis)
    res = stats.combine_pvalues(marrays[0], **kwargs)
    ref = stats.combine_pvalues(narrays[0], nan_policy='omit', **kwargs)

    xp_assert_close(res.statistic.data, xp.asarray(ref.statistic))
    xp_assert_close(res.pvalue.data, xp.asarray(ref.pvalue))

    if method != 'stouffer':
        return

    res = stats.combine_pvalues(marrays[0], weights=marrays[1], **kwargs)
    ref = stats.combine_pvalues(narrays[0], weights=narrays[1],
                                nan_policy='omit', **kwargs)

    xp_assert_close(res.statistic.data, xp.asarray(ref.statistic))
    xp_assert_close(res.pvalue.data, xp.asarray(ref.pvalue))


@skip_backend('dask.array', reason='Arrays need `device` attribute: dask/dask#11711')
@skip_backend('jax.numpy', reason="JAX doesn't allow item assignment.")
@skip_backend('torch', reason="array-api-compat#242")
@skip_backend('cupy', reason="special functions won't work")
def test_ttest_ind_from_stats(xp):
    shape = (10, 11)
    mxp, marrays, narrays = get_arrays(6, xp=xp, shape=shape)
    mask = np.astype(np.sum(np.stack([np.isnan(arg) for arg in narrays]), axis=0), bool)
    narrays = [arg[~mask] for arg in narrays]
    marrays[2], marrays[5] = marrays[2] * 100, marrays[5] * 100
    narrays[2], narrays[5] = narrays[2] * 100, narrays[5] * 100

    res = stats.ttest_ind_from_stats(*marrays)
    ref = stats.ttest_ind_from_stats(*narrays)

    mask = xp.asarray(mask)
    assert xp.any(mask) and xp.any(~mask)
    xp_assert_close(res.statistic.data[~mask], xp.asarray(ref.statistic))
    xp_assert_close(res.pvalue.data[~mask], xp.asarray(ref.pvalue))
    xp_assert_close(res.statistic.mask, mask)
    xp_assert_close(res.pvalue.mask, mask)
    assert res.statistic.shape == shape
    assert res.pvalue.shape == shape

def test_length_nonmasked_marray_iterable_axis_raises():
    xp = marray._get_namespace(np)

    data = [[1.0, 2.0], [3.0, 4.0]]
    mask = [[False, False], [True, False]]
    marr = xp.asarray(data, mask=mask)

    # Axis tuples are not currently supported for MArray input.
    # This test can be removed after support is added.
    with pytest.raises(NotImplementedError,
        match="`axis` must be an integer or None for use with `MArray`"):
        _length_nonmasked(marr, axis=(0, 1), xp=xp)
