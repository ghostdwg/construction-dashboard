// GET /api/subcontractors/import/template
// Returns a sample CSV with all supported columns and one example row.
// Users can download, fill in, and re-upload via /import.

const HEADERS = [
  "Name",
  "DBA Name",
  "Address",
  "City",
  "State",
  "Zip",
  "Country",
  "Business Phone",
  "Company Email Address",
  "Primary Contact Email Address",
  "Mobile Phone",
  "Website",
  "Trades",
  "Union Member",
  "License Number",
  "Minority Business Enterprise",
  "Woman's Business",
  "Disadvantaged Business",
  "Id",
];

const SAMPLE_ROW = [
  "Acme Electrical",
  "Acme Power",
  "1234 Industrial Blvd",
  "Des Moines",
  "IA",
  "50309",
  "USA",
  "(515) 555-0100",
  "info@acmeelectrical.com",
  "[email protected]",
  "(515) 555-0101",
  "https://acmeelectrical.com",
  "Electrical, Low Voltage",
  "Yes",
  "EC12345",
  "No",
  "No",
  "No",
  "",
];

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const csv = "\uFEFF" + [
    HEADERS.map(csvEscape).join(","),
    SAMPLE_ROW.map(csvEscape).join(","),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="subcontractor-import-template.csv"',
    },
  });
}
