-- Lets the client poll GET /api/acquisitions/:id for real page-by-page progress instead of a
-- client-side simulated stepper, since multi-page acquisitions (sixbid especially, rate-limited
-- at ~3s/page) can run well past what a fake progress animation should pretend to know.
ALTER TABLE acquisition_runs ADD COLUMN current_page INTEGER;
ALTER TABLE acquisition_runs ADD COLUMN total_pages INTEGER;
