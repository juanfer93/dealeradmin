import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { MonthlyReportsConfig } from '@dealeradmin/config';

export type ReportMail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer };
};

export interface ReportMailer {
  send(message: ReportMail): Promise<{ messageId?: string }>;
}

type MailSocket = net.Socket | tls.TLSSocket;

function responseError(response: string): Error {
  const code = response.slice(0, 3);
  return new Error(`SMTP server rejected command (${code}).`);
}

function readResponse(socket: MailSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => finish(new Error('SMTP server response timed out.')), 30000);
    const onData = (chunk: Buffer | string) => {
      data += chunk.toString();
      const lines = data.split('\r\n');
      const finalLine = lines.find((line) => /^\d{3} /.test(line));
      if (finalLine) finish(undefined, data);
    };
    const onError = () => finish(new Error('SMTP connection failed.'));
    const finish = (error?: Error, response?: string) => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) reject(error);
      else resolve(response ?? data);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function command(socket: MailSocket, value: string): Promise<string> {
  socket.write(`${value}\r\n`);
  const response = await readResponse(socket);
  if (/^[45]\d\d /.test(response.split('\r\n').find((line) => /^\d{3} /.test(line)) ?? '')) {
    throw responseError(response);
  }
  return response;
}

function encodedHeader(value: string): string {
  return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=` : value;
}

function encodeAttachment(content: Buffer): string {
  return content.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export class SmtpReportMailer implements ReportMailer {
  constructor(private readonly config: MonthlyReportsConfig) {}

  async send(message: ReportMail): Promise<{ messageId: string }> {
    let socket = await this.connect();
    try {
      await readResponse(socket);
      await command(socket, `EHLO dealeradmin`);
      if (!this.config.smtpSecure) {
        await command(socket, 'STARTTLS');
        socket = await this.upgradeToTls(socket);
        await command(socket, 'EHLO dealeradmin');
      }
      await command(socket, 'AUTH LOGIN');
      await command(socket, Buffer.from(this.config.smtpUser, 'utf8').toString('base64'));
      await command(socket, Buffer.from(this.config.smtpPassword, 'utf8').toString('base64'));
      await command(socket, `MAIL FROM:<${message.from}>`);
      for (const recipient of message.to) await command(socket, `RCPT TO:<${recipient}>`);
      await command(socket, 'DATA');
      const boundary = `dealeradmin-${randomUUID()}`;
      const payload = [
        `From: ${message.from}`,
        `To: ${message.to.join(', ')}`,
        `Subject: ${encodedHeader(message.subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        message.text,
        '',
        `--${boundary}`,
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${message.attachment.filename}"`,
        '',
        encodeAttachment(message.attachment.content),
        `--${boundary}--`,
        '',
      ].join('\r\n').replace(/^\./gm, '..');
      socket.write(`${payload}\r\n.\r\n`);
      await readResponse(socket);
      const messageId = `<${randomUUID()}@dealeradmin>`;
      await command(socket, 'QUIT').catch(() => undefined);
      return { messageId };
    } finally {
      socket.destroy();
    }
  }

  private connect(): Promise<MailSocket> {
    return new Promise((resolve, reject) => {
      const socket = this.config.smtpSecure
        ? tls.connect({ host: this.config.smtpHost, port: this.config.smtpPort, servername: this.config.smtpHost })
        : net.createConnection({ host: this.config.smtpHost, port: this.config.smtpPort });
      const connected = () => resolve(socket);
      socket.once(this.config.smtpSecure ? 'secureConnect' : 'connect', connected);
      socket.once('error', () => reject(new Error('SMTP connection failed.')));
      socket.setTimeout(30000, () => socket.destroy(new Error('SMTP connection timed out.')));
    });
  }

  private upgradeToTls(socket: MailSocket): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const secureSocket = tls.connect({ socket, host: this.config.smtpHost, servername: this.config.smtpHost });
      secureSocket.once('secureConnect', () => resolve(secureSocket));
      secureSocket.once('error', () => reject(new Error('SMTP TLS negotiation failed.')));
    });
  }
}
