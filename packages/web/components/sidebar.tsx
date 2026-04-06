"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navGroups = [
  {
    label: "Library",
    items: [
      {
        href: "/",
        name: "Collection",
        icon: (
          <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 3h6v1H5V8zm0 3h4v1H5v-1z" />
          </svg>
        ),
      },
      {
        href: "/axes",
        name: "Axes",
        icon: (
          <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 3a1 1 0 011-1h12a1 1 0 010 2H2a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 010 2H2a1 1 0 01-1-1zm0 5a1 1 0 011-1h8a1 1 0 010 2H2a1 1 0 01-1-1z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Add",
    items: [
      {
        href: "/search",
        name: "Add Game",
        icon: (
          <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm0 3v2H6v1h2v2h1V8h2V7H9V5H8z" />
          </svg>
        ),
      },
      {
        href: "/import",
        name: "Import BGG",
        icon: (
          <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 3H2a1 1 0 00-1 1v8a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1zM8 11l-4-3h2.5V7h3v1H12L8 11z" />
          </svg>
        ),
      },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <svg
            width="22"
            height="18"
            viewBox="0 0 22 18"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="0" y="6" width="5" height="12" rx="1" fill="#b86c1a" />
            <rect x="7" y="0" width="5" height="18" rx="1" fill="#e8e4dc" />
            <rect x="14" y="4" width="5" height="14" rx="1" fill="#e8e4dc" opacity="0.6" />
          </svg>
          <span className="brand-name">Shelf Judge</span>
        </div>
        <div className="brand-sub">Board Game Collection</div>
      </div>

      <nav className="nav-section">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${isActive(pathname, item.href) ? " active" : ""}`}
              >
                {item.icon}
                {item.name}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">Shelf Judge v0.1</div>
    </aside>
  );
}
