type StatusBannerProps = {
  title: string;
};

export function StatusBanner({ title }: StatusBannerProps) {
  return (
    <section aria-label="status banner">
      <h1>{title}</h1>
      <button type="button">Refresh</button>
    </section>
  );
}

export default StatusBanner;
