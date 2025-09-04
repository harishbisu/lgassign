import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

@Injectable()
export class EmailParseService implements OnModuleDestroy {
  private client: ImapFlow;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: 'harishbisu94@gmail.com',
        pass: process.env.APP_PASS,
      },
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.connect();
    await this.connectionPromise;
    this.connectionPromise = null;
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;

      this.client.on('close', () => {
        this.isConnected = false;
      });

      this.client.on('error', (error) => {
        console.error('IMAP client error:', error);
        this.isConnected = false;
      });
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  async getIntermediateServersBySubject(subject: string) {
    try {
      await this.ensureConnected();
      await this.client.mailboxOpen('INBOX');

      const searchResult = await this.client.search({ subject });

      if (
        !searchResult ||
        !Array.isArray(searchResult) ||
        searchResult.length === 0
      ) {
        return [];
      }

      const seq = searchResult[searchResult.length - 1];
      const message = (await this.client.fetchOne(seq, {
        source: true,
        headers: true,
      })) as any;

      if (!message || message === false || !message.headers) {
        return [];
      }

      const headersText = message.headers.toString();
      const fromEmail = this.parseHeaderField(headersText, 'From') ?? '';
      const toEmail = this.parseHeaderField(headersText, 'To') ?? '';
      const servers = this.extractRouteServers(headersText);
      console.log('\n', headersText, '\n');
      return {
        fromEmail: fromEmail,
        toEmail: toEmail,
        servers: servers,
        ESP: this.detectESP(headersText),
      };
    } catch (error) {
      console.error('Error fetching intermediate servers:', error);
      this.isConnected = false;
      throw error;
    }
  }
  private parseHeaderField(headersText: string, field: string): string | null {
    const regex = new RegExp(`^${field}: (.+)$`, 'im');
    const match = headersText.match(regex);
    if (!match) return null;

    return match[1];
  }
  private detectESP(headersText: string): string {
    const returnPath = this.parseHeaderField(headersText, 'Return-Path');
    if (returnPath) {
      if (/amazonses\.com/i.test(returnPath)) return 'Amazon SES';
      if (/sendgrid\.net/i.test(returnPath)) return 'SendGrid';
      if (/mailgun\.org/i.test(returnPath)) return 'Mailgun';
      if (/zoho\.com/i.test(returnPath)) return 'Zoho Mail';
    }

    const dkimMatch = headersText.match(/dkim-signature:.*\bd=([^;\s]+)/i);
    if (dkimMatch) {
      const d = dkimMatch[1].toLowerCase();
      if (d.includes('amazonses')) return 'Amazon SES';
      if (d.includes('sendgrid')) return 'SendGrid';
      if (d.includes('mailgun')) return 'Mailgun';
      if (d.includes('zoho')) return 'Zoho Mail';
      if (d.includes('google')) return 'Gmail / Google Workspace';
      if (d.includes('outlook') || d.includes('microsoft'))
        return 'Outlook / Office365';
    }
    if (/smtp-out\.amazonses\.com/i.test(headersText)) return 'Amazon SES';
    if (
      /outlook\.com|office365\.com|protection\.outlook\.com/i.test(headersText)
    )
      return 'Outlook / Office365';
    if (/google\.com/i.test(headersText)) return 'Gmail / Google Workspace';
    if (/zoho\.com/i.test(headersText)) return 'Zoho Mail';

    return 'Unknown';
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      try {
        await this.client.logout();
      } catch (error) {
        console.warn('Error during logout:', error);
      }
    }
  }

  private extractRouteServers(headersText: string): string[] {
    const blocks = this.extractReceivedBlocks(headersText);
    if (blocks.length === 0) return [];

    const pairs = blocks.map((h) => this.parseReceived(h)).reverse();

    const path: string[] = [];
    const pushUnique = (label: string) => {
      if (!label) return;
      if (path[path.length - 1] !== label) path.push(label);
    };

    if (pairs[0]?.from) pushUnique(this.normalizeHost(pairs[0].from));

    for (const p of pairs) {
      if (p.by) pushUnique(this.normalizeHost(p.by));
    }
    return path;
  }

  private extractReceivedBlocks(headersText: string): string[] {
    const lines = headersText.split(/\r?\n/);
    const blocks: string[] = [];
    let current: string | null = null;

    for (const line of lines) {
      if (/^Received:/i.test(line)) {
        if (current) blocks.push(current.trim());
        current = line.trim();
      } else if (/^\s/.test(line) && current) {
        current += ' ' + line.trim();
      } else if (current) {
        blocks.push(current.trim());
        current = null;
      }
    }
    if (current) blocks.push(current.trim());
    return blocks;
  }
  private parseReceived(receivedHeader: string): {
    from?: string;
    by?: string;
  } {
    const fromMatch = receivedHeader.match(/\bfrom\s+([^\s(;\[]+)/i);
    const byMatch = receivedHeader.match(/\bby\s+([^\s(;\[]+)/i);
    return {
      from: fromMatch?.[1],
      by: byMatch?.[1],
    };
  }

  private normalizeHost(host: string): string {
    let h = host.trim();
    h = h.replace(/[;.,]+$/g, '');
    h = h.replace(/^\[|\]$/g, '');
    h = h.replace(/\.$/, '');
    return h;
  }
}
