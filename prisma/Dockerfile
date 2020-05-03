FROM node:12

# Install @prisma/cli for the migration
RUN npm install -g @prisma/cli --unsafe-perm

# Copy schema and migration folder
COPY schema.prisma /schema.prisma
COPY migrations/ /migrations/

CMD [ "prisma", "migrate", "up", "-c", "--experimental"]