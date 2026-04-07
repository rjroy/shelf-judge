"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
    label: "Ranking",
    items: [
      {
        href: "/tournament",
        name: "Tournament",
        icon: (
          <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2h8v1H4V2zm-2 2h12v1h-1.5l-1 3H12l-.5 1.5h-1L10 11H9l-.5 1.5h-1L7 11H6l-.5-1.5h-1L4 6.5H2.5L1.5 5H4V4zM5.5 5l1 3h3l1-3h-5zM6.5 12h3v1.5h-3V12z" />
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

const SidebarContext = createContext<{ open: boolean; toggle: () => void; close: () => void }>({
  open: false,
  toggle: () => {},
  close: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  // Close sidebar on route change
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Close sidebar on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  // Lock body scroll when sidebar overlay is open
  useEffect(() => {
    document.body.classList.toggle("sidebar-overlay-open", open);
    return () => document.body.classList.remove("sidebar-overlay-open");
  }, [open]);

  const value = useMemo(() => ({ open, toggle, close }), [open, toggle, close]);

  return (
    <SidebarContext.Provider value={value}>
      <div
        className={`sidebar-backdrop${open ? " sidebar-backdrop-visible" : ""}`}
        onClick={close}
        aria-hidden="true"
      />
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { open, close } = useSidebar();

  return (
    <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
      <button className="sidebar-close" onClick={close} aria-label="Close navigation">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
        </svg>
      </button>
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

export function MobileHeader() {
  const { toggle } = useSidebar();

  return (
    <div className="mobile-header">
      <button className="topbar-hamburger" onClick={toggle} aria-label="Open navigation">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 5h14v1.5H3V5zm0 4.25h14v1.5H3v-1.5zm0 4.25h14V15H3v-1.5z" />
        </svg>
      </button>
      <span className="topbar-brand">Shelf Judge</span>
    </div>
  );
}
