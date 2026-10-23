import { assert, describe, it } from "vite-plus/test";

import type { CodeitlabCredentialsMode } from "../credentials.ts";
import {
  createFake,
  CredentialVault,
  maskText,
  maskValue,
  type CredentialsEngineOptions,
} from "./engine.ts";

const options = (overrides: Partial<CredentialsEngineOptions> = {}): CredentialsEngineOptions => ({
  mode: "balanced" as CodeitlabCredentialsMode,
  privateTag: "mask",
  maskPersonalData: true,
  fakeKey: "test-key",
  ...overrides,
});

const OPENAI_KEY = "sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789";

describe("credentials engine: detectors", () => {
  it("masks an API key and keeps its shape", () => {
    const vault = new CredentialVault();
    const result = maskText(`The key is ${OPENAI_KEY}`, options(), vault);
    assert.notInclude(result.masked, OPENAI_KEY);
    assert.match(result.masked, /sk-proj-[A-Za-z0-9_-]{20,}/);
    assert.strictEqual(result.findings[0]?.kind, "api-key");
    assert.strictEqual(result.findings[0]?.source, "pattern");
    assert.strictEqual(vault.restore(result.masked).text, `The key is ${OPENAI_KEY}`);
  });

  it("keeps the same fake for the same value and a different one for another key", () => {
    const first = maskText(`token: ${OPENAI_KEY}`, options()).masked;
    const second = maskText(`again: ${OPENAI_KEY}`, options()).masked;
    const fake = first.slice(first.indexOf("sk-proj-"));
    assert.include(second, fake);
    const other = maskText(`token: ${OPENAI_KEY}`, options({ fakeKey: "other-key" })).masked;
    assert.notStrictEqual(other, first);
  });

  it("masks a password assignment but leaves the field name readable", () => {
    const result = maskText(`password: hunter2-is-not-safe`, options());
    assert.include(result.masked, "password: ");
    assert.notInclude(result.masked, "hunter2-is-not-safe");
    assert.strictEqual(result.findings[0]?.kind, "password");
  });

  it("masks an .env line value", () => {
    const result = maskText("OPENAI_API_KEY=sk-live-abcdef0123456789abcdef\nDEBUG=1", options());
    assert.notInclude(result.masked, "sk-live-abcdef0123456789abcdef");
    assert.include(result.masked, "OPENAI_API_KEY=");
    assert.include(result.masked, "DEBUG=1");
  });

  it("masks a PEM private key body and keeps the header", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdefghij\nklmnopqrstuvwxyz0987654321\n-----END RSA PRIVATE KEY-----";
    const result = maskText(pem, options());
    assert.include(result.masked, "-----BEGIN RSA PRIVATE KEY-----");
    assert.include(result.masked, "-----END RSA PRIVATE KEY-----");
    assert.notInclude(result.masked, "MIIEowIBAAKCAQEA");
    assert.strictEqual(result.findings[0]?.kind, "private-key");
  });

  it("masks JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = maskText(`Authorization: Bearer ${jwt}`, options());
    assert.notInclude(result.masked, "dozjgNryP4J3jVmNHl0w5N");
    assert.strictEqual(result.findings[0]?.kind, "jwt");
  });

  it("masks the password inside a connection string", () => {
    const result = maskText("postgres://app:s3cretPassw0rd@db.internal:5432/app", options());
    assert.notInclude(result.masked, "s3cretPassw0rd");
    assert.include(result.masked, "postgres://app:");
    assert.strictEqual(result.findings[0]?.kind, "connection-string");
  });

  it("masks personal data in balanced mode but not in secrets-only mode", () => {
    const text = "mail emily.carter@example.com or +30 690 123 4567, IBAN GB82WEST12345698765432";
    const balanced = maskText(text, options());
    assert.notInclude(balanced.masked, "emily.carter@example.com");
    assert.notInclude(balanced.masked, "690 123 4567");
    assert.match(balanced.masked, /GB\d{2}[A-Z0-9]{18}/);
    const secrets = maskText(text, options({ mode: "secrets", maskPersonalData: false }));
    assert.include(secrets.masked, "emily.carter@example.com");
  });

  it("only masks private IPs in maximum mode", () => {
    const text = "connect to 10.1.2.3 and 8.8.8.8";
    const balanced = maskText(text, options());
    assert.include(balanced.masked, "10.1.2.3");
    const max = maskText(text, options({ mode: "max" }));
    assert.notInclude(max.masked, "10.1.2.3");
    assert.include(max.masked, "8.8.8.8");
  });

  it("does not mask a random 16-digit number that fails the card checksum", () => {
    const result = maskText("order 1234567890123456 shipped", options());
    assert.include(result.masked, "1234567890123456");
    assert.strictEqual(result.findings.length, 0);
  });
});

