-- Phase 3 CRM Migration (via db push, captured diff)
-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('NEW', 'LEAD', 'ACTIVE', 'CUSTOMER', 'VIP', 'INACTIVE', 'BLOCKED');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST', 'CLOSED');
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "FollowUpType" AS ENUM ('CALL', 'MESSAGE', 'VISIT', 'EMAIL', 'OTHER');
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "IdentityChannel" AS ENUM ('PHONE', 'TELEGRAM', 'INSTAGRAM', 'BASALAM', 'WEBSITE', 'EMAIL');
ALTER TYPE "Source" ADD VALUE 'OTHER';
-- AlterTable customers
ALTER TABLE "customers" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "normalizedPhone" TEXT,
ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'NEW';
-- AlterTable messages
ALTER TABLE "messages" ADD COLUMN "externalMessageId" TEXT,
ADD COLUMN "metadata" JSONB,
ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN "text" TEXT;
-- CreateTable customer_identities
CREATE TABLE "customer_identities" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "IdentityChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id")
);
-- CreateTable tags
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#3b82f6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);
-- CreateTable customer_tags
CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);
-- CreateTable customer_notes
CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);
-- CreateTable customer_timelines
CREATE TABLE "customer_timelines" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_timelines_pkey" PRIMARY KEY ("id")
);
-- CreateTable leads
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "score" INTEGER NOT NULL DEFAULT 0,
    "intent" TEXT,
    "interestedProductId" TEXT,
    "estimatedValue" DECIMAL(12,2),
    "assignedToId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);
-- CreateTable follow_ups
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" "FollowUpType" NOT NULL DEFAULT 'MESSAGE',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "reason" TEXT,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);
-- Indexes
CREATE INDEX "customer_identities_customerId_idx" ON "customer_identities"("customerId");
CREATE INDEX "customer_identities_channel_idx" ON "customer_identities"("channel");
CREATE UNIQUE INDEX "customer_identities_channel_externalId_key" ON "customer_identities"("channel", "externalId");
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");
CREATE INDEX "customer_tags_customerId_idx" ON "customer_tags"("customerId");
CREATE INDEX "customer_tags_tagId_idx" ON "customer_tags"("tagId");
CREATE UNIQUE INDEX "customer_tags_customerId_tagId_key" ON "customer_tags"("customerId", "tagId");
CREATE INDEX "customer_notes_customerId_idx" ON "customer_notes"("customerId");
CREATE INDEX "customer_notes_authorId_idx" ON "customer_notes"("authorId");
CREATE INDEX "customer_timelines_customerId_idx" ON "customer_timelines"("customerId");
CREATE INDEX "customer_timelines_eventType_idx" ON "customer_timelines"("eventType");
CREATE INDEX "customer_timelines_createdAt_idx" ON "customer_timelines"("createdAt");
CREATE INDEX "leads_customerId_idx" ON "leads"("customerId");
CREATE INDEX "leads_status_idx" ON "leads"("status");
CREATE INDEX "leads_score_idx" ON "leads"("score");
CREATE INDEX "leads_assignedToId_idx" ON "leads"("assignedToId");
CREATE INDEX "follow_ups_customerId_idx" ON "follow_ups"("customerId");
CREATE INDEX "follow_ups_leadId_idx" ON "follow_ups"("leadId");
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");
CREATE INDEX "follow_ups_scheduledAt_idx" ON "follow_ups"("scheduledAt");
CREATE UNIQUE INDEX "customers_normalizedPhone_key" ON "customers"("normalizedPhone");
CREATE INDEX "customers_normalizedPhone_idx" ON "customers"("normalizedPhone");
CREATE INDEX "customers_status_idx" ON "customers"("status");
CREATE INDEX "customers_lastSeenAt_idx" ON "customers"("lastSeenAt");
CREATE INDEX "messages_channel_idx" ON "messages"("channel");
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");
-- Foreign Keys
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_timelines" ADD CONSTRAINT "customer_timelines_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_interestedProductId_fkey" FOREIGN KEY ("interestedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
