import { describe, expect, it } from "vitest";
import {
  isMeetingUploadStale,
  MEETING_UPLOAD_STALE_AFTER_MS,
} from "../meetingUploadStaleness";

const NOW_MS = Date.parse("2026-07-20T12:00:00.000Z");
const FRESH_UPLOAD_UPDATED_AT = "2026-07-20T11:58:00.000Z";
const STALE_UPLOAD_UPDATED_AT = "2026-07-20T11:54:59.999Z";
const OLD_COMMITTED_MEDIA_UPLOADED_AT = "2025-01-01T00:00:00.000Z";

describe("isMeetingUploadStale", () => {
  it("does not classify a healthy replacement from its old committed-media timestamp", () => {
    const replacement = {
      status: "UPLOADING",
      updatedAt: FRESH_UPLOAD_UPDATED_AT,
      uploadedAt: OLD_COMMITTED_MEDIA_UPLOADED_AT,
    };

    expect(isMeetingUploadStale(replacement, NOW_MS)).toBe(false);
  });

  it("classifies a replacement whose UPLOADING lifecycle timestamp is stale", () => {
    const replacement = {
      status: "UPLOADING",
      updatedAt: STALE_UPLOAD_UPDATED_AT,
      uploadedAt: OLD_COMMITTED_MEDIA_UPLOADED_AT,
    };

    expect(isMeetingUploadStale(replacement, NOW_MS)).toBe(true);
  });

  it("does not classify a healthy initial upload with no committed media", () => {
    const initialUpload = {
      status: "UPLOADING",
      updatedAt: FRESH_UPLOAD_UPDATED_AT,
      uploadedAt: null,
    };

    expect(isMeetingUploadStale(initialUpload, NOW_MS)).toBe(false);
  });

  it("classifies a stuck initial upload with no committed media", () => {
    const initialUpload = {
      status: "UPLOADING",
      updatedAt: STALE_UPLOAD_UPDATED_AT,
      uploadedAt: null,
    };

    expect(isMeetingUploadStale(initialUpload, NOW_MS)).toBe(true);
  });

  it.each([
    "PENDING",
    "TRANSCRIBING",
    "AWAITING_SOURCE_MAP",
    "AWAITING_NAMES",
    "ANALYZING",
    "READY",
    "FAILED",
  ])("never classifies the non-UPLOADING %s state as stale", (status) => {
    expect(
      isMeetingUploadStale({ status, updatedAt: STALE_UPLOAD_UPDATED_AT }, NOW_MS),
    ).toBe(false);
  });

  it("fails safely when updatedAt is absent", () => {
    expect(isMeetingUploadStale({ status: "UPLOADING" }, NOW_MS)).toBe(false);
    expect(
      isMeetingUploadStale({ status: "UPLOADING", updatedAt: null }, NOW_MS),
    ).toBe(false);
  });

  it("fails safely when updatedAt is malformed", () => {
    expect(
      isMeetingUploadStale(
        { status: "UPLOADING", updatedAt: "not-a-timestamp" },
        NOW_MS,
      ),
    ).toBe(false);
  });

  it("does not classify an upload as stale exactly at the threshold", () => {
    const exactlyAtThreshold = new Date(
      NOW_MS - MEETING_UPLOAD_STALE_AFTER_MS,
    ).toISOString();

    expect(
      isMeetingUploadStale(
        { status: "UPLOADING", updatedAt: exactlyAtThreshold },
        NOW_MS,
      ),
    ).toBe(false);
  });
});
