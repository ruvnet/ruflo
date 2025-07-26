import scipy
import scipy.special as sc
import sys
import numpy as np
import pytest

from numpy.testing import assert_equal, assert_allclose


def test_zeta():
    assert_allclose(sc.zeta(2,2), np.pi**2/6 - 1, rtol=1e-12)


def test_zetac():
    # Expected values in the following were computed using Wolfram
    # Alpha's `Zeta[x] - 1`
    x = [-2.1, 0.8, 0.9999, 9, 50, 75]
    desired = [
        -0.9972705002153750,
        -5.437538415895550,
        -10000.42279161673,
        0.002008392826082214,
        8.881784210930816e-16,
        2.646977960169853e-23,
    ]
    assert_allclose(sc.zetac(x), desired, rtol=1e-12)


def test_zetac_special_cases():
    assert sc.zetac(np.inf) == 0
    assert np.isnan(sc.zetac(-np.inf))
    assert sc.zetac(0) == -1.5
    assert sc.zetac(1.0) == np.inf

    assert_equal(sc.zetac([-2, -50, -100]), -1)


def test_riemann_zeta_special_cases():
    assert np.isnan(sc.zeta(np.nan))
    assert sc.zeta(np.inf) == 1
    assert sc.zeta(0) == -0.5

    # Riemann zeta is zero add negative even integers.
    assert_equal(sc.zeta([-2, -4, -6, -8, -10]), 0)

    assert_allclose(sc.zeta(2), np.pi**2/6, rtol=1e-12)
    assert_allclose(sc.zeta(4), np.pi**4/90, rtol=1e-12)


def test_riemann_zeta_avoid_overflow():
    s = -260.00000000001
    desired = -5.6966307844402683127e+297  # Computed with Mpmath
    assert_allclose(sc.zeta(s), desired, atol=0, rtol=5e-14)


