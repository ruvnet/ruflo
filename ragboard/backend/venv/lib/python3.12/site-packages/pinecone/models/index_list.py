from pinecone.core.client.models import IndexList as OpenAPIIndexList

class IndexList:
    def __init__(self, index_list: OpenAPIIndexList):
        self.index_list = index_list
        self.current = 0

    def names(self):
        return [i['name'] for i in self.index_list.indexes]

    def __getitem__(self, key):
        return self.index_list.indexes[key]
    
    def __len__(self):
        return len(self.index_list.indexes)
    
    def __iter__(self):
        return iter(self.index_list.indexes)
    
    def __str__(self):
        return str(self.index_list)
    
    def __repr__(self):
        return repr(self.index_list)

    def __getattr__(self, attr):
        return getattr(self.index_list, attr)