import { useProfile } from '../hooks/useProfile';

export default function ProfileCard() {
  const { profile } = useProfile();
  return <div>{profile?.name}</div>;
}
