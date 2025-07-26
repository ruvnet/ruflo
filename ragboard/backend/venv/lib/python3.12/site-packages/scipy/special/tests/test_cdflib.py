"""
Test cdflib functions versus mpmath, if available.

The following functions still need tests:

- ncfdtridfn
- ncfdtridfd
- ncfdtrinc
- nbdtrik
- nbdtrin
- pdtrik
- nctdtridf
- nctdtrinc

"""
import itertools

import numpy as np
from numpy.testing import assert_equal, assert_allclose
import pytest

import scipy.special as sp
from scipy.special._testutils import (
    MissingModule, check_version, FuncData)
from scipy.special._mptestutils import (
    Arg, IntArg, get_args, mpf2float, assert_mpmath_equal)

try:
    import mpmath
except ImportError:
    mpmath = MissingModule('mpmath')


class ProbArg:
    """Generate a set of probabilities on [0, 1]."""

    def __init__(self):
        # Include the endpoints for compatibility with Arg et. al.
        self.a = 0
        self.b = 1

    def values(self, n):
        """Return an array containing approximately n numbers."""
        m = max(1, n//3)
        v1 = np.logspace(-30, np.log10(0.3), m)
        v2 = np.linspace(0.3, 0.7, m + 1, endpoint=False)[1:]
        v3 = 1 - np.logspace(np.log10(0.3), -15, m)
        v = np.r_[v1, v2, v3]
        return np.unique(v)


class EndpointFilter:
    def __init__(self, a, b, rtol, atol):
        self.a = a
        self.b = b
        self.rtol = rtol
        self.atol = atol

    def __call__(self, x):
        mask1 = np.abs(x - self.a) < self.rtol*np.abs(self.a) + self.atol
        mask2 = np.abs(x - self.b) < self.rtol*np.abs(self.b) + self.atol
        return np.where(mask1 | mask2, False, True)


class _CDFData:
    def __init__(self, spfunc, mpfunc, index, argspec, spfunc_first=True,
                 dps=20, n=5000, rtol=None, atol=None,
                 endpt_rtol=None, endpt_atol=None):
        self.spfunc = spfunc
        self.mpfunc = mpfunc
        self.index = index
        self.argspec = argspec
        self.spfunc_first = spfunc_first
        self.dps = dps
        self.n = n
        self.rtol = rtol
        self.atol = atol

        if not isinstance(argspec, list):
            self.endpt_rtol = None
            self.endpt_atol = None
        elif endpt_rtol is not None or endpt_atol is not None:
            if isinstance(endpt_rtol, list):
                self.endpt_rtol = endpt_rtol
            else:
                self.endpt_rtol = [endpt_rtol]*len(self.argspec)
            if isinstance(endpt_atol, list):
                self.endpt_atol = endpt_atol
            else:
                self.endpt_atol = [endpt_atol]*len(self.argspec)
        else:
            self.endpt_rtol = None
            self.endpt_atol = None

    def idmap(self, *args):
        if self.spfunc_first:
            res = self.spfunc(*args)
            if np.isnan(res):
                return np.nan
            args = list(args)
            args[self.index] = res
            with mpmath.workdps(self.dps):
                res = self.mpfunc(*tuple(args))
                # Imaginary parts are spurious
                res = mpf2float(res.real)
        else:
            with mpmath.workdps(self.dps):
                res = self.mpfunc(*args)
                res = mpf2float(res.real)
            args = list(args)
            args[self.index] = res
            res = self.spfunc(*tuple(args))
        return res

    def get_param_filter(self):
        if self.endpt_rtol is None and self.endpt_atol is None:
            return None

        filters = []
        for rtol, atol, spec in zip(self.endpt_rtol, self.endpt_atol, self.argspec):
            if rtol is None and atol is None:
                filters.append(None)
                continue
            elif rtol is None:
                rtol = 0.0
            elif atol is None:
                atol = 0.0

            filters.append(EndpointFilter(spec.a, spec.b, rtol, atol))
        return filters

    def check(self):
        # Generate values for the arguments
        args = get_args(self.argspec, self.n)
        param_filter = self.get_param_filter()
        param_columns = tuple(range(args.shape[1]))
        result_columns = args.shape[1]
        args = np.hstack((args, args[:, self.index].reshape(args.shape[0], 1)))
        FuncData(self.idmap, args,
                 param_columns=param_columns, result_columns=result_columns,
                 rtol=self.rtol, atol=self.atol, vectorized=False,
                 param_filter=param_filter).check()


def _assert_inverts(*a, **kw):
    d = _CDFData(*a, **kw)
    d.check()


def _binomial_cdf(k, n, p):
    k, n, p = mpmath.mpf(k), mpmath.mpf(n), mpmath.mpf(p)
    if k <= 0:
        return mpmath.mpf(0)
    elif k >= n:
        return mpmath.mpf(1)

    onemp = mpmath.fsub(1, p, exact=True)
    return mpmath.betainc(n - k, k + 1, x2=onemp, regularized=True)


def _f_cdf(dfn, dfd, x):
    if x < 0:
        return mpmath.mpf(0)
    dfn, dfd, x = mpmath.mpf(dfn), mpmath.mpf(dfd), mpmath.mpf(x)
    ub = dfn*x/(dfn*x + dfd)
    res = mpmath.betainc(dfn/2, dfd/2, x2=ub, regularized=True)
    return res


def _student_t_cdf(df, t, dps=None):
    if dps is None:
        dps = mpmath.mp.dps
    with mpmath.workdps(dps):
        df, t = mpmath.mpf(df), mpmath.mpf(t)
        fac = mpmath.hyp2f1(0.5, 0.5*(df + 1), 1.5, -t**2/df)
        fac *= t*mpmath.gamma(0.5*(df + 1))
        fac /= mpmath.sqrt(mpmath.pi*df)*mpmath.gamma(0.5*df)
        return 0.5 + fac


def _noncentral_chi_pdf(t, df, nc):
    res = mpmath.besseli(df/2 - 1, mpmath.sqrt(nc*t))
    res *= mpmath.exp(-(t + nc)/2)*(t/nc)**(df/4 - 1/2)/2
    return res


def _noncentral_chi_cdf(x, df, nc, dps=None):
    if dps is None:
        dps = mpmath.mp.dps
    x, df, nc = mpmath.mpf(x), mpmath.mpf(df), mpmath.mpf(nc)
    with mpmath.workdps(dps):
        res = mpmath.quad(lambda t: _noncentral_chi_pdf(t, df, nc), [0, x])
        return res


def _tukey_lmbda_quantile(p, lmbda):
    # For lmbda != 0
    return (p**lmbda - (1 - p)**lmbda)/lmbda


@pytest.mark.slow
@check_version(mpmath, '0.19')
class TestCDFlib:

    @pytest.mark.xfail(run=False)
    def test_bdtrik(self):
        _assert_inverts(
            sp.bdtrik,
            _binomial_cdf,
            0, [ProbArg(), IntArg(1, 1000), ProbArg()],
            rtol=1e-4)

    def test_bdtrin(self):
        _assert_inverts(
            sp.bdtrin,
            _binomial_cdf,
            1, [IntArg(1, 1000), ProbArg(), ProbArg()],
            rtol=1e-4, endpt_atol=[None, None, 1e-6])

    def test_btdtria(self):
        _assert_inverts(
            sp.btdtria,
            lambda a, b, x: mpmath.betainc(a, b, x2=x, regularized=True),
            0, [ProbArg(), Arg(0, 1e2, inclusive_a=False),
                Arg(0, 1, inclusive_a=False, inclusive_b=False)],
            rtol=1e-6)

    def test_btdtrib(self):
        # Use small values of a or mpmath doesn't converge
        _assert_inverts(
            sp.btdtrib,
            lambda a, b, x: mpmath.betainc(a, b, x2=x, regularized=True),
            1,
            [Arg(0, 1e2, inclusive_a=False), ProbArg(),
             Arg(0, 1, inclusive_a=False, inclusive_b=False)],
            rtol=1e-7,
            endpt_atol=[None, 1e-18, 1e-15])

    @pytest.mark.xfail(run=False)
    def test_fdtridfd(self):
        _assert_inverts(
            sp.fdtridfd,
            _f_cdf,
            1,
            [IntArg(1, 100), ProbArg(), Arg(0, 100, inclusive_a=False)],
            rtol=1e-7)

    def test_gdtria(self):
        _assert_inverts(
            sp.gdtria,
            lambda a, b, x: mpmath.gammainc(b, b=a*x, regularized=True),
            0,
            [ProbArg(), Arg(0, 1e3, inclusive_a=False),
             Arg(0, 1e4, inclusive_a=False)],
            rtol=1e-7,
            endpt_atol=[None, 1e-7, 1e-10])

    def test_gdtrib(self):
        # Use small values of a and x or mpmath doesn't converge
        _assert_inverts(
            sp.gdtrib,
            lambda a, b, x: mpmath.gammainc(b, b=a*x, regularized=True),
            1,
            [Arg(0, 1e2, inclusive_a=False), ProbArg(),
             Arg(0, 1e3, inclusive_a=False)],
            rtol=1e-5)

    def test_gdtrix(self):
        _assert_inverts(
            sp.gdtrix,
            lambda a, b, x: mpmath.gammainc(b, b=a*x, regularized=True),
            2,
            [Arg(0, 1e3, inclusive_a=False), Arg(0, 1e3, inclusive_a=False),
             ProbArg()],
            rtol=1e-7,
            endpt_atol=[None, 1e-7, 1e-10])

    # Overall nrdtrimn and nrdtrisd are not performing well with infeasible/edge
    # combinations of sigma and x, hence restricted the domains to still use the
    # testing machinery, also see gh-20069

    # nrdtrimn signature: p, sd, x
    # nrdtrisd signature: mn, p, x
    def test_nrdtrimn(self):
        _assert_inverts(
            sp.nrdtrimn,
            lambda x, y, z: mpmath.ncdf(z, x, y),
            0,
            [ProbArg(),  # CDF value p
             Arg(0.1, np.inf, inclusive_a=False, inclusive_b=False),  # sigma
             Arg(-1e10, 1e10)],  # x
            rtol=1e-5)

    def test_nrdtrisd(self):
        _assert_inverts(
            sp.nrdtrisd,
            lambda x, y, z: mpmath.ncdf(z, x, y),
            1,
            [Arg(-np.inf, 10, inclusive_a=False, inclusive_b=False),  # mn
             ProbArg(),  # CDF value p
             Arg(10, 1e100)],  # x
            rtol=1e-5)

    def test_stdtr(self):
        # Ideally the left endpoint for Arg() should be 0.
        assert_mpmath_equal(
            sp.stdtr,
            _student_t_cdf,
            [IntArg(1, 100), Arg(1e-10, np.inf)], rtol=1e-7)

    @pytest.mark.xfail(run=False)
    def test_stdtridf(self):
        _assert_inverts(
            sp.stdtridf,
            _student_t_cdf,
            0, [ProbArg(), Arg()], rtol=1e-7)

    def test_stdtrit(self):
        _assert_inverts(
            sp.stdtrit,
            _student_t_cdf,
            1, [IntArg(1, 100), ProbArg()], rtol=1e-7,
            endpt_atol=[None, 1e-10])

    def test_chdtriv(self):
        _assert_inverts(
            sp.chdtriv,
            lambda v, x: mpmath.gammainc(v/2, b=x/2, regularized=True),
            0, [ProbArg(), IntArg(1, 100)], rtol=1e-4)

    @pytest.mark.xfail(run=False)
    def test_chndtridf(self):
        # Use a larger atol since mpmath is doing numerical integration
        _assert_inverts(
            sp.chndtridf,
            _noncentral_chi_cdf,
            1, [Arg(0, 100, inclusive_a=False), ProbArg(),
                Arg(0, 100, inclusive_a=False)],
            n=1000, rtol=1e-4, atol=1e-15)

    @pytest.mark.xfail(run=False)
    def test_chndtrinc(self):
        # Use a larger atol since mpmath is doing numerical integration
        _assert_inverts(
            sp.chndtrinc,
            _noncentral_chi_cdf,
            2, [Arg(0, 100, inclusive_a=False), IntArg(1, 100), ProbArg()],
            n=1000, rtol=1e-4, atol=1e-15)

    def test_chndtrix(self):
        # Use a larger atol since mpmath is doing numerical integration
        _assert_inverts(
            sp.chndtrix,
            _noncentral_chi_cdf,
            0, [ProbArg(), IntArg(1, 100), Arg(0, 100, inclusive_a=False)],
            n=1000, rtol=1e-4, atol=1e-15,
            endpt_atol=[1e-6, None, None])

    def test_tklmbda_zero_shape(self):
        # When lmbda = 0 the CDF has a simple closed form
        one = mpmath.mpf(1)
        assert_mpmath_equal(
            lambda x: sp.tklmbda(x, 0),
            lambda x: one/(mpmath.exp(-x) + one),
            [Arg()], rtol=1e-7)

    def test_tklmbda_neg_shape(self):
        _assert_inverts(
            sp.tklmbda,
            _tukey_lmbda_quantile,
            0, [ProbArg(), Arg(-25, 0, inclusive_b=False)],
            spfunc_first=False, rtol=1e-5,
            endpt_atol=[1e-9, 1e-5])

    @pytest.mark.xfail(run=False)
    def test_tklmbda_pos_shape(self):
        _assert_inverts(
            sp.tklmbda,
            _tukey_lmbda_quantile,
            0, [ProbArg(), Arg(0, 100, inclusive_a=False)],
            spfunc_first=False, rtol=1e-5)

    # The values of lmdba are chosen so that 1/lmbda is exact.
    @pytest.mark.parametrize('lmbda', [0.5, 1.0, 8.0])
    def test_tklmbda_lmbda1(self, lmbda):
        bound = 1/lmbda
        assert_equal(sp.tklmbda([-bound, bound], lmbda), [0.0, 1.0])


funcs = [
    ("btdtria", 3),
    ("btdtrib", 3),
    ("bdtrik", 3),
    ("bdtrin", 3),
    ("chdtriv", 2),
    ("chndtr", 3),
    ("chndtrix", 3),
    ("chndtridf", 3),
    ("chndtrinc", 3),
    ("fdtridfd", 3),
    ("ncfdtr", 4),
    ("ncfdtri", 4),
    ("ncfdtridfn", 4),
    ("ncfdtridfd", 4),
    ("ncfdtrinc", 4),
    ("gdtrix", 3),
    ("gdtrib", 3),
    ("gdtria", 3),
    ("nbdtrik", 3),
    ("nbdtrin", 3),
    ("nrdtrimn", 3),
    ("nrdtrisd", 3),
    ("pdtrik", 2),
    ("stdtr", 2),
    ("stdtrit", 2),
    ("stdtridf", 2),
    ("nctdtr", 3),
    ("nctdtrit", 3),
    ("nctdtridf", 3),
    ("nctdtrinc", 3),
    ("tklmbda", 2),
]


@pytest.mark.parametrize('func,numargs', funcs, ids=[x[0] for x in funcs])
def test_nonfinite(func, numargs):

    rng = np.random.default_rng(1701299355559735)
    func = getattr(sp, func)
    args_choices = [(float(x), np.nan, np.inf, -np.inf) for x in rng.random(numargs)]

    for args in itertools.product(*args_choices):
        res = func(*args)

        if any(np.isnan(x) for x in args):
            # Nan inputs should result to nan output
            assert_equal(res, np.nan)
        else:
            # All other inputs should return something (but not
            # raise exceptions or cause hangs)
            pass


def test_chndtrix_gh2158():
    # test that gh-2158 is resolved; previously this blew up
    res = sp.chndtrix(0.999999, 2, np.arange(20.)+1e-6)

    # Generated in R
    # options(digits=16)
    # ncp <- seq(0, 19) + 1e-6
    # print(qchisq(0.999999, df = 2, ncp = ncp))
    res_exp = [27.63103493142305, 35.25728589950540, 39.97396073236288,
               43.88033702110538, 47.35206403482798, 50.54112500166103,
               53.52720257322766, 56.35830042867810, 59.06600769498512,
               61.67243118946381, 64.19376191277179, 66.64228141346548,
               69.02756927200180, 71.35726934749408, 73.63759723904816,
               75.87368842650227, 78.06984431185720, 80.22971052389806,
               82.35640899964173, 84.45263768373256]
    assert_allclose(res, res_exp)


def test_nctdtrinc_gh19896():
    # test that gh-19896 is resolved.
    # Compared to SciPy 1.11 results from Fortran code.
    dfarr = [0.001, 0.98, 9.8, 98, 980, 10000, 98, 9.8, 0.98, 0.001]
    parr = [0.001, 0.1, 0.3, 0.8, 0.999, 0.001, 0.1, 0.3, 0.8, 0.999]
    tarr = [0.0015, 0.15, 1.5, 15, 300, 0.0015, 0.15, 1.5, 15, 300]
    desired = [3.090232306168629, 1.406141304556198, 2.014225177124157,
               13.727067118283456, 278.9765683871208, 3.090232306168629,
               1.4312427877936222, 2.014225177124157, 3.712743137978295,
               -3.086951096691082]
    actual = sp.nctdtrinc(dfarr, parr, tarr)
    assert_allclose(actual, desired, rtol=5e-12, atol=0.0)


def test_stdtr_stdtrit_neg_inf():
    # -inf was treated as +inf and values from the normal were returned
    assert np.all(np.isnan(sp.stdtr(-np.inf, [-np.inf, -1.0, 0.0, 1.0, np.inf])))
    assert np.all(np.isnan(sp.stdtrit(-np.inf, [0.0, 0.25, 0.5, 0.75, 1.0])))


def test_bdtrik_nbdtrik_inf():
    y = np.array(
        [np.nan,-np.inf,-10.0, -1.0, 0.0, .00001, .5, 0.9999, 1.0, 10.0, np.inf])
    y = y[:,None]
    p = np.atleast_2d(
        [np.nan, -np.inf, -10.0, -1.0, 0.0, .00001, .5, 1.0, np.inf])
    assert np.all(np.isnan(sp.bdtrik(y, np.inf, p)))
    assert np.all(np.isnan(sp.nbdtrik(y, np.inf, p)))


@pytest.mark.parametrize(
    "dfn,dfd,nc,f,expected_cdf",
    [[100.0, 0.1, 0.1, 100.0, 0.29787396410092676],
     [100.0, 100.0, 0.01, 0.1, 4.4344737598690424e-26],
     [100.0, 0.01, 0.1, 0.01, 0.002848616633080384],
     [10.0, 0.01, 1.0, 0.1, 0.012339557729057956],
     [100.0, 100.0, 0.01, 0.01, 1.8926477420964936e-72],
     [1.0, 100.0, 100.0, 0.1, 1.7925940526821304e-22],
     [1.0, 0.01, 100.0, 10.0, 0.012334711965024968],
     [1.0, 0.01, 10.0, 0.01, 0.00021944525290299],
     [10.0, 1.0, 0.1, 100.0, 0.9219345555070705],
     [0.1, 0.1, 1.0, 1.0, 0.3136335813423239],
     [100.0, 100.0, 0.1, 10.0, 1.0],
     [1.0, 0.1, 100.0, 10.0, 0.02926064279680897]]
)
def test_ncfdtr_ncfdtri(dfn, dfd, nc, f, expected_cdf):
    # Reference values computed with mpmath with the following script
    #
    # import numpy as np
    #
    # from mpmath import mp
    # from scipy.special import ncfdtr
    #
    # mp.dps = 100
    #
    # def mp_ncfdtr(dfn, dfd, nc, f):
    #     # Uses formula 26.2.20 from Abramowitz and Stegun.
    #     dfn, dfd, nc, f = map(mp.mpf, (dfn, dfd, nc, f))
    #     def term(j):
    #         result = mp.exp(-nc/2)*(nc/2)**j / mp.factorial(j)
    #         result *= mp.betainc(
    #             dfn/2 + j, dfd/2, 0, f*dfn/(f*dfn + dfd), regularized=True
    #         )
    #         return result
    #     result = mp.nsum(term, [0, mp.inf])
    #     return float(result)
    #
    # dfn = np.logspace(-2, 2, 5)
    # dfd = np.logspace(-2, 2, 5)
    # nc = np.logspace(-2, 2, 5)
    # f = np.logspace(-2, 2, 5)
    #
    # dfn, dfd, nc, f = np.meshgrid(dfn, dfd, nc, f)
    # dfn, dfd, nc, f = map(np.ravel, (dfn, dfd, nc, f))
    #
    # cases = []
    # re = []
    # for x0, x1, x2, x3 in zip(*(dfn, dfd, nc, f)):
    #     observed = ncfdtr(x0, x1, x2, x3)
    #     expected = mp_ncfdtr(x0, x1, x2, x3)
    #     cases.append((x0, x1, x2, x3, expected))
    #     re.append((abs(expected - observed)/abs(expected)))
    #
    # assert np.max(re) < 1e-13
    #
    # rng = np.random.default_rng(1234)
    # sample_idx = rng.choice(len(re), replace=False, size=12)
    # cases = np.array(cases)[sample_idx].tolist()
    assert_allclose(sp.ncfdtr(dfn, dfd, nc, f), expected_cdf, rtol=1e-13, atol=0)
    # testing tails where the CDF reaches 0 or 1 does not make sense for inverses
    # of a CDF as they are not bijective in these regions
    if 0 < expected_cdf < 1:
        assert_allclose(sp.ncfdtri(dfn, dfd, nc, expected_cdf), f, rtol=5e-11)

@pytest.mark.parametrize(
    "args",
    [(-1.0, 0.1, 0.1, 0.5),
     (1, -1.0, 0.1, 0.5),
     (1, 1, -1.0, 0.5),
     (1, 1, 1, 100),
     (1, 1, 1, -1)]
)
def test_ncfdtri_domain_error(args):
    with sp.errstate(domain="raise"):
        with pytest.raises(sp.SpecialFunctionError, match="domain"):
            sp.ncfdtri(*args)

class TestNoncentralTFunctions:

    # Reference values computed with mpmath with the following script
    # Formula from:
    # Lenth, Russell V (1989). "Algorithm AS 243: Cumulative Distribution Function
    # of the Non-central t Distribution". Journal of the Royal Statistical Society,
    # Series C. 38 (1): 185-189
    #
    # Warning: may take a long time to run
    #
    # from mpmath import mp
    # mp.dps = 400

    # def nct_cdf(df, nc, x):
    #     df, nc, x = map(mp.mpf, (df, nc, x))
        
    #     def f(df, nc, x):
    #         phi = mp.ncdf(-nc)
    #         y = x * x / (x * x + df)
    #         constant = mp.exp(-nc * nc / 2.)
    #         def term(j):
    #             intermediate = constant * (nc *nc / 2.)**j
    #             p = intermediate/mp.factorial(j)
    #             q = nc / (mp.sqrt(2.) * mp.gamma(j + 1.5)) * intermediate
    #             first_beta_term = mp.betainc(j + 0.5, df/2., x2=y,
    #                                          regularized=True)
    #             second_beta_term = mp.betainc(j + mp.one, df/2., x2=y,
    #                                           regularized=True)
    #             return p * first_beta_term + q * second_beta_term

    #         sum_term = mp.nsum(term, [0, mp.inf])
    #         f = phi + 0.5 * sum_term
    #         return f

    #     if x >= 0:
    #         result = f(df, nc, x)
    #     else:
    #         result = mp.one - f(df, -nc, x)
    #     return float(result)

    @pytest.mark.parametrize("df, nc, x, expected_cdf", [
        (0.98, -3.8, 0.0015, 0.9999279987514815),
        (0.98, -3.8, 0.15, 0.9999528361700505),
        (0.98, -3.8, 1.5, 0.9999908823016942),
        (0.98, -3.8, 15, 0.9999990264591945),
        (0.98, 0.38, 0.0015, 0.35241533122693),
        (0.98, 0.38, 0.15, 0.39749697267146983),
        (0.98, 0.38, 1.5, 0.716862963488558),
        (0.98, 0.38, 15, 0.9656246449257494),
        (0.98, 3.8, 0.0015, 7.26973354942293e-05),
        (0.98, 3.8, 0.15, 0.00012416481147589105),
        (0.98, 3.8, 1.5, 0.035388035775454095),
        (0.98, 3.8, 15, 0.7954826975430583),
        (0.98, 38, 0.0015, 3.02106943e-316),
        (0.98, 38, 0.15, 6.069970616996603e-309),
        (0.98, 38, 1.5, 2.591995360483094e-97),
        (0.98, 38, 15, 0.011927265886910935),
        (9.8, -3.8, 0.0015, 0.9999280776192786),
        (9.8, -3.8, 0.15, 0.9999599410685442),
        (9.8, -3.8, 1.5, 0.9999997432394788),
        (9.8, -3.8, 15, 0.9999999999999984),
        (9.8, 0.38, 0.0015, 0.3525155979107491),
        (9.8, 0.38, 0.15, 0.40763120140379194),
        (9.8, 0.38, 1.5, 0.8476794017024651),
        (9.8, 0.38, 15, 0.9999999297116268),
        (9.8, 3.8, 0.0015, 7.277620328149153e-05),
        (9.8, 3.8, 0.15, 0.00013024802220900652),
        (9.8, 3.8, 1.5, 0.013477432800072933),
        (9.8, 3.8, 15, 0.999850151230648),
        (9.8, 38, 0.0015, 3.05066095e-316),
        (9.8, 38, 0.15, 1.79065514676e-313),
        (9.8, 38, 1.5, 2.0935940165900746e-249),
        (9.8, 38, 15, 2.252076291604796e-09),
        (98, -3.8, 0.0015, 0.9999280875149109),
        (98, -3.8, 0.15, 0.9999608250170452),
        (98, -3.8, 1.5, 0.9999999304757682),
        (98, -3.8, 15, 1.0),
        (98, 0.38, 0.0015, 0.35252817848596313),
        (98, 0.38, 0.15, 0.40890253001794846),
        (98, 0.38, 1.5, 0.8664672830006552),
        (98, 0.38, 15, 1.0),
        (98, 3.8, 0.0015, 7.278609891281275e-05),
        (98, 3.8, 0.15, 0.0001310318674827004),
        (98, 3.8, 1.5, 0.010990879189991727),
        (98, 3.8, 15, 0.9999999999999989),
        (98, 38, 0.0015, 3.05437385e-316),
        (98, 38, 0.15, 9.1668336166e-314),
        (98, 38, 1.5, 1.8085884236563926e-288),
        (98, 38, 15, 2.7740532792035907e-50),
        (980, -3.8, 0.0015, 0.9999280885188965),
        (980, -3.8, 0.15, 0.9999609144559273),
        (980, -3.8, 1.5, 0.9999999410050979),
        (980, -3.8, 15, 1.0),
        (980, 0.38, 0.0015, 0.3525294548792812),
        (980, 0.38, 0.15, 0.4090315324657382),
        (980, 0.38, 1.5, 0.8684247068517293),
        (980, 0.38, 15, 1.0),
        (980, 3.8, 0.0015, 7.278710289828983e-05),
        (980, 3.8, 0.15, 0.00013111131667906573),
        (980, 3.8, 1.5, 0.010750678886113882),
        (980, 3.8, 15, 1.0),
        (980, 38, 0.0015, 3.0547506e-316),
        (980, 38, 0.15, 8.6191646313e-314),
        pytest.param(980, 38, 1.5, 1.1824454111413493e-291,
                     marks=pytest.mark.xfail(
                        reason="Bug in underlying Boost math implementation")),
        (980, 38, 15, 5.407535300713606e-105)
    ])
    def test_gh19896(self, df, nc, x, expected_cdf):
        # test that gh-19896 is resolved.
        # Originally this was a regression test that used the old Fortran results
        # as a reference. The Fortran results were not accurate, so the reference
        # values were recomputed with mpmath.
        nctdtr_result = sp.nctdtr(df, nc, x)
        assert_allclose(nctdtr_result, expected_cdf, rtol=1e-13, atol=1e-303)

    def test_nctdtr_gh8344(self):
        # test that gh-8344 is resolved.
        df, nc, x = 3000, 3, 0.1
        expected = 0.0018657780826323328
        assert_allclose(sp.nctdtr(df, nc, x), expected, rtol=1e-14)

    @pytest.mark.parametrize(
        "df, nc, x, expected, rtol",
        [[3., 5., -2., 1.5645373999149622e-09, 5e-9],
         [1000., 10., 1., 1.1493552133826623e-19, 1e-13],
         [1e-5, -6., 2., 0.9999999990135003, 1e-13],
         [10., 20., 0.15, 6.426530505957303e-88, 1e-13],
         [1., 1., np.inf, 1.0, 0.0],
         [1., 1., -np.inf, 0.0, 0.0]
        ]
    )
    def test_nctdtr_accuracy(self, df, nc, x, expected, rtol):
        assert_allclose(sp.nctdtr(df, nc, x), expected, rtol=rtol)

    @pytest.mark.parametrize("df, nc, x, expected_cdf", [
        (0.98, 38, 1.5, 2.591995360483094e-97),
        (3000, 3, 0.1, 0.0018657780826323328),
        (0.98, -3.8, 15, 0.9999990264591945),
        (9.8, 38, 15, 2.252076291604796e-09),

    ])
    def test_nctdtrit(self, df, nc, x, expected_cdf):
        assert_allclose(sp.nctdtrit(df, nc, expected_cdf), x, rtol=1e-10)
