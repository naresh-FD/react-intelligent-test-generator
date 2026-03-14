type Props = {
  label: string;
};

export function StaticBadge({ label }: Props) {
  return <span>{label}</span>;
}
