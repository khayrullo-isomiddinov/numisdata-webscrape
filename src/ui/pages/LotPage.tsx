import { Fragment, useEffect, useState } from "react";
import { api, ApiError, type LotDetail, type LotImageDto } from "../api.ts";
import { Link } from "../router.tsx";
import { formatEstimate, formatPrice } from "../format.ts";

const SPEC_FIELDS: Array<{ key: keyof LotDetail; label: string }> = [
  { key: "weight", label: "Weight" },
  { key: "diameter", label: "Diameter" },
  { key: "material", label: "Material" },
  { key: "mint", label: "Mint" },
  { key: "ruler", label: "Ruler / Issuer" },
  { key: "denomination", label: "Denomination" },
  { key: "datePeriod", label: "Date / Period" },
  { key: "condition", label: "Condition" },
  { key: "referenceNumber", label: "Reference" },
  { key: "category", label: "Category" },
];

export function LotPage({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [images, setImages] = useState<LotImageDto[]>([]);
  const [auction, setAuction] = useState<{ id: number; title: string | null; auctionHouse: string | null } | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [detailNote, setDetailNote] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setActiveImage(0);
    api
      .getLot(Number(id))
      .then((result) => {
        setLot(result.lot);
        setImages(result.images);
        setAuction(result.auction);
        setDetailNote(result.detailFetchError);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDownloadImage(imageId: number) {
    if (!lot) return;
    setDownloadBusy(imageId);
    try {
      await api.downloadImage(lot.id, imageId);
      const refreshed = await api.getLot(lot.id);
      setImages(refreshed.images);
    } finally {
      setDownloadBusy(null);
    }
  }

  if (notFound) {
    return (
      <div className="page empty-state">
        <p>Lot not found.</p>
      </div>
    );
  }

  if (loading || !lot) {
    return (
      <div className="page-loading">
        <span className="spinner" /> Loading lot...
      </div>
    );
  }

  const mainImage = images[activeImage];
  const priceValue = lot.realizedPrice !== null ? formatPrice(lot.realizedPrice, lot.currency) : null;
  const startingValue = lot.startingPrice !== null ? formatPrice(lot.startingPrice, lot.currency) : null;
  const estimateValue = formatEstimate(lot.estimateLow, lot.estimateHigh, lot.currency);

  return (
    <div className="page">
      <div className="lot-detail-breadcrumb">
        {auction && (
          <Link to={`/auctions/${auction.id}`} navigate={navigate}>
            ← {auction.title ?? `Auction #${auction.id}`}
          </Link>
        )}
      </div>

      <div className="lot-detail">
        <div>
          <div className="lot-detail-image-main">
            {mainImage ? (
              <img src={mainImage.localPath ?? mainImage.sourceUrl} alt={lot.title ?? `Lot ${lot.lotNumber}`} />
            ) : (
              <span className="placeholder">No image available</span>
            )}
          </div>
          {images.length > 1 && (
            <div className="lot-detail-thumbs">
              {images.map((img, i) => (
                <button key={img.id} className={i === activeImage ? "active" : ""} onClick={() => setActiveImage(i)}>
                  <img src={img.localPath ?? img.sourceUrl} alt="" />
                </button>
              ))}
            </div>
          )}
          {mainImage && !mainImage.localPath && (
            <div className="image-download-note">
              Displaying remotely from Biddr.{" "}
              <button
                className="btn btn-quiet btn-sm"
                style={{ padding: 0, textDecoration: "underline" }}
                onClick={() => handleDownloadImage(mainImage.id)}
                disabled={downloadBusy === mainImage.id}
              >
                {downloadBusy === mainImage.id ? "Downloading..." : "Download a local copy"}
              </button>
            </div>
          )}
        </div>

        <div>
          <div className="lot-detail-number">Lot {lot.lotNumber ?? "—"}</div>
          <h1>{lot.title ?? "Untitled lot"}</h1>

          <div className="lot-detail-section price-panel">
            {startingValue && (
              <div className="price-row">
                <span className="label">Starting price</span>
                <span className="value">{startingValue}</span>
              </div>
            )}
            {estimateValue && (
              <div className="price-row">
                <span className="label">Estimate</span>
                <span className="value">{estimateValue}</span>
              </div>
            )}
            {priceValue && (
              <div className="price-row realized">
                <span className="label">Realized</span>
                <span className="value">{priceValue}</span>
              </div>
            )}
            {!startingValue && !estimateValue && !priceValue && <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No pricing information available.</span>}
          </div>

          {lot.description && (
            <div className="lot-detail-section">
              <h3>Description</h3>
              {lot.descriptionHtml ? (
                <div className="lot-detail-description" dangerouslySetInnerHTML={{ __html: lot.descriptionHtml }} />
              ) : (
                <div className="lot-detail-description">
                  {lot.description.split("\n").map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="lot-detail-section">
            <h3>References / Metadata</h3>
            <dl className="spec-table">
              {SPEC_FIELDS.filter((f) => lot[f.key]).map((f) => (
                <Fragment key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{String(lot[f.key])}</dd>
                </Fragment>
              ))}
              {SPEC_FIELDS.every((f) => !lot[f.key]) && <dd style={{ color: "var(--muted)" }}>No structured metadata was recognized for this lot.</dd>}
            </dl>
          </div>

          {!lot.detailFetched && detailNote && (
            <div className="error-banner" style={{ marginTop: "1.5rem" }}>
              Full lot detail could not be fetched ({detailNote}). Showing information from the auction listing only.
            </div>
          )}

          {lot.sourceUrl && (
            <div className="lot-detail-section">
              <a href={lot.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                View original lot on Biddr ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
