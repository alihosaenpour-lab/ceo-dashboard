-- DropIndex
DROP INDEX "customers_email_trgm_idx";

-- DropIndex
DROP INDEX "customers_name_trgm_idx";

-- DropIndex
DROP INDEX "customers_normalized_trgm_idx";

-- DropIndex
DROP INDEX "customers_phone_trgm_idx";

-- CreateTable
CREATE TABLE "human_reviews" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "externalId" TEXT,
    "payload" JSONB,
    "inputTitle" TEXT,
    "normalizedTitle" TEXT,
    "matchedProductId" TEXT,
    "method" TEXT,
    "reason" TEXT,
    "requestId" TEXT,
    "inventoryProductId" TEXT,
    "requestedQty" INTEGER,
    "availableQty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "orderId" TEXT,

    CONSTRAINT "human_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "human_reviews_status_idx" ON "human_reviews"("status");

-- CreateIndex
CREATE INDEX "human_reviews_type_idx" ON "human_reviews"("type");

-- CreateIndex
CREATE INDEX "human_reviews_provider_idx" ON "human_reviews"("provider");

-- CreateIndex
CREATE INDEX "human_reviews_createdAt_idx" ON "human_reviews"("createdAt");

-- AddForeignKey
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
