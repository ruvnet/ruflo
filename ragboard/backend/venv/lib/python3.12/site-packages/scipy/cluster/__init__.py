"""
=========================================
Clustering package (:mod:`scipy.cluster`)
=========================================

.. currentmodule:: scipy.cluster

Clustering algorithms are useful in information theory, target detection,
communications, compression, and other areas. The `vq` module only
supports vector quantization and the k-means algorithms.

The `hierarchy` module provides functions for hierarchical and
agglomerative clustering.  Its features include generating hierarchical
clusters from distance matrices,
calculating statistics on clusters, cutting linkages
to generate flat clusters, and visualizing clusters with dendrograms.

.. toctree::
   :maxdepth: 1

   cluster.vq
   cluster.hierarchy

"""
__all__ = ['vq', 'hierarchy']

from . import vq, hierarchy

from scipy._lib._testutils import PytestTester
test = PytestTester(__name__)
del PytestTester
