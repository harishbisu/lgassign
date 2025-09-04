import { Controller, Get, Param } from '@nestjs/common';
import { EmailParseService } from './email-parse.service';

@Controller('emails')
export class EmailController {
  constructor(private readonly emailParseService: EmailParseService) {}

  @Get(':subject')
  async getEmailBySubject(@Param('subject') subject: string) {
    return this.emailParseService.getIntermediateServersBySubject(subject);
  }
}
