export interface ScheduledTransfer {
  id: string;
  name: string;
}

export interface TransactionsStateValue {
  scheduledTransfers: ScheduledTransfer[];
  isLoading: boolean;
  errorMessage: string | null;
  openServiceFailureModal: () => void;
}

export function useTransactionsState(): TransactionsStateValue {
  return {
    scheduledTransfers: [],
    isLoading: false,
    errorMessage: null,
    openServiceFailureModal: () => undefined,
  };
}
