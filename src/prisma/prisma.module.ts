import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// PrismaService is a PrismaClient with its own connection pool. It must be
// provided only here: listing it in another module's providers creates an
// extra client (and pool) per module.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
