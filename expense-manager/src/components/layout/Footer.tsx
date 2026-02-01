import { APP_NAME, APP_VERSION } from '@/utils/constants';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background py-4">
      <div className="flex flex-col items-center justify-between gap-2 px-4 text-sm text-muted-foreground sm:flex-row lg:px-6">
        <p>
          &copy; {currentYear} {APP_NAME}. All rights reserved.
        </p>
        <p>Version {APP_VERSION}</p>
      </div>
    </footer>
  );
}

export default Footer;
