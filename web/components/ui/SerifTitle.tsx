import { ReactNode } from "react";

type Size = "xl" | "md" | "body" | "lyric";

const sizeMap: Record<Size, string> = {
  xl: "text-[26px] leading-[1.1]",
  md: "text-[19px] leading-[1.1]",
  body: "text-[16px] leading-snug",
  lyric: "text-[18px] leading-relaxed italic",
};

export function SerifTitle({
  children,
  size = "md",
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  size?: Size;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  return <Tag className={`font-serif text-ink ${sizeMap[size]} ${className}`}>{children}</Tag>;
}
