import { Resend } from "resend";

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface EmailProvider {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/**
 * Resend adapter. The idempotency key is forwarded as the Idempotency-Key
 * header, so a request retried after a timeout cannot deliver twice.
 */
export function resendProvider(apiKey: string): EmailProvider {
  const resend = new Resend(apiKey);
  return {
    async send(email) {
      let result: Awaited<ReturnType<typeof resend.emails.send>>;
      try {
        result = await resend.emails.send(
          {
            from: email.from,
            to: email.to,
            replyTo: email.replyTo,
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
          { idempotencyKey: email.idempotencyKey },
        );
      } catch (err) {
        // Network failure / timeout: safe to retry thanks to the idempotency key
        throw new ProviderError(err instanceof Error ? err.message : "network_error", true);
      }
      if (result.error) {
        const status = result.error.statusCode ?? 0;
        const retryable = status === 0 || status === 429 || status >= 500;
        throw new ProviderError(`${result.error.name}: ${result.error.message}`, retryable);
      }
      return { id: result.data?.id ?? "" };
    },
  };
}
