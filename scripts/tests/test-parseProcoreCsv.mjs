// Standalone unit tests for parseProcoreCsv
// Run with: node --test --experimental-strip-types scripts/tests/test-parseProcoreCsv.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProcoreCsv } from "../../lib/services/import/parseProcoreCsv.ts";

test("returns empty result for empty CSV", () => {
  const result = parseProcoreCsv("");
  assert.equal(result.rows.length, 0);
  assert.equal(result.totalRows, 0);
});

test("returns empty result for header-only CSV", () => {
  const result = parseProcoreCsv("Name,Address\n");
  assert.equal(result.rows.length, 0);
});

test("parses minimal CSV with just Name", () => {
  const csv = "Name\nAcme Electrical\n";
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].company, "Acme Electrical");
  assert.equal(result.detectedFormat, "generic");
});

test("detects Procore format via Entity Type column", () => {
  const csv = "Name,Entity Type,Entity Id,Address\nAcme,Company,12345,123 Main St\n";
  const result = parseProcoreCsv(csv);
  assert.equal(result.detectedFormat, "procore");
});

test("parses full Procore-style row", () => {
  const csv = [
    "Name,Address,City,State,Zip,Business Phone,Company Email Address,Trades,Union Member,Minority Business Enterprise,Id",
    `"Acme Electrical","1234 Industrial Blvd","Des Moines","IA","50309","(515) 555-0100","info@acme.com","Electrical, Low Voltage","Yes","No","V12345"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.company, "Acme Electrical");
  assert.equal(row.address, "1234 Industrial Blvd");
  assert.equal(row.city, "Des Moines");
  assert.equal(row.state, "IA");
  assert.equal(row.zip, "50309");
  assert.equal(row.phone, "(515) 555-0100");
  assert.equal(row.email, "info@acme.com");
  assert.deepEqual(row.trades, ["Electrical", "Low Voltage"]);
  assert.equal(row.isUnion, true);
  assert.equal(row.isMWBE, false);
  assert.equal(row.procoreVendorId, "V12345");
  assert.equal(row.office, "Des Moines, IA");
});

test("isMWBE true if any diversity flag set", () => {
  const csv = [
    "Name,Minority Business Enterprise,Woman's Business,Disadvantaged Business",
    `"Sub A","No","No","Yes"`,
    `"Sub B","Yes","No","No"`,
    `"Sub C","No","Yes","No"`,
    `"Sub D","No","No","No"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].isMWBE, true);
  assert.equal(result.rows[1].isMWBE, true);
  assert.equal(result.rows[2].isMWBE, true);
  assert.equal(result.rows[3].isMWBE, false);
});

test("handles Yes/No, true/false, 1/0 for booleans", () => {
  const csv = [
    "Name,Union Member",
    "A,Yes",
    "B,Y",
    "C,true",
    "D,1",
    "E,No",
    "F,",
    "G,No",
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].isUnion, true);
  assert.equal(result.rows[1].isUnion, true);
  assert.equal(result.rows[2].isUnion, true);
  assert.equal(result.rows[3].isUnion, true);
  assert.equal(result.rows[4].isUnion, false);
  assert.equal(result.rows[5].isUnion, false);
});

test("splits trades on comma, semicolon, or pipe", () => {
  const csv = [
    "Name,Trades",
    `"A","Electrical, Mechanical"`,
    `"B","Plumbing; HVAC"`,
    `"C","Roofing | Insulation"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.deepEqual(result.rows[0].trades, ["Electrical", "Mechanical"]);
  assert.deepEqual(result.rows[1].trades, ["Plumbing", "HVAC"]);
  assert.deepEqual(result.rows[2].trades, ["Roofing", "Insulation"]);
});

test("skips rows with no company name", () => {
  const csv = [
    "Name,City",
    "Acme,Des Moines",
    ",Iowa City",
    "  ,Chicago",
    "Beta,Omaha",
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.skippedRows, 2);
});

test("skips entirely empty rows", () => {
  const csv = "Name\nAcme\n\n\nBeta\n";
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 2);
});

test("handles quoted fields containing commas", () => {
  const csv = [
    "Name,Address",
    `"Acme, Inc.","1234 Main St, Suite 100"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].company, "Acme, Inc.");
  assert.equal(result.rows[0].address, "1234 Main St, Suite 100");
});

test("handles quoted fields with escaped quotes", () => {
  const csv = [
    "Name",
    `"Acme ""The Best"" Inc"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].company, 'Acme "The Best" Inc');
});

test("handles UTF-8 BOM", () => {
  const csv = "\ufeffName\nAcme\n";
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].company, "Acme");
});

test("handles Windows CRLF line endings", () => {
  const csv = "Name,City\r\nAcme,Des Moines\r\nBeta,Iowa City\r\n";
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].company, "Acme");
  assert.equal(result.rows[1].company, "Beta");
});

test("recognizes header aliases", () => {
  // Use 'Vendor Name' instead of 'Name', 'Phone' instead of 'Business Phone'
  const csv = [
    "Vendor Name,Phone,Trade",
    `"Acme","(515) 555-0100","Electrical"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].company, "Acme");
  assert.equal(result.rows[0].phone, "(515) 555-0100");
  assert.deepEqual(result.rows[0].trades, ["Electrical"]);
});

test("captures both contact email and primary contact email", () => {
  const csv = [
    "Name,Company Email Address,Primary Contact Email Address",
    `"Acme","info@acme.com","john@acme.com"`,
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].email, "info@acme.com");
  assert.equal(result.rows[0].contactEmail, "john@acme.com");
});

test("multiline quoted field reassembled correctly", () => {
  const csv = `Name,Notes
"Acme","Line 1
Line 2
Line 3"
"Beta","Single line"
`;
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].company, "Acme");
  assert.equal(result.rows[1].company, "Beta");
});

test("counts valid and skipped rows correctly", () => {
  // Note: blank lines are stripped by the CSV parser before row counting,
  // so they don't appear in totalRows or skippedRows.
  const csv = [
    "Name,City",
    "Acme,Des Moines",
    "",                 // blank line — dropped at CSV parse layer
    ",Iowa City",       // skipped — no company name
    "Beta,",            // valid (Beta with no city)
    "Charlie,Chicago",  // valid
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.totalRows, 4);   // 4 non-blank data rows
  assert.equal(result.validRows, 3);   // Acme, Beta, Charlie
  assert.equal(result.skippedRows, 1); // ",Iowa City" only
});

test("composes office field from city + state", () => {
  const csv = [
    "Name,City,State",
    "Acme,Des Moines,IA",
    "Beta,Chicago,",
    "Charlie,,IL",
    "Delta,,",
  ].join("\n");
  const result = parseProcoreCsv(csv);
  assert.equal(result.rows[0].office, "Des Moines, IA");
  assert.equal(result.rows[1].office, "Chicago");
  assert.equal(result.rows[2].office, "IL");
  assert.equal(result.rows[3].office, null);
});
