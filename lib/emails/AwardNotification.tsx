// React Email template — Sub award notification.
//
// Sent to awarded subcontractors when the estimator manually triggers
// notifications from the Handoff tab. Congratulations + next steps.
//
// IMPORTANT: Never include pricing data of any kind.

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

type Props = {
  subName: string;
  projectName: string;
  bidNumber: string;
  trades: string[];
  estimatorName: string;
  replyTo: string;
  customMessage?: string;
};

export default function AwardNotification({
  subName,
  projectName,
  bidNumber,
  trades,
  estimatorName,
  replyTo,
  customMessage,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>
        Award Notification — {projectName} ({bidNumber})
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>Award Notification</Text>

          <Section style={section}>
            <Text style={greeting}>Hello {subName},</Text>
            <Text style={paragraph}>
              Congratulations — you have been selected for the following
              trade(s) on this project. We look forward to working with you.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={section}>
            <Text style={label}>Project</Text>
            <Text style={value}>
              {projectName} <span style={muted}>({bidNumber})</span>
            </Text>

            <Text style={label}>Awarded Trade(s)</Text>
            <ul style={tradeList}>
              {trades.map((t) => (
                <li key={t} style={tradeItem}>
                  {t}
                </li>
              ))}
            </ul>
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
            <Text style={label}>Next Steps</Text>
            <Text style={paragraph}>
              Your project manager will follow up with contract documents,
              insurance requirements, and scheduling details.
            </Text>
            <Text style={paragraph}>
              Please direct any questions to {estimatorName} at{" "}
              <Link href={`mailto:${replyTo}`} style={link}>
                {replyTo}
              </Link>
              .
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={section}>
            <Text style={footer}>
              This is an automated notification from Construction Dashboard. Reply
              directly to this email to reach the estimator.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "40px auto",
  padding: "32px 32px 24px",
  maxWidth: "560px",
  border: "1px solid #e4e4e7",
  borderRadius: "6px",
};
const heading: React.CSSProperties = { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 4px", letterSpacing: "-0.01em" };
const section: React.CSSProperties = { margin: "16px 0" };
const greeting: React.CSSProperties = { fontSize: "15px", color: "#27272a", margin: "0 0 8px" };
const paragraph: React.CSSProperties = { fontSize: "14px", color: "#3f3f46", lineHeight: "1.55", margin: "0 0 8px" };
const label: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 4px" };
const value: React.CSSProperties = { fontSize: "14px", color: "#18181b", margin: "0 0 4px", lineHeight: "1.5" };
const muted: React.CSSProperties = { color: "#a1a1aa", fontSize: "13px" };
const tradeList: React.CSSProperties = { margin: "4px 0 8px", paddingLeft: "20px", color: "#27272a" };
const tradeItem: React.CSSProperties = { fontSize: "14px", lineHeight: "1.6" };
const hr: React.CSSProperties = { borderColor: "#e4e4e7", margin: "24px 0" };
const link: React.CSSProperties = { color: "#2563eb", textDecoration: "none" };
const footer: React.CSSProperties = { fontSize: "12px", color: "#a1a1aa", fontStyle: "italic", lineHeight: "1.5", margin: 0 };