describe("credentials engine: /private blocks", () => {
  it("masks the content of a /private block and keeps the tags", () => {
    const result = maskText("before /private this is my private note /private after", options());
    assert.notInclude(result.masked, "this is my private note");
    assert.include(result.masked, "/private ");
    assert.strictEqual(result.findings[0]?.kind, "private-block");
    assert.strictEqual(result.findings[0]?.source, "tag");
    assert.strictEqual(result.privateBlocks, 1);
    assert.isFalse(result.blocked);
  });

  it("blocks the request when the user chose block for /private", () => {
    const result = maskText(
      "x [private] secret plan [/private] y",
      options({ privateTag: "block" }),
    );
    assert.isTrue(result.blocked);
    assert.notInclude(result.masked, "secret plan");
  });

  it("supports the three tag pairs and restores the original content", () => {
    const vault = new CredentialVault();
    const text = "<private>alpha</private> and [private]beta[/private]";
    const result = maskText(text, options(), vault);
    assert.notInclude(result.masked, "alpha");
    assert.notInclude(result.masked, "beta");
    assert.strictEqual(result.privateBlocks, 2);
    assert.strictEqual(vault.restore(result.masked).text, text);
  });
});

describe("credentials engine: findings and vault", () => {
  it("never puts a value in a finding", () => {
    const result = maskText(`password: hunter2 and ${OPENAI_KEY}`, options());
    const serialized = JSON.stringify(result.findings);
    assert.notInclude(serialized, "hunter2");
    assert.notInclude(serialized, OPENAI_KEY);
  });

  it("round-trips a mixed document through mask and restore", () => {
    const vault = new CredentialVault();
    const text = `key=${OPENAI_KEY}\npassword: hunter2\n/private top secret /private\nmail me@example.com`;
    const masked = maskText(text, options(), vault);
    assert.notInclude(masked.masked, OPENAI_KEY);
    assert.notInclude(masked.masked, "hunter2");
    assert.notInclude(masked.masked, "top secret");
    const restored = vault.restore(masked.masked);
    assert.strictEqual(restored.text, text);
    assert.strictEqual(restored.restored, masked.findings.length);
  });

  it("masks strings inside a JSON body and restores the object", () => {
    const vault = new CredentialVault();
    const body = {
      model: "gpt-5",
      messages: [{ role: "user", content: `my key is ${OPENAI_KEY}` }],
      count: 2,
    };
    const masked = maskValue(body, options(), vault);
    assert.notInclude(JSON.stringify(masked.value), OPENAI_KEY);
    assert.strictEqual((masked.value as typeof body).model, "gpt-5");
    assert.deepStrictEqual(vault.restoreDeep(masked.value), body);
  });

  it("reuses an existing fake for history that repeats the value", () => {
    const vault = new CredentialVault();
    const first = maskText(`key ${OPENAI_KEY}`, options(), vault).masked;
    const fake = first.slice(first.indexOf("sk-proj-"));
    assert.include(vault.existingFake(OPENAI_KEY) ?? "", fake);
  });
});

describe("credentials engine: local model", () => {
  it("uses the model for tokens patterns miss and marks the source", () => {
    const model = {
      id: "stub",
      version: "1",
      score: (token: string) => (token.startsWith("Zx9") ? 0.9 : 0.1),
    };
    const result = maskText("blob Zx9QwErTyUiOpAsDfGhJkL", options({ model }));
    assert.isTrue(result.modelUsed);
    assert.notInclude(result.masked, "Zx9QwErTyUiOpAsDfGhJkL");
    assert.strictEqual(result.findings[0]?.kind, "model-detected");
  });

  it("leaves a token alone when the model is not confident", () => {
    const model = { id: "stub", version: "1", score: () => 0.2 };
    const result = maskText("blob Zx9QwErTyUiOpAsDfGhJkL", options({ model }));
    assert.isFalse(result.modelUsed);
    assert.include(result.masked, "Zx9QwErTyUiOpAsDfGhJkL");
  });
});

describe("credentials engine: fake shapes", () => {
  it("keeps the country and length of an IBAN and its checksum valid", () => {
    const fake = createFake("iban", "GB82WEST12345698765432", "k");
    assert.strictEqual(fake.slice(0, 2), "GB");
    assert.strictEqual(fake.length, 22);
    assert.notStrictEqual(fake, "GB82WEST12345698765432");
  });

  it("keeps the prefix of a known API key", () => {
    const fake = createFake("api-key", "ghp_0123456789abcdefghijklmnopqrstuvwxyz", "k");
    assert.match(fake, /^ghp_[A-Za-z0-9_-]{20,}$/);
  });

  it("keeps a card number Luhn-valid and the same length", () => {
    const fake = createFake("card", "4242424242424242", "k");
    assert.strictEqual(fake.length, 16);
    assert.notStrictEqual(fake, "4242424242424242");
  });

  it("keeps an email readable and never the original domain", () => {
    const fake = createFake("email", "emily.carter@acme-internal.example", "k");
    assert.match(fake, /^user_[a-z]{8}@masked\.invalid$/);
  });
});
