import MissingWidget from 'fancy-widget-lib';

export function NeedsExternalWidget() {
  return (
    <section>
      <h1>Widget Host</h1>
      <MissingWidget />
    </section>
  );
}
