import { Module } from '@nestjs/common';
import { EmailParseService } from './email-parse.service';
import { EmailController } from './email-parse.controller';

@Module({
  controllers: [EmailController],
  providers: [EmailParseService],
  exports: [],
})
export class EmailModule {}
