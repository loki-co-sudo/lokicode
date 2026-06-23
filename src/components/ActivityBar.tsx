import type { ReactNode } from "react";

export type SidebarView = "explorer" | "search" | "git" | null;

interface ActivityBarProps {
  view: SidebarView;
  onSelect: (view: Exclude<SidebarView, null>) => void;
}

export default function ActivityBar({ view, onSelect }: ActivityBarProps) {
  const items: { id: Exclude<SidebarView, null>; title: string; icon: ReactNode }[] = [
    {
      id: "explorer",
      title: "エクスプローラ",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        </svg>
      ),
    },
    {
      id: "search",
      title: "検索 / 置換",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      ),
    },
    {
      id: "git",
      title: "ソース管理 (Git)",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="9" r="2.5" />
          <path d="M6 8.5v7" />
          <path d="M18 11.5a6 6 0 0 1-6 6H8.5" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-r border-neutral-800 bg-[#2c2c2d] py-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onSelect(it.id)}
          title={it.title}
          className={
            "flex h-12 w-12 items-center justify-center border-l-2 transition-colors " +
            (view === it.id
              ? "border-blue-400 text-neutral-100"
              : "border-transparent text-neutral-500 hover:text-neutral-200")
          }
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}
