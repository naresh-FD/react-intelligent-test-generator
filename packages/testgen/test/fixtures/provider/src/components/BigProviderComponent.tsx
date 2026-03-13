import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

export function BigProviderComponent() {
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['a'], queryFn: async () => ({ ok: true }) });
  return <button onClick={() => nav('/')}>{String(data?.ok)}</button>;
}
