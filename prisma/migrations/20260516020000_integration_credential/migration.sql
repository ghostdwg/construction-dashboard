-- IntegrationCredential: encrypted credentials for third-party integrations
-- (Beeline, Blue Book Network, ConstructConnect, iSqFt, etc.). Encryption is
-- AES-256-GCM with a master key from CREDENTIAL_MASTER_KEY env var. The DB
-- never holds plaintext; the master key never enters the DB.

CREATE TABLE "IntegrationCredential" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "service"         TEXT NOT NULL,
    "field"           TEXT NOT NULL,
    "encryptedValue"  TEXT NOT NULL,         -- base64 ciphertext
    "iv"              TEXT NOT NULL,         -- base64 nonce (12 bytes for GCM)
    "authTag"         TEXT NOT NULL,         -- base64 GCM auth tag
    "algorithm"       TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    "lastTestedAt"    DATETIME,
    "lastTestStatus"  TEXT,                  -- 'success' | 'failed' | NULL
    "lastTestError"   TEXT
);

CREATE UNIQUE INDEX "IntegrationCredential_service_field_key" ON "IntegrationCredential"("service", "field");
CREATE INDEX "IntegrationCredential_service_idx" ON "IntegrationCredential"("service");
