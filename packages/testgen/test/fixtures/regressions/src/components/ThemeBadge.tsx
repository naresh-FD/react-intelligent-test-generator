import { useTheme } from '../providers/theme';

export function ThemeBadge() {
  const { theme } = useTheme();
  return <span>{theme}</span>;
}

export default ThemeBadge;
