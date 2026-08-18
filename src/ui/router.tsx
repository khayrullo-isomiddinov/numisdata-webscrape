import { useCallback, useEffect, useState } from "react";

function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

/** Minimal client-side router: no dependency needed for four routes. Tracks pathname + search. */
export function usePathname(): [string, (path: string) => void] {
  const [location, setLocation] = useState(currentLocation());

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setLocation(currentLocation());
    window.scrollTo(0, 0);
  }, []);

  return [location, navigate];
}

export function Link({ to, navigate, className, children }: { to: string; navigate: (path: string) => void; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function matchRoute(
  location: string,
): { route: "home" | "auction" | "lot" | "search" | "not-found"; id?: string; query?: string } {
  const [pathname, search] = location.split("?");
  if (pathname === "/" || pathname === "" || pathname === undefined) return { route: "home" };
  if (pathname === "/search") return { route: "search", query: new URLSearchParams(search ?? "").get("q") ?? "" };
  const auctionMatch = pathname.match(/^\/auctions\/(\d+)\/?$/);
  if (auctionMatch) return { route: "auction", id: auctionMatch[1] };
  const lotMatch = pathname.match(/^\/lots\/(\d+)\/?$/);
  if (lotMatch) return { route: "lot", id: lotMatch[1] };
  return { route: "not-found" };
}
