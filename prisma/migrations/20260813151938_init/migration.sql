-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MEMBER', 'GUILD_MASTER');

-- CreateEnum
CREATE TYPE "QuestType" AS ENUM ('HELP', 'BARTER');

-- CreateEnum
CREATE TYPE "QuestCategory" AS ENUM ('DEV', 'DESIGN', 'COURSES', 'MATERIAL', 'STUDENT_LIFE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'VALIDATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Adventurer" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "helpPoints" INTEGER NOT NULL DEFAULT 100,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "memberSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adventurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "QuestType" NOT NULL,
    "category" "QuestCategory" NOT NULL,
    "status" "QuestStatus" NOT NULL DEFAULT 'OPEN',
    "reward" INTEGER NOT NULL,
    "photoUrl" TEXT,
    "authorId" TEXT NOT NULL,
    "takerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "BadgeAward" (
    "adventurerId" TEXT NOT NULL,
    "badgeCode" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("adventurerId","badgeCode")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adventurerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Adventurer_username_key" ON "Adventurer"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Adventurer_email_key" ON "Adventurer"("email");

-- CreateIndex
CREATE INDEX "Quest_status_createdAt_idx" ON "Quest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Quest_authorId_idx" ON "Quest"("authorId");

-- CreateIndex
CREATE INDEX "Quest_takerId_idx" ON "Quest"("takerId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_adventurerId_idx" ON "RefreshToken"("adventurerId");

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Adventurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_takerId_fkey" FOREIGN KEY ("takerId") REFERENCES "Adventurer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_adventurerId_fkey" FOREIGN KEY ("adventurerId") REFERENCES "Adventurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_badgeCode_fkey" FOREIGN KEY ("badgeCode") REFERENCES "Badge"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_adventurerId_fkey" FOREIGN KEY ("adventurerId") REFERENCES "Adventurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
