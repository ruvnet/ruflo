"""
An extension module for click to enable registering CLI commands via setuptools
entry-points.


    from pkg_resources import iter_entry_points

    import click
    from click_plugins import with_plugins


    @with_plugins(iter_entry_points('entry_point.name'))
    @click.group()
    def cli():
        '''Commandline interface for something.'''

    @cli.command()
    @click.argument('arg')
    def subcommand(arg):
        '''A subcommand for something else'''
"""


from click_plugins.core import with_plugins


__version__ = '1.1.1.2'
__author__ = 'Kevin Wurster, Sean Gillies'
__email__ = 'wursterk@gmail.com, sean.gillies@gmail.com'
__source__ = 'https://github.com/click-contrib/click-plugins'
__license__ = '''
New BSD License

Copyright (c) 2015-2025, Kevin D. Wurster, Sean C. Gillies
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither click-plugins nor the names of its contributors may not be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
'''
