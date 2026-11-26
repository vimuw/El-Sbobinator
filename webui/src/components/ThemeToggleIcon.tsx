import { Moon, Sun } from 'lucide-react';
import { useChangedSinceMount } from '../hooks/useChangedSinceMount';

// The icon of the theme toggle, in the sidebar and in the editor header. It shows the theme the
// tap switches to. After a tap the new icon comes in (index.css, .theme-toggle-btn): the sun
// opens its rays, the moon swings in. Until the theme first changes it is just there, so opening
// the app or the editor, or any other re-render, animates nothing. Sun and Moon are different
// elements, so the class replays the animation only when the icon is swapped.
export function ThemeToggleIcon({ themeMode, size, className }: {
  themeMode: 'light' | 'dark';
  size?: number;
  className?: string;
}) {
  const entering = useChangedSinceMount(themeMode);
  const classes = [className, entering ? 'is-entering' : null].filter(Boolean).join(' ') || undefined;
  return themeMode === 'dark'
    ? <Sun size={size} className={classes} />
    : <Moon size={size} className={classes} />;
}
