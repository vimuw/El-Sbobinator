// Lecture names tend to differ only at the end ("… Lezione 7.m4a", "… Lezione 8.m4a"), so on a
// phone, where one line holds little, the name loses its middle instead, as in the iPhone Files
// app: the head takes the ellipsis and the tail always shows. Wider screens keep one plain line
// that ends in the ellipsis (index.css), and the whole name stays in the tooltip.
export const MIDDLE_TRUNCATE_TAIL = 12;

export function MiddleTruncate({ text }: { text: string }) {
  if (text.length <= MIDDLE_TRUNCATE_TAIL * 2) return <>{text}</>;
  const cut = text.length - MIDDLE_TRUNCATE_TAIL;
  return (
    <span className="middle-truncate" title={text}>
      <span className="middle-truncate-head">{text.slice(0, cut)}</span>
      <span className="middle-truncate-tail">{text.slice(cut)}</span>
    </span>
  );
}
