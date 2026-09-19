-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('TELEGRAM', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'BASALAM', 'WEBSITE', 'AI', 'OTHER');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTING', 'CONNECTED', 'TOKEN_EXPIRED', 'INVALID_CREDENTIALS', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AgentAction" AS ENUM ('READ', 'SEND', 'REPLY', 'CREATE_DRAFT', 'PUBLISH', 'EDIT', 'DELETE', 'ANALYZE', 'SEARCH', 'FETCH_ACCOUNT', 'MANAGE_WEBHOOK', 'MANAGE_CREDENTIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'OPERATOR';
ALTER TYPE "Role" ADD VALUE 'VIEWER';
ALTER TYPE "Role" ADD VALUE 'AGENT';

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "displayName" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentialsEncrypted" TEXT,
    "credentialsMasked" JSONB,
    "config" JSONB,
    "webhookUrl" TEXT,
    "webhookSecretEncrypted" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_accounts" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "type" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEncrypted" TEXT,
    "metadata" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_permissions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "integrationId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "action" "AgentAction" NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "url" TEXT NOT NULL,
    "providerUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "productId" TEXT,
    "uploadedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_key" ON "integrations"("provider");

-- CreateIndex
CREATE INDEX "integrations_provider_idx" ON "integrations"("provider");

-- CreateIndex
CREATE INDEX "integrations_status_idx" ON "integrations"("status");

-- CreateIndex
CREATE INDEX "integration_accounts_integrationId_idx" ON "integration_accounts"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_accounts_integrationId_externalId_key" ON "integration_accounts"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "agent_permissions_agentId_idx" ON "agent_permissions"("agentId");

-- CreateIndex
CREATE INDEX "agent_permissions_provider_idx" ON "agent_permissions"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "agent_permissions_agentId_provider_action_key" ON "agent_permissions"("agentId", "provider", "action");

-- CreateIndex
CREATE INDEX "media_assets_category_idx" ON "media_assets"("category");

-- CreateIndex
CREATE INDEX "media_assets_createdAt_idx" ON "media_assets"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_key_key" ON "prompt_templates"("key");

-- CreateIndex
CREATE INDEX "prompt_templates_category_idx" ON "prompt_templates"("category");

-- CreateIndex
CREATE INDEX "prompt_templates_isActive_idx" ON "prompt_templates"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "business_settings_key_key" ON "business_settings"("key");

-- CreateIndex
CREATE INDEX "business_settings_category_idx" ON "business_settings"("category");

-- AddForeignKey
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
