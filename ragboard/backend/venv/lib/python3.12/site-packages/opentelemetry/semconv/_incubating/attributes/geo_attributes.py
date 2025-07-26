# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from enum import Enum
from typing import Final

GEO_CONTINENT_CODE: Final = "geo.continent.code"
"""
Two-letter code representing continent’s name.
"""

GEO_COUNTRY_ISO_CODE: Final = "geo.country.iso_code"
"""
Two-letter ISO Country Code ([ISO 3166-1 alpha2](https://wikipedia.org/wiki/ISO_3166-1#Codes)).
"""

GEO_LOCALITY_NAME: Final = "geo.locality.name"
"""
Locality name. Represents the name of a city, town, village, or similar populated place.
"""

GEO_LOCATION_LAT: Final = "geo.location.lat"
"""
Latitude of the geo location in [WGS84](https://wikipedia.org/wiki/World_Geodetic_System#WGS84).
"""

GEO_LOCATION_LON: Final = "geo.location.lon"
"""
Longitude of the geo location in [WGS84](https://wikipedia.org/wiki/World_Geodetic_System#WGS84).
"""

GEO_POSTAL_CODE: Final = "geo.postal_code"
"""
Postal code associated with the location. Values appropriate for this field may also be known as a postcode or ZIP code and will vary widely from country to country.
"""

GEO_REGION_ISO_CODE: Final = "geo.region.iso_code"
"""
Region ISO code ([ISO 3166-2](https://wikipedia.org/wiki/ISO_3166-2)).
"""


class GeoContinentCodeValues(Enum):
    AF = "AF"
    """Africa."""
    AN = "AN"
    """Antarctica."""
    AS = "AS"
    """Asia."""
    EU = "EU"
    """Europe."""
    NA = "NA"
    """North America."""
    OC = "OC"
    """Oceania."""
    SA = "SA"
    """South America."""
