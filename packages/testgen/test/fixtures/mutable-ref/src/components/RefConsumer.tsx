import { MutableRefObject } from 'react';

type Props = { readyRef: MutableRefObject<boolean> };

export function RefConsumer({ readyRef }: Props) {
  return <span>{String(readyRef.current)}</span>;
}
