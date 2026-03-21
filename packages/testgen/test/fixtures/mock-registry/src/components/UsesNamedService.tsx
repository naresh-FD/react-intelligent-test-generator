import { formatCurrency } from '../utils/formatters';

export function UsesNamedService(): JSX.Element {
  return <span>{formatCurrency(10)}</span>;
}
