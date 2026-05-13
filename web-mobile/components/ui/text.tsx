import type { ReactNode } from "react";
import { tokens } from "@/lib/design/tokens";

const t = tokens.typography;

type CommonProps = {
  children: ReactNode;
  className?: string;
};

export function TextH1({ children, className = "" }: CommonProps) {
  return <h1 className={`${t.h1} ${className}`}>{children}</h1>;
}

export function TextH2({ children, className = "" }: CommonProps) {
  return <h2 className={`${t.h2} ${className}`}>{children}</h2>;
}

export function TextH3({ children, className = "" }: CommonProps) {
  return <h3 className={`${t.h3} ${className}`}>{children}</h3>;
}

export function SerifBody({ children, className = "" }: CommonProps) {
  return <p className={`${t.serifBody} ${className}`}>{children}</p>;
}

export function Subtitle({ children, className = "" }: CommonProps) {
  return <p className={`${t.subtitle} ${className}`}>{children}</p>;
}

export function Paragraph({ children, className = "" }: CommonProps) {
  return <p className={`${t.paragraph} ${className}`}>{children}</p>;
}

export function MonoBase({ children, className = "" }: CommonProps) {
  return <span className={`${t.monoBase} ${className}`}>{children}</span>;
}

export function MonoSmall({ children, className = "" }: CommonProps) {
  return <span className={`${t.monoSmall} ${className}`}>{children}</span>;
}

export function Eyebrow({ children, className = "", withDashes = false }: CommonProps & { withDashes?: boolean }) {
  return (
    <span className={`${t.eyebrow} ${className}`}>
      {withDashes ? `— ${children} —` : children}
    </span>
  );
}

export function Label({ children, className = "" }: CommonProps) {
  return <span className={`${t.label} ${className}`}>{children}</span>;
}

export function ButtonText({ children, className = "" }: CommonProps) {
  return <span className={`${t.buttonText} ${className}`}>{children}</span>;
}

export function InputText({ children, className = "" }: CommonProps) {
  return <span className={`${t.inputText} ${className}`}>{children}</span>;
}

export function ErrorText({ children, className = "" }: CommonProps) {
  return <p className={`${t.error} ${className}`}>{children}</p>;
}
