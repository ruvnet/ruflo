# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cimport cpython


cdef extern from "record/recordobj.h":

	cpython.PyTypeObject *ApgRecord_InitTypes() except NULL

	int ApgRecord_CheckExact(object)
	object ApgRecord_New(type, object, int)
	void ApgRecord_SET_ITEM(object, int, object)

	object ApgRecordDesc_New(object, object)
