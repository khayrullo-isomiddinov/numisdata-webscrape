import { Link } from "../router.tsx";
import type { LotSummary } from "../api.ts";
import { formatEstimate, formatPrice } from "../format.ts";

export function LotCard({
  lot,
  navigate,
  selected,
  onToggleSelected,
}: {
  lot: LotSummary;
  navigate: (path: string) => void;
  selected: boolean;
  onToggleSelected: (lotId: number) => void;
}) {
  const priceLabel = lot.realizedPrice !== null ? "Realized" : lot.startingPrice !== null ? "Starting price" : "Estimate";
  const priceValue =
    lot.realizedPrice !== null
      ? formatPrice(lot.realizedPrice, lot.currency)
      : lot.startingPrice !== null
        ? formatPrice(lot.startingPrice, lot.currency)
        : formatEstimate(lot.estimateLow, lot.estimateHigh, lot.currency);

  return (
    <div className={`lot-card-wrapper ${selected ? "" : "deselected"}`}>
      <label
        className="lot-card-select"
        onClick={(e) => e.stopPropagation()}
        aria-label={selected ? `Deselect lot ${lot.lotNumber}` : `Select lot ${lot.lotNumber}`}
      >
        <input type="checkbox" checked={selected} onChange={() => onToggleSelected(lot.id)} />
      </label>
      <Link to={`/lots/${lot.id}`} navigate={navigate} className="lot-card">
        <div className="lot-card-image">
          {lot.thumbnailUrl ? <img src={lot.thumbnailUrl} alt={lot.title ?? `Lot ${lot.lotNumber}`} loading="lazy" /> : <span className="placeholder">No image</span>}
        </div>
        <div className="lot-card-body">
          <div className="lot-card-number">Lot {lot.lotNumber ?? "—"}</div>
          <h3 className="lot-card-title">{lot.title ?? "Untitled lot"}</h3>
          <div className="lot-card-badges">
            {lot.material && <span className="meta-badge">{lot.material}</span>}
            {lot.denomination && <span className="meta-badge">{lot.denomination}</span>}
            {lot.mint && <span className="meta-badge">{lot.mint}</span>}
            {lot.ruler && <span className="meta-badge">{lot.ruler}</span>}
          </div>
          {priceValue && (
            <div className="lot-card-price">
              <span className="label">{priceLabel}</span>
              <span className="value">{priceValue}</span>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
