-- Add pg_trgm for performant ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_normalized_trgm_idx ON "customers" USING gin ("normalizedPhone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm_idx ON customers USING gin (email gin_trgm_ops);
