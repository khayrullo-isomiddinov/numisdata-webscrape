import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Link } from "../router.tsx";
import { formatPrice } from "../format.ts";

export function SearchPage({ query, navigate }: { query: string; navigate: (path: string) => void }) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .search(query)
      .then((r) => setResults(r.results))
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <div className="page">
      <div className="hero" style={{ padding: "1.5rem 0 2rem", textAlign: "left" }}>
        <h1 style={{ fontSize: "1.4rem" }}>Search results for "{query}"</h1>
      </div>

      {loading ? (
        <div className="page-loading">
          <span className="spinner" /> Searching...
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">No lots matched your search across the archive.</div>
      ) : (
        <div className="auction-row-list">
          {results.map((lot) => (
            <Link key={lot.id} to={`/lots/${lot.id}`} navigate={navigate} className="auction-row">
              <div>
                <div className="auction-row-title">
                  Lot {lot.lotNumber ?? "—"}. {lot.title ?? "Untitled"}
                </div>
                <div className="auction-row-meta">
                  {lot.auctionTitle} {lot.material ? `· ${lot.material}` : ""} {lot.mint ? `· ${lot.mint}` : ""}
                </div>
              </div>
              <span className="meta-badge">
                {formatPrice(lot.realizedPrice ?? lot.startingPrice, lot.currency) ?? "—"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
