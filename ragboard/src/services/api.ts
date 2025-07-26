import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Resource, AIChat, Message } from '../types';
import { API_BASE_URL, API_V1_PREFIX } from '../config/api';

// Create axios instance with default configuration
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Handle token refresh or redirect to login
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API Service class
export class ApiService {
  // Auth endpoints
  static async login(email: string, password: string) {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
  }

  static async register(email: string, password: string, name: string) {
    const response = await apiClient.post('/auth/register', { email, password, name });
    return response.data;
  }

  static async logout() {
    await apiClient.post('/auth/logout');
    localStorage.removeItem('auth_token');
  }

  // Resource endpoints
  static async uploadResource(file: File, metadata?: any): Promise<Resource> {
    const formData = new FormData();
    formData.append('file', file);
    if (metadata) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    const response = await apiClient.post('/resources/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / (progressEvent.total || 1)
        );
        // Emit progress event
        window.dispatchEvent(new CustomEvent('upload-progress', { 
          detail: { percentCompleted, file: file.name } 
        }));
      },
    });
    return response.data;
  }

  static async processURL(url: string, platform?: string): Promise<Resource> {
    const response = await apiClient.post('/resources/process-url', { 
      url, 
      platform 
    });
    return response.data;
  }

  static async processText(title: string, content: string): Promise<Resource> {
    const response = await apiClient.post('/resources/process-text', { 
      title, 
      content 
    });
    return response.data;
  }

  static async deleteResource(resourceId: string): Promise<void> {
    await apiClient.delete(`/resources/${resourceId}`);
  }

  static async getResources(): Promise<Resource[]> {
    const response = await apiClient.get('/resources');
    return response.data;
  }

  // AI Chat endpoints
  static async createChat(boardId: string): Promise<AIChat> {
    const response = await apiClient.post('/chats', { boardId });
    return response.data;
  }

  static async sendMessage(
    chatId: string, 
    message: string, 
    connectedResources: string[]
  ): Promise<Message> {
    const response = await apiClient.post(`/chats/${chatId}/messages`, {
      message,
      connected_resources: connectedResources,
    });
    return response.data;
  }

  static async streamMessage(
    chatId: string,
    message: string,
    connectedResources: string[],
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}${API_V1_PREFIX}/chats/${chatId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify({
        message,
        connected_resources: connectedResources,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              onChunk(data.content);
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e);
          }
        }
      }
    }
  }

  static async getChatHistory(chatId: string): Promise<Message[]> {
    const response = await apiClient.get(`/chats/${chatId}/messages`);
    return response.data;
  }

  // Board endpoints
  static async createBoard(name: string): Promise<any> {
    const response = await apiClient.post('/boards', { name });
    return response.data;
  }

  static async getBoard(boardId: string): Promise<any> {
    const response = await apiClient.get(`/boards/${boardId}`);
    return response.data;
  }

  static async saveBoard(boardData: {
    name: string;
    resources: Resource[];
    connections: any[];
    aiChats: AIChat[];
  }): Promise<void> {
    await apiClient.post('/boards/save', boardData);
  }

  static async loadBoard(boardId: string): Promise<{
    name: string;
    resources: Resource[];
    connections: any[];
    aiChats: AIChat[];
  }> {
    const response = await apiClient.get(`/boards/${boardId}/load`);
    return response.data;
  }

  static async listBoards(): Promise<Array<{
    id: string;
    name: string;
    updatedAt: Date;
  }>> {
    const response = await apiClient.get('/boards');
    return response.data.map((board: any) => ({
      ...board,
      updatedAt: new Date(board.updatedAt || board.updated_at)
    }));
  }

  // Vector search endpoints
  static async searchSimilar(query: string, boardId: string): Promise<any[]> {
    const response = await apiClient.post('/search/similar', { 
      query, 
      board_id: boardId 
    });
    return response.data;
  }

  // Processing status endpoints
  static async getProcessingStatus(resourceId: string): Promise<any> {
    const response = await apiClient.get(`/processing/status/${resourceId}`);
    return response.data;
  }
}

// Export both named and default
export { apiClient };
export default apiClient;