import { apiClient } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: Date;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends LoginCredentials {
  name: string;
}

class AuthService {
  private user: User | null = null;
  private refreshTokenTimeout: NodeJS.Timeout | null = null;

  constructor() {
    // Check for existing session
    this.initializeAuth();
  }

  private async initializeAuth() {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        await this.getProfile();
      } catch (error) {
        this.logout();
      }
    }
  }

  async login(credentials: LoginCredentials): Promise<User> {
    const response = await apiClient.post<AuthTokens>('/auth/login', credentials);
    const tokens = response.data;
    
    this.storeTokens(tokens);
    await this.getProfile();
    this.scheduleTokenRefresh(tokens.expires_in);
    
    return this.user!;
  }

  async register(data: RegisterData): Promise<User> {
    const response = await apiClient.post<AuthTokens>('/auth/register', data);
    const tokens = response.data;
    
    this.storeTokens(tokens);
    await this.getProfile();
    this.scheduleTokenRefresh(tokens.expires_in);
    
    return this.user!;
  }

  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.clearAuth();
    }
  }

  async getProfile(): Promise<User> {
    const response = await apiClient.get<User>('/auth/profile');
    this.user = response.data;
    return this.user;
  }

  async refreshToken(): Promise<void> {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await apiClient.post<AuthTokens>('/auth/refresh', {
      refresh_token: refreshToken,
    });
    
    const tokens = response.data;
    this.storeTokens(tokens);
    this.scheduleTokenRefresh(tokens.expires_in);
  }

  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await apiClient.put<User>('/auth/profile', data);
    this.user = response.data;
    return this.user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await apiClient.post('/auth/request-reset', { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/reset-password', {
      token,
      new_password: newPassword,
    });
  }

  private storeTokens(tokens: AuthTokens): void {
    localStorage.setItem('auth_token', tokens.access_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
    localStorage.setItem('token_expires', String(Date.now() + tokens.expires_in * 1000));
  }

  private scheduleTokenRefresh(expiresIn: number): void {
    // Clear existing timeout
    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
    }

    // Schedule refresh 1 minute before expiry
    const refreshTime = (expiresIn - 60) * 1000;
    this.refreshTokenTimeout = setTimeout(() => {
      this.refreshToken().catch(() => {
        this.logout();
      });
    }, refreshTime);
  }

  private clearAuth(): void {
    this.user = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('token_expires');
    
    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
      this.refreshTokenTimeout = null;
    }
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  getUser(): User | null {
    return this.user;
  }

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  }
}

// Create singleton instance
const authService = new AuthService();

export default authService;