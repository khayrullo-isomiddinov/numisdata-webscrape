import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AuctionDetail, type Facets, type LotSummary } from "../api.ts";
import { LotCard } from "../components/LotCard.tsx";
import { ConfirmModal } from "../components/ConfirmModal.tsx";
import { formatDate, formatDateTime } from "../format.ts";

const FACET_LABELS: Record<keyof Facets, string> = {
  category: "Category",
  material: "Material",
  mint: "Mint",
  ruler: "Ruler / Issuer",
  denomination: "Denomination",
};

export function AuctionPage({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const [auction, setAuction] = useState<AuctionDetail | null>(null);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState("lot_asc");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busyAction, setBusyAction] = useState<"refresh" | "reimport" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Lot curation: everything starts selected (kept) - the user unchecks what they don't want,
  // then confirms to delete just the unchecked lots. Scoped to whatever the current filters show.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmingArchiveDelete, setConfirmingArchiveDelete] = useState(false);
  const [archiveDeleteBusy, setArchiveDeleteBusy] = useState(false);
  const [archiveDeleteError, setArchiveDeleteError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await api.getAuction(Number(id), { ...filters, sort });
      setAuction(result.auction);
      setLots(result.lots);
      setFacets(result.facets);
      setSelected(new Set(result.lots.map((l) => l.id)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, JSON.stringify(filters), sort]);

  const allSelected = lots.length > 0 && selected.size === lots.length;
  const someSelected = selected.size > 0 && selected.size < lots.length;
  const deselectedCount = lots.length - selected.size;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleSelected(lotId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(lots.map((l) => l.id)));
  }

  async function runAction(action: "refresh" | "reimport") {
    setBusyAction(action);
    setActionError(null);
    try {
      if (action === "refresh") await api.refreshAuction(Number(id));
      else await api.reimportAuction(Number(id));
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.payload.error : "Action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmDelete() {
    const idsToDelete = lots.filter((l) => !selected.has(l.id)).map((l) => l.id);
    setDeleteBusy(true);
    setActionError(null);
    try {
      await api.deleteLots(Number(id), idsToDelete);
      setConfirmingDelete(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.payload.error : "Could not delete lots.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleConfirmArchiveDelete() {
    setArchiveDeleteBusy(true);
    setArchiveDeleteError(null);
    try {
      await api.deleteAuction(Number(id));
      navigate("/");
    } catch (err) {
      setArchiveDeleteError(err instanceof ApiError ? err.payload.error : "Could not delete this archive.");
    } finally {
      setArchiveDeleteBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="page empty-state">
        <p>Auction not found.</p>
      </div>
    );
  }

  if (loading && !auction) {
    return (
      <div className="page-loading">
        <span className="spinner" /> Loading auction...
      </div>
    );
  }

  if (!auction) return null;

  return (
    <div className="page">
      <div className="auction-header">
        <div className="auction-header-top">
          <div>
            <div className="auction-header-house">{auction.auctionHouse ?? "Unknown auction house"}</div>
            <h1>{auction.title ?? `Auction #${auction.id}`}</h1>
            {auction.description && <div className="auction-header-desc">{auction.description}</div>}
          </div>
          <div className="auction-header-actions">
            <button className="btn btn-sm" onClick={() => runAction("refresh")} disabled={busyAction !== null}>
              {busyAction === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
            <button className="btn btn-sm" onClick={() => runAction("reimport")} disabled={busyAction !== null}>
              {busyAction === "reimport" ? "Re-importing..." : "Re-import source"}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmingArchiveDelete(true)}>
              Delete Archive
            </button>
          </div>
        </div>

        <div className="auction-header-meta">
          <span className={`badge badge-status-${auction.status}`}>{auction.status}</span>
          {auction.auctionNumber && <span className="meta-badge">Auction {auction.auctionNumber}</span>}
          {auction.startDate && <span className="meta-badge">{formatDate(auction.startDate)}</span>}
          {auction.location && <span className="meta-badge">{auction.location}</span>}
          <span className="meta-badge">{auction.lotCount} lots</span>
        </div>

        {actionError && <div className="error-banner">{actionError}</div>}

        <div className="auction-header-foot">
          <span>
            Imported {formatDateTime(auction.importedAt)} via {auction.acquisitionMethod} · last updated {formatDateTime(auction.updatedAt)}
          </span>
          <a href={auction.sourceUrl} target="_blank" rel="noreferrer">
            View original listing ↗
          </a>
        </div>
      </div>

      {facets && (
        <div className="filter-bar">
          {(Object.keys(FACET_LABELS) as (keyof Facets)[]).map((key) =>
            facets[key].length > 0 ? (
              <select
                key={key}
                value={filters[key] ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
              >
                <option value="">{FACET_LABELS[key]}: All</option>
                {facets[key].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : null,
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="lot_asc">Lot number ascending</option>
            <option value="lot_desc">Lot number descending</option>
            <option value="price_asc">Price ascending</option>
            <option value="price_desc">Price descending</option>
          </select>
          {Object.values(filters).some(Boolean) && (
            <button className="btn btn-quiet btn-sm" onClick={() => setFilters({})}>
              Clear filters
            </button>
          )}
          <span className="filter-count">{lots.length} lots shown</span>
        </div>
      )}

      {lots.length === 0 ? (
        <div className="empty-state">No lots match the current filters.</div>
      ) : (
        <>
          <div className="selection-bar">
            <label className="selection-bar-label">
              <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              Select all
              <span className="selection-bar-count">
                {selected.size} of {lots.length} kept
              </span>
            </label>
            <div className="selection-bar-actions">
              <button className="btn btn-danger btn-sm" disabled={deselectedCount === 0} onClick={() => setConfirmingDelete(true)}>
                {deselectedCount === 0 ? "Keep Selected, Delete Rest" : `Delete ${deselectedCount} Unselected Lot${deselectedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div className="lot-grid">
            {lots.map((lot) => (
              <LotCard key={lot.id} lot={lot} navigate={navigate} selected={selected.has(lot.id)} onToggleSelected={toggleSelected} />
            ))}
          </div>
        </>
      )}

      {confirmingDelete && (
        <ConfirmModal
          title="Delete unselected lots?"
          message={`This permanently removes ${deselectedCount} lot${deselectedCount === 1 ? "" : "s"} (and their images) from this auction's archive, and keeps them excluded even if you Refresh or Re-import this auction later. This cannot be undone from within the app.`}
          confirmLabel={`Delete ${deselectedCount} Lot${deselectedCount === 1 ? "" : "s"}`}
          danger
          busy={deleteBusy}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {confirmingArchiveDelete && (
        <ConfirmModal
          title="Delete archive?"
          message={`This permanently deletes "${auction.title ?? `Auction #${auction.id}`}" from the database, along with every saved page snapshot and downloaded image. This can't be undone.`}
          confirmLabel="Delete Permanently"
          danger
          busy={archiveDeleteBusy}
          error={archiveDeleteError}
          onConfirm={handleConfirmArchiveDelete}
          onCancel={() => {
            if (archiveDeleteBusy) return;
            setConfirmingArchiveDelete(false);
            setArchiveDeleteError(null);
          }}
        />
      )}
    </div>
  );
}
