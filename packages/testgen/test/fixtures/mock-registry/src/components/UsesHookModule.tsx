import { useFeatureData } from '../hooks/useFeatureData';

export function UsesHookModule(): JSX.Element {
  const state = useFeatureData();
  return <div>{state.loading ? 'Loading' : 'Ready'}</div>;
}
