// React Email template — Internal team award notification.
//
// Sent to the project team (owner, architect, PM, superintendent, etc.) when
// the estimator manually triggers award notifications from the Handoff tab.
// Summarizes which subs were awarded on which trades so the PM's day 1
// starts with a complete picture.
//
// IMPORTANT: No per-sub dollar amounts in this email. Contract status and
// trade list are fine — committed amounts are internal and go through the
// handoff packet, not an email.

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

type TradeAward = {
  tradeName: string;
  subName: string;
  contractStatus: string;
};

type Props = {
  recipientName: string;
  projectName: string;
  bidNumber: string;
  awardedTrades: TradeAward[];
  estimatorName: string;
  replyTo: string;
  customMessage?: string;
};

export default function InternalAwardNotification({
  recipientName,
  projectName,
  bidNumber,
  awardedTrades,
  estimatorName,
  replyTo,
  customMessage,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>
        Award Summary — {projectName} ({bidNumber})
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>Project Award Summary</Text>

          <Section style={section}>
            <Text style={greeting}>Hello {recipientName},</Text>
            <Text style={paragraph}>
              The following subcontractors have been awarded on{" "}
              <strong>{projectName}</strong> ({bidNumber}). This is a summary
              for project setup — the full handoff packet is available in the
              bid dashboard.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={section}>
            <Text style={label}>Trade Awards</Text>
            {awardedTrades.length === 0 ? (
              <Text style={paragraph}>
                No subcontractors have been awarded yet.
              </Text>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Trade</th>
                    <th style={th}>Awarded Sub</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {awardedTrades.map((t) => (
                    <tr key={t.tradeName}>
                      <td style={td}>{t.tradeName}</td>
                      <td style={td}>{t.subName}</td>
                      <td style={td}>{t.contractStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {customMessage && customMessage.trim().length > 0 && (
            <>
              <Hr style={hr} />
              <Section style={section}>
                <Text style={label}>From the Estimator</Text>
                <Text style={value}>{customMessage}</Text>
              </Section>
            </>
          )}

          <Hr style={hr} />

          <Section style={section}>
            <Text style={paragraph}>
              For questions or the full handoff packet, contact {estimatorName}{" "}
              at{" "}
              <Link href={`mailto:${replyTo}`} style={link}>
                {replyTo}
              </Link>
              .
            </Text>
          </Section>

          <Section style={section}>
            <Text style={footer}>
              This is an automated notification from Bid Dashboard.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
};
const container: React.CSSProperties = { backgroundColor: "#ffffff", margin: "40px auto", padding: "32px 32px 24px", maxWidth: "600px", border: "1px solid #e4e4e7", borderRadius: "6px" };
const heading: React.CSSProperties = { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 4px", letterSpacing: "-0.01em" };
const section: React.CSSProperties = { margin: "16px 0" };
const greeting: React.CSSProperties = { fontSize: "15px", color: "#27272a", margin: "0 0 8px" };
const paragraph: React.CSSProperties = { fontSize: "14px", color: "#3f3f46", lineHeight: "1.55", margin: "0 0 8px" };
const label: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 4px" };
const value: React.CSSProperties = { fontSize: "14px", color: "#18181b", margin: "0 0 4px", lineHeight: "1.5" };
const hr: React.CSSProperties = { borderColor: "#e4e4e7", margin: "24px 0" };
const link: React.CSSProperties = { color: "#2563eb", textDecoration: "none" };
const footer: React.CSSProperties = { fontSize: "12px", color: "#a1a1aa", fontStyle: "italic", lineHeight: "1.5", margin: 0 };
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: "8px" };
const th: React.CSSProperties = { textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e4e4e7", padding: "6px 8px 6px 0" };
const td: React.CSSProperties = { fontSize: "13px", color: "#27272a", borderBottom: "1px solid #f4f4f5", padding: "8px 8px 8px 0", verticalAlign: "top" };
