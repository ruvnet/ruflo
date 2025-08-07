#!/usr/bin/env python
"""
Debug the separability_matrix issue step by step
"""
import numpy as np
from astropy.modeling import models as m
from astropy.modeling.separable import separability_matrix, _separable, _cdot, _coord_matrix

# Create the nested compound model as described in the issue
cm = m.Linear1D(10) & m.Linear1D(5)
print("First compound model (cm):")
print(f"  Model: {cm}")
print(f"  n_inputs: {cm.n_inputs}, n_outputs: {cm.n_outputs}")
print(f"  Separability matrix:")
sep1 = separability_matrix(cm)
print(f"  {sep1}")
print()

# Now create the mapping
mapping = m.Mapping([0, 1, 0, 1])
print("Mapping:")
print(f"  Model: {mapping}")
print(f"  Mapping: {mapping.mapping}")
print(f"  n_inputs: {mapping.n_inputs}, n_outputs: {mapping.n_outputs}")
print()

# Create the nested model
nested_cm = mapping | cm
print("Nested CompoundModel (mapping | cm):")
print(f"  Model: {nested_cm}")
print(f"  n_inputs: {nested_cm.n_inputs}, n_outputs: {nested_cm.n_outputs}")
print()

# Get the internal separability matrix (before boolean conversion)
internal_sep = _separable(nested_cm)
print("Internal _separable result (before boolean conversion):")
print(internal_sep)
print()

# Get the final separability matrix
sep_matrix = separability_matrix(nested_cm)
print("Final separability_matrix output:")
print(sep_matrix)
print()

print("Expected output:")
print("[[True, True], [True, True]]")
print()

# Let's trace through the calculation step by step
print("\n=== DETAILED TRACE ===")
print("\n1. Mapping coord_matrix:")
map_coords = _coord_matrix(mapping, "left", mapping.n_outputs)
print(f"Shape: {map_coords.shape}")
print(map_coords)

print("\n2. CM separability:")
cm_sep = _separable(cm)
print(f"Shape: {cm_sep.shape}")
print(cm_sep)

print("\n3. Result of _cdot operation:")
# In _cdot, left and right are swapped
result = _cdot(mapping, cm)
print(f"Shape: {result.shape}")
print(result)