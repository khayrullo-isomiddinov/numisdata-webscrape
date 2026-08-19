import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AuctionSummary } from "../api.ts";
import { Link } from "../router.tsx";
import { formatDate } from "../format.ts";

type RetrievePhase = { kind: "starting" } | { kind: "polling"; currentPage: number | null; totalPages: number | null };

const POLL_INTERVAL_MS = 700;

export function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<RetrievePhase | null>(null);
  const [error, setError] = useState<{ message: string; diagnostic?: Record<string, unknown> } | null>(null);
  const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    api.listAuctions().then((r) => setAuctions(r.auctions)).catch(() => {});
    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  /** Polls GET /api/acquisitions/:runId for real page-by-page progress until the run completes -
   * the backend acquires pages in the background (rate-limited, can take well over a minute for
   * a large multi-page sixbid/Biddr auction), so this is the actual state, not a simulation. */
  function pollRun(runId: number) {
    const tick = async () => {
      if (cancelledRef.current) return;
      let run: Awaited<ReturnType<typeof api.getAcquisitionRun>>["run"];
      try {
        ({ run } = await api.getAcquisitionRun(runId));
      } catch {
        // Transient failure polling status - keep trying rather than giving up on one hiccup.
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      if (cancelledRef.current) return;

      if (!run.completedAt) {
        setPhase({ kind: "polling", currentPage: run.currentPage, totalPages: run.totalPages });
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      if (run.status === "success" && run.auctionId) {
        navigate(`/auctions/${run.auctionId}`);
      } else {
        setPhase(null);
        setError({ message: run.errorMessage ?? "Retrieval failed." });
      }
    };
    tick();
  }

  async function handleRetrieve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) return;

    setPhase({ kind: "starting" });
    try {
      const result = await api.retrieve(url.trim());
      if (result.status === "complete") {
        navigate(`/auctions/${result.auctionId}`);
        return;
      }
      setPhase({ kind: "polling", currentPage: null, totalPages: null });
      pollRun(result.runId);
    } catch (err) {
      setPhase(null);
      if (err instanceof ApiError) {
        setError({ message: err.payload.error, diagnostic: err.payload.diagnostic });
      } else {
        setError({ message: "An unexpected error occurred." });
      }
    }
  }

  const busy = phase !== null;

  return (
    <div className="page page-narrow">
      <div className="hero">
        <h1>Numismatic Archive</h1>
        <p>Paste a public Biddr or sixbid.com auction URL to build a permanent, searchable local catalogue of coins you're tracking.</p>
      </div>

      <div className="retrieve-card">
        <form className="retrieve-form" onSubmit={handleRetrieve}>
          <input
            type="url"
            placeholder="Paste a Biddr or sixbid.com auction URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Retrieve Auction
          </button>
        </form>

        {phase && (
          <div className="progress-panel">
            {phase.kind === "polling" && phase.currentPage !== null && phase.totalPages !== null ? (
              <>
                <div className="progress-status">
                  Fetching page {phase.currentPage} of {phase.totalPages}...
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.min(100, (phase.currentPage / phase.totalPages) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="progress-status">
                <span className="spinner" style={{ marginRight: 6 }} />
                {phase.kind === "starting" ? "Starting retrieval..." : "Connecting to source..."}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="error-banner">
            {error.message}
            {error.diagnostic && <div className="diagnostic">{JSON.stringify(error.diagnostic, null, 2)}</div>}
          </div>
        )}

        <div className="retrieve-alt">
          <span className="label">Automatic retrieval blocked, or working offline?</span>
          <button type="button" className="btn btn-sm" onClick={() => setImportOpen(true)}>
            Import Saved Page
          </button>
        </div>
      </div>

      {auctions.length > 0 && (
        <div className="recent-auctions">
          <h2>Archived auctions</h2>
          <div className="auction-row-list">
            {auctions.map((a) => (
              <Link key={a.id} to={`/auctions/${a.id}`} navigate={navigate} className="auction-row">
                <div>
                  <div className="auction-row-title">{a.title ?? `Auction #${a.id}`}</div>
                  <div className="auction-row-meta">
                    {a.auctionHouse ?? "Unknown house"} · {a.lotCount} lots{a.startDate ? ` · ${formatDate(a.startDate)}` : ""}
                  </div>
                </div>
                <span className={`badge badge-status-${a.status}`}>{a.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={(auctionId) => navigate(`/auctions/${auctionId}`)}
        />
      )}
    </div>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (auctionId: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importLocal(file, sourceUrl.trim());
      onImported(result.auctionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.payload.error : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import a saved page</h2>
        <p>
          Open the auction on biddr.com yourself, use your browser's "Save Page As... (Webpage,
          HTML only)", then attach the saved .html file here. It's parsed with the exact same
          pipeline as a live retrieval, with no network request to Biddr.
        </p>

        <div className="field">
          <label className="field-label">Original URL (optional, helps identify the auction)</label>
          <input type="url" placeholder="https://www.biddr.com/.../auction?a=..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </div>

        <div
          className={`dropzone ${dragging ? "active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
        >
          {file ? (
            <span>{file.name}</span>
          ) : (
            <span>
              Drag an .html file here, or{" "}
              <label style={{ textDecoration: "underline", cursor: "pointer" }}>
                browse
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  style={{ display: "none" }}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </span>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={!file || busy}>
            {busy ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
