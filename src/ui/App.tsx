import { TopBar } from "./components/TopBar.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { AuctionPage } from "./pages/AuctionPage.tsx";
import { LotPage } from "./pages/LotPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { GuidePage } from "./pages/GuidePage.tsx";
import { matchRoute, usePathname } from "./router.tsx";

export function App() {
  const [location, navigate] = usePathname();
  const match = matchRoute(location);

  return (
    <>
      <TopBar navigate={navigate} onSearch={(q) => navigate(`/search?q=${encodeURIComponent(q)}`)} />
      {match.route === "home" && <HomePage navigate={navigate} />}
      {match.route === "auction" && match.id && <AuctionPage id={match.id} navigate={navigate} />}
      {match.route === "lot" && match.id && <LotPage id={match.id} navigate={navigate} />}
      {match.route === "search" && <SearchPage query={match.query ?? ""} navigate={navigate} />}
      {match.route === "guide" && <GuidePage navigate={navigate} />}
      {match.route === "not-found" && (
        <div className="page empty-state">
          <p>Page not found.</p>
        </div>
      )}
    </>
  );
}
