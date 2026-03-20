export interface GlobalStateValue {
  selectedAccount: string;
}

export function useGlobalState(): GlobalStateValue {
  return {
    selectedAccount: 'Primary',
  };
}
