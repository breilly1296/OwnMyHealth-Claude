/**
 * Type declarations for @sendgrid/mail
 *
 * SendGrid provides its own types, but this declaration
 * ensures TypeScript recognizes the module structure.
 */

declare module '@sendgrid/mail' {
  interface MailDataRequired {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    text?: string;
    html?: string;
    templateId?: string;
    dynamicTemplateData?: Record<string, unknown>;
  }

  interface ClientResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  }

  interface MailService {
    setApiKey(apiKey: string): void;
    send(data: MailDataRequired): Promise<[ClientResponse, Record<string, unknown>]>;
    sendMultiple(data: MailDataRequired): Promise<[ClientResponse, Record<string, unknown>]>;
  }

  const mail: MailService;
  export default mail;
  export { MailDataRequired, ClientResponse, MailService };
}
