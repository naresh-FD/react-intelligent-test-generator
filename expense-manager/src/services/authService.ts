import api, { setAuthToken, setRefreshToken, clearAuthTokens } from './api';
import type {
  User,
  AuthCredentials,
  RegisterData,
  AuthTokens,
  UpdateProfileData,
  ChangePasswordData,
  ApiResponse,
} from '@/types';
import { USER_KEY } from '@/utils/constants';

interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export const authService = {
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    const response = await api.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
    const { user, tokens } = response.data.data;

    setAuthToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));

    return { user, tokens };
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await api.post<ApiResponse<AuthResponse>>('/auth/register', {
      name: data.name,
      email: data.email,
      password: data.password,
    });
    const { user, tokens } = response.data.data;

    setAuthToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));

    return { user, tokens };
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      clearAuthTokens();
      localStorage.removeItem(USER_KEY);
    }
  },

  async getCurrentUser(): Promise<User> {
    const response = await api.get<ApiResponse<User>>('/auth/me');
    return response.data.data;
  },

  async updateProfile(data: UpdateProfileData): Promise<User> {
    const response = await api.put<ApiResponse<User>>('/auth/profile', data);
    const user = response.data.data;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  async changePassword(data: ChangePasswordData): Promise<void> {
    await api.post('/auth/change-password', data);
  },

  async forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { token, password });
  },

  async refreshToken(): Promise<AuthTokens> {
    const refreshToken = localStorage.getItem('expense_manager_refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await api.post<ApiResponse<AuthTokens>>('/auth/refresh', {
      refreshToken,
    });
    const tokens = response.data.data;

    setAuthToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);

    return tokens;
  },

  getStoredUser(): User | null {
    const userStr = localStorage.getItem(USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  getStoredToken(): string | null {
    return localStorage.getItem('expense_manager_token');
  },

  isAuthenticated(): boolean {
    return !!this.getStoredToken();
  },
};

export default authService;