@pytest.mark.parametrize(
    "z, desired, rtol",
    [
        ## Test cases taken from mpmath with the script:

        # import numpy as np
        # import scipy.stats as stats

        # from mpmath import mp

        # # seed = np.random.SeedSequence().entropy
        # seed = 154689806791763421822480125722191067828
        # rng = np.random.default_rng(seed)
        # default_rtol = 1e-13

        # # A small point in each quadrant outside of the critical strip
        # cases = []
        # for x_sign, y_sign in [1, 1], [1, -1], [-1, 1], [-1, -1]:
        #     x = x_sign * rng.uniform(2, 8)
        #     y = y_sign * rng.uniform(2, 8)
        #     z = x + y*1j
        #     reference = complex(mp.zeta(z))
        #     cases.append((z, reference, default_rtol))

        # # Moderately large imaginary part in each quadrant outside of critical strip
        # for x_sign, y_sign in [1, 1], [1, -1], [-1, 1], [-1, -1]:
        #     x = x_sign * rng.uniform(2, 8)
        #     y = y_sign * rng.uniform(50, 80)
        #     z = x + y*1j
        #     reference = complex(mp.zeta(z))
        #     cases.append((z, reference, default_rtol))

        # # points in critical strip
        # x = rng.uniform(0.0, 1.0, size=5)
        # y = np.exp(rng.uniform(0, 5, size=5))
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, default_rtol))
        # z = x - y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, default_rtol))

        # # Near small trivial zeros
        # x = np.array([-2, -4, -6, -8])
        # y = np.array([1e-15, -1e-15])
        # x, y = np.meshgrid(x, y)
        # x, y = x.ravel(), y.ravel()
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, 1e-7))

        # # Some other points near real axis
        # x = np.array([-0.5, 0, 0.2, 0.75])
        # y = np.array([1e-15, -1e-15])
        # x, y = np.meshgrid(x, y)
        # x, y = x.ravel(), y.ravel()
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, 1e-7))

        # # Moderately large real part
        # x = np.array([49.33915930750887, 50.55805244181687])
        # y = rng.uniform(20, 100, size=3)
        # x, y = np.meshgrid(x, y)
        # x, y = x.ravel(), y.ravel()
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, default_rtol))

        # # Very large imaginary part
        # x = np.array([0.5, 34.812847097948854, 50.55805244181687])
        # y = np.array([1e6, -1e6])
        # x, y = np.meshgrid(x, y)
        # x, y = x.ravel(), y.ravel()
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     rtol = 1e-7 if t.real == 0.5 else default_rtol
        #     cases.append((complex(t), reference, rtol))
        #
        # # Naive implementation of reflection formula suffers internal overflow
        # x = -rng.uniform(200, 300, 3)
        # y = np.array([rng.uniform(10, 30), -rng.uniform(10, 30)])
        # x, y = np.meshgrid(x, y)
        # x, y = x.ravel(), y.ravel()
        # z = x + y*1j
        # for t in z:
        #     reference = complex(mp.zeta(t))
        #     cases.append((complex(t), reference, default_rtol))
        #
        # A small point in each quadrant outside of the critical strip
        ((3.12838509346655+7.111085974836645j),
         (1.0192654793474945+0.08795174413289127j),
         1e-13),
        ((7.06791362314716-7.219497492626728j),
         (1.0020740683598117-0.006752725913243711j),
         1e-13),
        ((-6.806227077655519+2.724411451005281j),
         (0.06312488213559667-0.061641496333765956j),
         1e-13),
        ((-3.0170751511621026-6.3686522550665945j),
         (-0.10330747857150148-1.214541994832571j),
         1e-13),
        # Moderately large imaginary part in each quadrant outside of critical strip
        ((6.133994402212294+60.03091448000761j),
         (0.9885701843417336+0.009636925981078128j),
         1e-13),
        ((6.17268142822657-64.74883149743795j),
         (1.0080474225840865+0.012032804974965354j),
         1e-13),
        ((-3.462191939791879+76.16258975567534j),
         (18672.072070850158+2908.5104826247184j),
         1e-13),
        ((-6.955735216531752-74.75791554155748j),
         (-77672258.72276545+71625206.0401107j),
         1e-13),
        # Points in critical strip
        ((0.4088038289823922+1.4596830498094384j),
         (0.3032837969400845-0.47272237994110344j),
         1e-13),
        ((0.9673493951209633+4.918968547259143j),
         (0.7488756907431944+0.17281553371482428j),
         1e-13),
        ((0.8692482679977754+66.6142398421354j),
         (0.5831942469552066-0.26848904799062334j),
         1e-13),
        ((0.42771847720003764+21.783747851715468j),
         (0.4767032638444329+0.6898148744603123j),
         1e-13),
        ((0.20479494678428956+33.17656449538932j),
         (-0.6983038977487848+0.18060923618150224j),
         1e-13),
        ((0.4088038289823922-1.4596830498094384j),
         (0.3032837969400845+0.47272237994110344j),
         1e-13),
        ((0.9673493951209633-4.918968547259143j),
         (0.7488756907431944-0.17281553371482428j),
         1e-13),
        ((0.8692482679977754-66.6142398421354j),
         (0.5831942469552066+0.26848904799062334j),
         1e-13),
        ((0.42771847720003764-21.783747851715468j),
         (0.4767032638444329-0.6898148744603123j),
         1e-13),
        ((0.20479494678428956-33.17656449538932j),
         (-0.6983038977487848-0.18060923618150224j),
         1e-13),
        # Near small trivial zeros
        ((-2+1e-15j), (3.288175809370978e-32-3.0448457058393275e-17j), 1e-07),
        ((-4+1e-15j), (-2.868707923051182e-33+7.983811450268625e-18j), 1e-07),
        ((-6+1e-15j), (-1.7064292323640116e-34-5.8997591435159376e-18j), 1e-07),
        ((-8+1e-15j), (2.5060859548261706e-33+8.316161985602247e-18j), 1e-07),
        ((-2-1e-15j), (3.288175809371319e-32+3.0448457058393275e-17j), 1e-07),
        ((-4-1e-15j), (-2.8687079230520114e-33-7.983811450268625e-18j), 1e-07),
        ((-6-1e-15j), (-1.70642923235801e-34+5.8997591435159376e-18j), 1e-07),
        ((-8-1e-15j), (2.5060859548253293e-33-8.316161985602247e-18j), 1e-07),
        # Some other points near real axis
        ((-0.5+1e-15j), (-0.20788622497735457-3.608543395999408e-16j), 1e-07),
        (1e-15j, (-0.5-9.189384239689193e-16j), 1e-07),
        ((0.2+1e-15j), (-0.7339209248963406-1.4828001150329085e-15j), 1e-07),
        ((0.75+1e-15j), (-3.4412853869452227-1.5924832114302393e-14j), 1e-13),
        ((-0.5-1e-15j), (-0.20788622497735457+3.608543395999408e-16j), 1e-07),
        (-1e-15j, (-0.5+9.189387416062746e-16j), 1e-07),
        ((0.2-1e-15j), (-0.7339209248963406+1.4828004007675122e-15j), 1e-07),
        ((0.75-1e-15j), (-3.4412853869452227+1.5924831974403957e-14j), 1e-13),
        # Moderately large real part
        ((49.33915930750887+53.213478698903955j),
         (1.0000000000000009+1.0212452494616078e-15j),
         1e-13),
        ((50.55805244181687+53.213478698903955j),
         (1.0000000000000004+4.387394180390787e-16j),
         1e-13),
        ((49.33915930750887+40.6366015728302j),
         (0.9999999999999986-1.502268709924849e-16j),
         1e-13),
        ((50.55805244181687+40.6366015728302j),
         (0.9999999999999994-6.453929613571651e-17j),
         1e-13),
        ((49.33915930750887+85.83555435273925j),
         (0.9999999999999987-2.7014400611995846e-16j),
         1e-13),
        ((50.55805244181687+85.83555435273925j),
         (0.9999999999999994-1.160571605555322e-16j),
         1e-13),
        # Very large imaginary part
        ((0.5+1e6j), (0.0760890697382271+2.805102101019299j), 1e-07),
        ((34.812847097948854+1e6j),
         (1.0000000000102545+3.150848654056419e-11j),
         1e-13),
        ((50.55805244181687+1e6j),
         (1.0000000000000002+5.736517078070873e-16j),
         1e-13),
        ((0.5-1e6j), (0.0760890697382271-2.805102101019299j), 1e-07),
        ((34.812847097948854-1e6j),
         (1.0000000000102545-3.150848654056419e-11j),
         1e-13),
        ((50.55805244181687-1e6j),
         (1.0000000000000002-5.736517078070873e-16j),
         1e-13),
        ((-294.86605461349745+13.992648136816397j), (-np.inf+np.inf*1j), 1e-13),
        ((-294.86605461349745-16.147667799398363j), (np.inf-np.inf*1j), 1e-13),
    ]
)
def test_riemann_zeta_complex(z, desired, rtol):
    assert_allclose(sc.zeta(z), desired, rtol=rtol)


