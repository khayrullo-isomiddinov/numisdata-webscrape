import { useState } from "react";
import { Link } from "../router.tsx";

export function TopBar({ navigate, onSearch }: { navigate: (path: string) => void; onSearch: (q: string) => void }) {
  const [q, setQ] = useState("");

  return (
    <header className="topbar">
      <Link to="/" navigate={navigate} className="topbar-brand">
        <span className="mark">Numismatic Archive</span>
        <span className="tagline">Personal numismatic research tool</span>
      </Link>
      <div className="topbar-nav">
        <form
          className="topbar-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) onSearch(q.trim());
          }}
        >
          <input
            type="search"
            placeholder="Search archive..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%" }}
          />
        </form>
      </div>
    </header>
  );
}
