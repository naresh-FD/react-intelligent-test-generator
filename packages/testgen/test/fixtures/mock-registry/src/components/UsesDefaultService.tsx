import authService from '../services/authService';

export function UsesDefaultService(): JSX.Element {
  return <button onClick={() => authService.get()}>Load</button>;
}
