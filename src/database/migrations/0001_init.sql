-- Initial schema for the Biddr archive.

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  auction_identifier TEXT NOT NULL,
  auction_house TEXT,
  title TEXT,
  auction_number TEXT,
  description TEXT,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  lot_count INTEGER,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acquisition_method TEXT NOT NULL,
  raw_source_path TEXT,
  raw_data_json TEXT,
  UNIQUE (source_domain, auction_identifier)
);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  source_url TEXT,
  lot_identifier TEXT NOT NULL,
  lot_number TEXT,
  title TEXT,
  description TEXT,
  description_html TEXT,
  category TEXT,
  estimate_low REAL,
  estimate_high REAL,
  starting_price REAL,
  realized_price REAL,
  currency TEXT,
  weight TEXT,
  diameter TEXT,
  material TEXT,
  mint TEXT,
  ruler TEXT,
  denomination TEXT,
  date_period TEXT,
  condition TEXT,
  reference_number TEXT,
  detail_fetched INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_data_json TEXT,
  UNIQUE (lot_identifier)
);

CREATE INDEX IF NOT EXISTS idx_lots_auction_id ON lots(auction_id);
CREATE INDEX IF NOT EXISTS idx_lots_category ON lots(category);
CREATE INDEX IF NOT EXISTS idx_lots_mint ON lots(mint);
CREATE INDEX IF NOT EXISTS idx_lots_ruler ON lots(ruler);
CREATE INDEX IF NOT EXISTS idx_lots_material ON lots(material);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  local_path TEXT,
  image_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  downloaded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_images_lot_id ON images(lot_id);

CREATE TABLE IF NOT EXISTS acquisition_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  acquisition_method TEXT NOT NULL,
  error_message TEXT,
  raw_file_path TEXT,
  auction_id INTEGER REFERENCES auctions(id) ON DELETE SET NULL
);

-- Full text search over lots. content='' (external content) keeps it in sync via triggers below,
-- referencing the lots table by rowid.
CREATE VIRTUAL TABLE IF NOT EXISTS lots_fts USING fts5(
  title,
  description,
  category,
  mint,
  ruler,
  denomination,
  material,
  reference_number,
  content='lots',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS lots_ai AFTER INSERT ON lots BEGIN
  INSERT INTO lots_fts(rowid, title, description, category, mint, ruler, denomination, material, reference_number)
  VALUES (new.id, new.title, new.description, new.category, new.mint, new.ruler, new.denomination, new.material, new.reference_number);
END;

CREATE TRIGGER IF NOT EXISTS lots_ad AFTER DELETE ON lots BEGIN
  INSERT INTO lots_fts(lots_fts, rowid, title, description, category, mint, ruler, denomination, material, reference_number)
  VALUES ('delete', old.id, old.title, old.description, old.category, old.mint, old.ruler, old.denomination, old.material, old.reference_number);
END;

CREATE TRIGGER IF NOT EXISTS lots_au AFTER UPDATE ON lots BEGIN
  INSERT INTO lots_fts(lots_fts, rowid, title, description, category, mint, ruler, denomination, material, reference_number)
  VALUES ('delete', old.id, old.title, old.description, old.category, old.mint, old.ruler, old.denomination, old.material, old.reference_number);
  INSERT INTO lots_fts(rowid, title, description, category, mint, ruler, denomination, material, reference_number)
  VALUES (new.id, new.title, new.description, new.category, new.mint, new.ruler, new.denomination, new.material, new.reference_number);
END;
