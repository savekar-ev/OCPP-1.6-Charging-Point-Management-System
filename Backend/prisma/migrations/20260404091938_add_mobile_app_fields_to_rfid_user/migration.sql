-- AlterTable
ALTER TABLE "RfidUser" ADD COLUMN     "app_token_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin" TEXT;
