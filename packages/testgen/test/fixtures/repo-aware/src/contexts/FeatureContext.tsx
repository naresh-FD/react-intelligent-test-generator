import React from 'react';

export interface FeatureContextValue {
  featureName: string;
  openServiceFailureModal: () => void;
}

export const FeatureContext = React.createContext<FeatureContextValue>({
  featureName: 'Transfers',
  openServiceFailureModal: () => undefined,
});
