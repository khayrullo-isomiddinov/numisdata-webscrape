import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AuctionSummary } from "../api.ts";
import { Link } from "../router.tsx";
import { formatDate } from "../format.ts";

const STEPS = [
  "Validating URL",
  "Acquiring source",
  "Extracting auction metadata",
  "Extracting lots",
  "Saving to database",
  "Complete",
] as const;

type StepState = "pending" | "active" | "done" | "error";

export function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const [url, setUrl] = useState("");
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; diagnostic?: Record<string, unknown> } | null>(null);
  const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    api.listAuctions().then((r) => setAuctions(r.auctions)).catch(() => {});
  }, []);

  async function handleRetrieve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) return;

    setStepIndex(0);
    // Advance through the illustrative steps while the (synchronous) request is in flight -
    // the backend runs acquisition -> extraction -> persistence as one call, so this animates
    // progress rather than tracking literal server-side phase transitions.
    let step = 0;
    timerRef.current = window.setInterval(() => {
      step = Math.min(step + 1, STEPS.length - 2);
      setStepIndex(step);
    }, 900);

    try {
      const result = await api.retrieve(url.trim());
      if (timerRef.current) window.clearInterval(timerRef.current);
      setStepIndex(STEPS.length - 1);
      window.setTimeout(() => navigate(`/auctions/${result.auctionId}`), 400);
    } catch (err) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      setStepIndex(null);
      if (err instanceof ApiError) {
        setError({ message: err.payload.error, diagnostic: err.payload.diagnostic });
      } else {
        setError({ message: "An unexpected error occurred." });
      }
    }
  }

  return (
    <div className="page page-narrow">
      <div className="hero">
        <h1>Numismatic Archive</h1>
        <p>Paste a public Biddr auction URL to build a permanent, searchable local catalogue of coins you're tracking.</p>
      </div>

      <div className="retrieve-card">
        <form className="retrieve-form" onSubmit={handleRetrieve}>
          <input
            type="url"
            placeholder="Paste Biddr auction URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={stepIndex !== null}
          />
          <button type="submit" className="btn btn-primary" disabled={stepIndex !== null}>
            Retrieve Auction
          </button>
        </form>

        {stepIndex !== null && (
          <div className="status-stepper">
            {STEPS.map((label, i) => (
              <div key={label} className={`status-step ${i < stepIndex ? "done" : i === stepIndex ? "active" : ""}`}>
                <span className="status-dot" />
                {label}
                {i === stepIndex && i < STEPS.length - 1 && <span className="spinner" style={{ marginLeft: 4 }} />}
              </div>
            ))}
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
