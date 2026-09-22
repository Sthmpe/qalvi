"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function Navigation({
  items,
  label,
  className = "",
}: {
  items: { href: string; label: string; mark?: string }[];
  label: string;
  className?: string;
}) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = nav.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (container && active && container.scrollWidth > container.clientWidth) {
      container.scrollLeft = active.offsetLeft - container.offsetLeft - 16;
    }
  }, [pathname]);
  return (
    <nav ref={nav} aria-label={label} className={className}>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href === "/studies" &&
            pathname.startsWith("/studies/") &&
            pathname !== "/studies/new");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            {item.mark && (
              <span aria-hidden="true" className="nav-mark">
                {item.mark}
              </span>
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
