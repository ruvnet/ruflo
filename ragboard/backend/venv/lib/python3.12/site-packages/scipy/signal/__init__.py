"""
=======================================
Signal processing (:mod:`scipy.signal`)
=======================================

Convolution
===========

.. autosummary::
   :toctree: generated/

   convolve           -- N-D convolution.
   correlate          -- N-D correlation.
   fftconvolve        -- N-D convolution using the FFT.
   oaconvolve         -- N-D convolution using the overlap-add method.
   convolve2d         -- 2-D convolution (more options).
   correlate2d        -- 2-D correlation (more options).
   sepfir2d           -- Convolve with a 2-D separable FIR filter.
   choose_conv_method -- Chooses faster of FFT and direct convolution methods.
   correlation_lags   -- Determines lag indices for 1D cross-correlation.

B-splines
=========

.. autosummary::
   :toctree: generated/

   gauss_spline   -- Gaussian approximation to the B-spline basis function.
   cspline1d      -- Coefficients for 1-D cubic (3rd order) B-spline.
   qspline1d      -- Coefficients for 1-D quadratic (2nd order) B-spline.
   cspline2d      -- Coefficients for 2-D cubic (3rd order) B-spline.
   qspline2d      -- Coefficients for 2-D quadratic (2nd order) B-spline.
   cspline1d_eval -- Evaluate a cubic spline at the given points.
   qspline1d_eval -- Evaluate a quadratic spline at the given points.
   spline_filter  -- Smoothing spline (cubic) filtering of a rank-2 array.

Filtering
=========

.. autosummary::
   :toctree: generated/

   order_filter  -- N-D order filter.
   medfilt       -- N-D median filter.
   medfilt2d     -- 2-D median filter (faster).
   wiener        -- N-D Wiener filter.

   symiirorder1  -- 2nd-order IIR filter (cascade of first-order systems).
   symiirorder2  -- 4th-order IIR filter (cascade of second-order systems).
   lfilter       -- 1-D FIR and IIR digital linear filtering.
   lfiltic       -- Construct initial conditions for `lfilter`.
   lfilter_zi    -- Compute an initial state zi for the lfilter function that
                 -- corresponds to the steady state of the step response.
   filtfilt      -- A forward-backward filter.
   savgol_filter -- Filter a signal using the Savitzky-Golay filter.

   deconvolve    -- 1-D deconvolution using lfilter.

   sosfilt       -- 1-D IIR digital linear filtering using
                 -- a second-order sections filter representation.
   sosfilt_zi    -- Compute an initial state zi for the sosfilt function that
                 -- corresponds to the steady state of the step response.
   sosfiltfilt   -- A forward-backward filter for second-order sections.
   hilbert       -- Compute 1-D analytic signal, using the Hilbert transform.
   hilbert2      -- Compute 2-D analytic signal, using the Hilbert transform.
   envelope      -- Compute the envelope of a real- or complex-valued signal.

   decimate      -- Downsample a signal.
   detrend       -- Remove linear and/or constant trends from data.
   resample      -- Resample using Fourier method.
   resample_poly -- Resample using polyphase filtering method.
   upfirdn       -- Upsample, apply FIR filter, downsample.

Filter design
=============

.. autosummary::
   :toctree: generated/

   bilinear      -- Digital filter from an analog filter using
                    -- the bilinear transform.
   bilinear_zpk  -- Digital filter from an analog filter using
                    -- the bilinear transform.
   findfreqs     -- Find array of frequencies for computing filter response.
   firls         -- FIR filter design using least-squares error minimization.
   firwin        -- Windowed FIR filter design, with frequency response
                    -- defined as pass and stop bands.
   firwin2       -- Windowed FIR filter design, with arbitrary frequency
                    -- response.
   firwin_2d        -- Windowed FIR filter design, with frequency response for 
                    -- 2D using 1D design.
   freqs         -- Analog filter frequency response from TF coefficients.
   freqs_zpk     -- Analog filter frequency response from ZPK coefficients.
   freqz         -- Digital filter frequency response from TF coefficients.
   sosfreqz      -- Digital filter frequency response for SOS format filter (legacy).
   freqz_sos     -- Digital filter frequency response for SOS format filter.
   freqz_zpk     -- Digital filter frequency response from ZPK coefficients.
   gammatone     -- FIR and IIR gammatone filter design.
   group_delay   -- Digital filter group delay.
   iirdesign     -- IIR filter design given bands and gains.
   iirfilter     -- IIR filter design given order and critical frequencies.
   kaiser_atten  -- Compute the attenuation of a Kaiser FIR filter, given
                    -- the number of taps and the transition width at
                    -- discontinuities in the frequency response.
   kaiser_beta   -- Compute the Kaiser parameter beta, given the desired
                    -- FIR filter attenuation.
   kaiserord     -- Design a Kaiser window to limit ripple and width of
                    -- transition region.
   minimum_phase -- Convert a linear phase FIR filter to minimum phase.
   savgol_coeffs -- Compute the FIR filter coefficients for a Savitzky-Golay
                    -- filter.
   remez         -- Optimal FIR filter design.

   unique_roots  -- Unique roots and their multiplicities.
   residue       -- Partial fraction expansion of b(s) / a(s).
   residuez      -- Partial fraction expansion of b(z) / a(z).
   invres        -- Inverse partial fraction expansion for analog filter.
   invresz       -- Inverse partial fraction expansion for digital filter.
   BadCoefficients  -- Warning on badly conditioned filter coefficients.

Lower-level filter design functions:

.. autosummary::
   :toctree: generated/

   abcd_normalize -- Check state-space matrices and ensure they are rank-2.
   band_stop_obj  -- Band Stop Objective Function for order minimization.
   besselap       -- Return (z,p,k) for analog prototype of Bessel filter.
   buttap         -- Return (z,p,k) for analog prototype of Butterworth filter.
   cheb1ap        -- Return (z,p,k) for type I Chebyshev filter.
   cheb2ap        -- Return (z,p,k) for type II Chebyshev filter.
   ellipap        -- Return (z,p,k) for analog prototype of elliptic filter.
   lp2bp          -- Transform a lowpass filter prototype to a bandpass filter.
   lp2bp_zpk      -- Transform a lowpass filter prototype to a bandpass filter.
   lp2bs          -- Transform a lowpass filter prototype to a bandstop filter.
   lp2bs_zpk      -- Transform a lowpass filter prototype to a bandstop filter.
   lp2hp          -- Transform a lowpass filter prototype to a highpass filter.
   lp2hp_zpk      -- Transform a lowpass filter prototype to a highpass filter.
   lp2lp          -- Transform a lowpass filter prototype to a lowpass filter.
   lp2lp_zpk      -- Transform a lowpass filter prototype to a lowpass filter.
   normalize      -- Normalize polynomial representation of a transfer function.



Matlab-style IIR filter design
==============================

.. autosummary::
   :toctree: generated/

   butter -- Butterworth
   buttord
   cheby1 -- Chebyshev Type I
   cheb1ord
   cheby2 -- Chebyshev Type II
   cheb2ord
   ellip -- Elliptic (Cauer)
   ellipord
   bessel -- Bessel (no order selection available -- try butterod)
   iirnotch      -- Design second-order IIR notch digital filter.
   iirpeak       -- Design second-order IIR peak (resonant) digital filter.
   iircomb       -- Design IIR comb filter.

Continuous-time linear systems
==============================

.. autosummary::
   :toctree: generated/

   lti              -- Continuous-time linear time invariant system base class.
   StateSpace       -- Linear time invariant system in state space form.
   TransferFunction -- Linear time invariant system in transfer function form.
   ZerosPolesGain   -- Linear time invariant system in zeros, poles, gain form.
   lsim             -- Continuous-time simulation of output to linear system.
   impulse          -- Impulse response of linear, time-invariant (LTI) system.
   step             -- Step response of continuous-time LTI system.
   freqresp         -- Frequency response of a continuous-time LTI system.
   bode             -- Bode magnitude and phase data (continuous-time LTI).

Discrete-time linear systems
============================

.. autosummary::
   :toctree: generated/

   dlti             -- Discrete-time linear time invariant system base class.
   StateSpace       -- Linear time invariant system in state space form.
   TransferFunction -- Linear time invariant system in transfer function form.
   ZerosPolesGain   -- Linear time invariant system in zeros, poles, gain form.
   dlsim            -- Simulation of output to a discrete-time linear system.
   dimpulse         -- Impulse response of a discrete-time LTI system.
   dstep            -- Step response of a discrete-time LTI system.
   dfreqresp        -- Frequency response of a discrete-time LTI system.
   dbode            -- Bode magnitude and phase data (discrete-time LTI).

LTI representations
===================

.. autosummary::
   :toctree: generated/

   tf2zpk        -- Transfer function to zero-pole-gain.
   tf2sos        -- Transfer function to second-order sections.
   tf2ss         -- Transfer function to state-space.
   zpk2tf        -- Zero-pole-gain to transfer function.
   zpk2sos       -- Zero-pole-gain to second-order sections.
   zpk2ss        -- Zero-pole-gain to state-space.
   ss2tf         -- State-pace to transfer function.
   ss2zpk        -- State-space to pole-zero-gain.
   sos2zpk       -- Second-order sections to zero-pole-gain.
   sos2tf        -- Second-order sections to transfer function.
   cont2discrete -- Continuous-time to discrete-time LTI conversion.
   place_poles   -- Pole placement.

Waveforms
=========

.. autosummary::
   :toctree: generated/

   chirp        -- Frequency swept cosine signal, with several freq functions.
   gausspulse   -- Gaussian modulated sinusoid.
   max_len_seq  -- Maximum length sequence.
   sawtooth     -- Periodic sawtooth.
   square       -- Square wave.
   sweep_poly   -- Frequency swept cosine signal; freq is arbitrary polynomial.
   unit_impulse -- Discrete unit impulse.

Window functions
================

For window functions, see the `scipy.signal.windows` namespace.

In the `scipy.signal` namespace, there is a convenience function to
obtain these windows by name:

.. autosummary::
   :toctree: generated/

   get_window -- Return a window of a given length and type.

Peak finding
============

.. autosummary::
   :toctree: generated/

   argrelmin        -- Calculate the relative minima of data.
   argrelmax        -- Calculate the relative maxima of data.
   argrelextrema    -- Calculate the relative extrema of data.
   find_peaks       -- Find a subset of peaks inside a signal.
   find_peaks_cwt   -- Find peaks in a 1-D array with wavelet transformation.
   peak_prominences -- Calculate the prominence of each peak in a signal.
   peak_widths      -- Calculate the width of each peak in a signal.

Spectral analysis
=================

.. autosummary::
   :toctree: generated/

   periodogram    -- Compute a (modified) periodogram.
   welch          -- Compute a periodogram using Welch's method.
   csd            -- Compute the cross spectral density, using Welch's method.
   coherence      -- Compute the magnitude squared coherence, using Welch's method.
   spectrogram    -- Compute the spectrogram (legacy).
   lombscargle    -- Computes the Lomb-Scargle periodogram.
   vectorstrength -- Computes the vector strength.
   ShortTimeFFT   -- Interface for calculating the \
                     :ref:`Short Time Fourier Transform <tutorial_stft>` and \
                     its inverse.
   closest_STFT_dual_window -- Calculate the STFT dual window of a given window \
                               closest to a desired dual window.
   stft           -- Compute the Short Time Fourier Transform (legacy).
   istft          -- Compute the Inverse Short Time Fourier Transform (legacy).
   check_COLA     -- Check the COLA constraint for iSTFT reconstruction (legacy).
   check_NOLA     -- Check the NOLA constraint for iSTFT reconstruction.

Chirp Z-transform and Zoom FFT
============================================

.. autosummary::
   :toctree: generated/

   czt - Chirp z-transform convenience function
   zoom_fft - Zoom FFT convenience function
   CZT - Chirp z-transform function generator
   ZoomFFT - Zoom FFT function generator
   czt_points - Output the z-plane points sampled by a chirp z-transform

The functions are simpler to use than the classes, but are less efficient when
using the same transform on many arrays of the same length, since they
repeatedly generate the same chirp signal with every call.  In these cases,
use the classes to create a reusable function instead.

"""
# bring in the public functionality from private namespaces

# mypy: ignore-errors

from ._support_alternative_backends import *
from . import _support_alternative_backends
__all__ = _support_alternative_backends.__all__
del _support_alternative_backends, _signal_api, _delegators  # noqa: F821


# Deprecated namespaces, to be removed in v2.0.0
from . import (
    bsplines, filter_design, fir_filter_design, lti_conversion, ltisys,
    spectral, signaltools, waveforms, wavelets, spline
)


from scipy._lib._testutils import PytestTester
test = PytestTester(__name__)
del PytestTester
