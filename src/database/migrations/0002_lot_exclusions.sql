-- Tracks lots the user deliberately pruned from an auction, keyed by Biddr's own lot_identifier
-- (stable across re-imports, unlike our internal autoincrement id). Refresh/Re-import consult this
-- so a deleted lot doesn't silently reappear the next time the source is re-parsed.
CREATE TABLE IF NOT EXISTS excluded_lots (
  auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  lot_identifier TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  PRIMARY KEY (auction_id, lot_identifier)
);
