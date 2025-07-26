export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const API_V1_PREFIX = '/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export const API_ENDPOINTS = {
  // Auth
  LOGIN: `${API_V1_PREFIX}/auth/login`,
  REGISTER: `${API_V1_PREFIX}/auth/register`,
  REFRESH: `${API_V1_PREFIX}/auth/refresh`,
  LOGOUT: `${API_V1_PREFIX}/auth/logout`,
  ME: `${API_V1_PREFIX}/auth/me`,
  
  // Resources
  RESOURCES: `${API_V1_PREFIX}/resources`,
  UPLOAD: `${API_V1_PREFIX}/resources/upload`,
  
  // Collections
  COLLECTIONS: `${API_V1_PREFIX}/collections`,
  
  // Conversations
  CONVERSATIONS: `${API_V1_PREFIX}/conversations`,
  
  // Processing
  PROCESS: `${API_V1_PREFIX}/processing/process`,
  
  // Vector Search
  SEARCH: `${API_V1_PREFIX}/search`,
};
