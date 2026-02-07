import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services';
import type {
  User,
  AuthState,
  AuthCredentials,
  RegisterData,
  UpdateProfileData,
  ChangePasswordData,
} from '@/types';
import { ROUTES } from '@/utils/constants';

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: { user: User } }
  | { type: 'AUTH_FAILURE'; payload: { error: string } }
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_USER'; payload: { user: User } }
  | { type: 'CLEAR_ERROR' };

interface AuthContextType extends AuthState {
  login: (credentials: AuthCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: UpdateProfileData) => Promise<void>;
  changePassword: (data: ChangePasswordData) => Promise<void>;
  clearError: () => void;
}

const initialState: AuthState = {
  user: null,
  tokens: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, isLoading: true, error: null };
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'AUTH_FAILURE':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload.error,
      };
    case 'LOGOUT':
      return {
        ...initialState,
        isLoading: false,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload.user,
      };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const token = authService.getStoredToken();
      if (token) {
        try {
          const user = await authService.getCurrentUser();
          dispatch({ type: 'AUTH_SUCCESS', payload: { user } });
        } catch {
          dispatch({ type: 'LOGOUT' });
        }
      } else {
        dispatch({ type: 'AUTH_FAILURE', payload: { error: '' } });
      }
    };

    initAuth();
  }, []);

  const login = useCallback(
    async (credentials: AuthCredentials) => {
      dispatch({ type: 'AUTH_START' });
      try {
        const { user } = await authService.login(credentials);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user } });
        navigate(ROUTES.DASHBOARD);
      } catch (error) {
        dispatch({
          type: 'AUTH_FAILURE',
          payload: { error: error instanceof Error ? error.message : 'Login failed' },
        });
        throw error;
      }
    },
    [navigate]
  );

  const register = useCallback(
    async (data: RegisterData) => {
      dispatch({ type: 'AUTH_START' });
      try {
        const { user } = await authService.register(data);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user } });
        navigate(ROUTES.DASHBOARD);
      } catch (error) {
        dispatch({
          type: 'AUTH_FAILURE',
          payload: { error: error instanceof Error ? error.message : 'Registration failed' },
        });
        throw error;
      }
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      dispatch({ type: 'LOGOUT' });
      navigate(ROUTES.LOGIN);
    }
  }, [navigate]);

  const updateProfile = useCallback(async (data: UpdateProfileData) => {
    try {
      const user = await authService.updateProfile(data);
      dispatch({ type: 'UPDATE_USER', payload: { user } });
    } catch (error) {
      throw error;
    }
  }, []);

  const changePassword = useCallback(async (data: ChangePasswordData) => {
    await authService.changePassword(data);
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