# Some of the test cases below fail for intel compilers
cpp_compiler = scipy.__config__.CONFIG["Compilers"]["c++"]["name"]
gcc_linux = cpp_compiler == "gcc" and sys.platform == "linux"
clang_macOS = cpp_compiler == "clang" and sys.platform == "darwin"


@pytest.mark.skipif(
    not (gcc_linux or clang_macOS),
    reason="Underflow may not be avoided on other platforms",
)
@pytest.mark.parametrize(
    "z, desired, rtol",
    [
        # Test cases generated as part of same script for
        # test_riemann_zeta_complex. These cases are split off because
        # they fail on some platforms.
        #
        # Naive implementation of reflection formula suffers internal overflow
        ((-217.40285743524163+13.992648136816397j),
         (-6.012818500554211e+249-1.926943776932387e+250j),
         5e-13,),
        ((-237.71710702931668+13.992648136816397j),
         (-8.823803086106129e+281-5.009074181335139e+281j),
         1e-13,),
        ((-217.40285743524163-16.147667799398363j),
         (-5.111612904844256e+251-4.907132127666742e+250j),
         5e-13,),
        ((-237.71710702931668-16.147667799398363j),
         (-1.3256112779883167e+283-2.253002003455494e+283j),
         5e-13,),
    ],
)
def test_riemann_zeta_complex_avoid_underflow(z, desired, rtol):
    assert_allclose(sc.zeta(z), desired, rtol=rtol)
