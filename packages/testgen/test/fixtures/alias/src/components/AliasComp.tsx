import { helper } from '@/utils/helper';
import { thing } from '~/models/thing';

export default function AliasComp() {
  return <div>{helper()}{thing}</div>;
}
