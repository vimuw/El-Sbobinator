import { Highlighter } from 'lucide-react';

export function HighlightIcon({ color, className = 'h-3.5 w-3.5' }: { color: string; className?: string }) {
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center">
      <Highlighter className={`${className} shrink-0`} />
      <span
        className="absolute -bottom-1 left-0 right-0 h-[2.5px] rounded-full"
        style={{ background: color }}
      />
    </span>
  );
}
