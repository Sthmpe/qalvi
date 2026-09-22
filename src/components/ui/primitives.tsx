import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function QalviOrb({ size = "small" }: { size?: "small" | "large" }) {
  return (
    <span aria-hidden="true" className={`qalvi-orb qalvi-orb--${size}`}>
      <span />
    </span>
  );
}
export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <button
      type="button"
      className={`q-button q-button--${variant} ${className}`}
      {...props}
    />
  );
}
export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <Link className={`q-button q-button--${variant}`} href={href}>
      {children}
    </Link>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "indigo";
}) {
  return <span className={`q-badge q-badge--${tone}`}>{children}</span>;
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`q-card ${className}`}>{children}</div>;
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="q-page-heading">
      <div>
        <p className="q-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="q-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="q-section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="q-empty">
      <QalviOrb />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </Card>
  );
}
