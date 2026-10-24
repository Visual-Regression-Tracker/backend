-- CreateTable
CREATE TABLE "_UserFavoriteProjects" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserFavoriteProjects_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserFavoriteProjects_B_index" ON "_UserFavoriteProjects"("B");

-- AddForeignKey
ALTER TABLE "_UserFavoriteProjects" ADD CONSTRAINT "_UserFavoriteProjects_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserFavoriteProjects" ADD CONSTRAINT "_UserFavoriteProjects_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
