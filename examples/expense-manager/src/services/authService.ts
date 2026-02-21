import { setAuthToken, setRefreshToken, clearAuthTokens } from './api';
import { localDb, localDbHelpers } from './localDb';
import type {
  User,
  AuthCredentials,
  RegisterData,
  AuthTokens,
  UpdateProfileData,
  ChangePasswordData,
} from '@/types';
import { USER_KEY } from '@/utils/constants';
import { generateId } from '@/utils/helpers';

interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

const createTokens = (): AuthTokens => {
  return {
    accessToken: `local-access-${Date.now()}`,
    refreshToken: `local-refresh-${Date.now()}`,
    expiresIn: 60 * 60,
  };
};

const toPublicUser = (user: User | (User & { password: string })): User => {
  const { id, email, name, avatar, currency, timezone, language, createdAt, updatedAt } = user;
  return { id, email, name, avatar, currency, timezone, language, createdAt, updatedAt };
};

const storeSession = (user: User, tokens: AuthTokens): void => {
  setAuthToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const authService = {
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    const matchedUser = localDb
      .getUsers()
      .find(
        (user) =>
          user.email.toLowerCase() === credentials.email.toLowerCase() &&
          user.password === credentials.password
      );

    if (!matchedUser) {
      throw new Error('Invalid email or password');
    }

    const user = toPublicUser(matchedUser);
    const tokens = createTokens();
    storeSession(user, tokens);

    return { user, tokens };
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const users = localDb.getUsers();
    const existing = users.find((user) => user.email.toLowerCase() === data.email.toLowerCase());

    if (existing) {
      throw new Error('Email already exists');
    }

    const timestamp = localDbHelpers.nowIso();
    const localUser = {
      id: generateId(),
      email: data.email,
      password: data.password,
      name: data.name,
      avatar: '',
      currency: 'USD',
      timezone: 'America/New_York',
      language: 'en',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    localDb.upsertUser(localUser);

    const user = toPublicUser(localUser);
    const tokens = createTokens();
    storeSession(user, tokens);

    return { user, tokens };
  },

  async logout(): Promise<void> {
    clearAuthTokens();
    localStorage.removeItem(USER_KEY);
  },

  async getCurrentUser(): Promise<User> {
    const user = this.getStoredUser();
    if (!user) {
      throw new Error('No active user session');
    }

    const dbUser = localDb.getUsers().find((item) => item.id === user.id);
    if (!dbUser) {
      throw new Error('User not found');
    }

    return toPublicUser(dbUser);
  },

  async updateProfile(data: UpdateProfileData): Promise<User> {
    const current = this.getStoredUser();
    if (!current) {
      throw new Error('Not authenticated');
    }

    const dbUser = localDb.getUsers().find((user) => user.id === current.id);
    if (!dbUser) {
      throw new Error('User not found');
    }

    const updated = {
      ...dbUser,
      ...data,
      updatedAt: localDbHelpers.nowIso(),
    };

    localDb.upsertUser(updated);
    const publicUser = toPublicUser(updated);
    localStorage.setItem(USER_KEY, JSON.stringify(publicUser));

    return publicUser;
  },

  async changePassword(data: ChangePasswordData): Promise<void> {
    const current = this.getStoredUser();
    if (!current) {
      throw new Error('Not authenticated');
    }

    const dbUser = localDb.getUsers().find((user) => user.id === current.id);
    if (!dbUser) {
      throw new Error('User not found');
    }

    if (dbUser.password !== data.currentPassword) {
      throw new Error('Current password is incorrect');
    }

    localDb.upsertUser({
      ...dbUser,
      password: data.newPassword,
      updatedAt: localDbHelpers.nowIso(),
    });
  },

  async forgotPassword(email: string): Promise<void> {
    const exists = localDb
      .getUsers()
      .some((user) => user.email.toLowerCase() === email.toLowerCase());
    if (!exists) {
      throw new Error('Email not found');
    }
  },

  async resetPassword(_token: string, _password: string): Promise<void> {
    // Local mode does not issue reset tokens. Keep method for API compatibility.
  },

  async refreshToken(): Promise<AuthTokens> {
    const refreshToken = localStorage.getItem('expense_manager_refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const tokens = createTokens();
    setAuthToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);

    return tokens;
  },

  getStoredUser(): User | null {
    const userStr = localStorage.getItem(USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr) as User;
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
