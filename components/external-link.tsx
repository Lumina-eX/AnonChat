import { cn } from "@/lib/utils";

interface ExternalLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className)}
    >
      {children}
      <span className="sr-only">(It opens in a new tab.)</span>
    </a>
  );
}
