import React, { useContext } from 'react';
import { FeatureContext } from '../contexts/FeatureContext';
import { useGlobalState } from '../hooks/useGlobalState';
import { useTransactionsState } from '../hooks/useTransactionsState';

export function ScheduledTransfers() {
  const featureContext = useContext(FeatureContext);
  const { selectedAccount } = useGlobalState();
  const { scheduledTransfers, isLoading, errorMessage, openServiceFailureModal } = useTransactionsState();

  if (isLoading) {
    return <div>Loading scheduled transfers...</div>;
  }

  if (errorMessage) {
    return <div role="alert">{errorMessage}</div>;
  }

  if (scheduledTransfers.length === 0) {
    return <div>No scheduled transfers found for {selectedAccount}</div>;
  }

  return (
    <section>
      <header>{featureContext.featureName}</header>
      <button onClick={() => openServiceFailureModal()}>Open modal</button>
      <table>
        <tbody>
          {scheduledTransfers.map((transfer) => (
            <tr key={transfer.id}>
              <td>{transfer.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
