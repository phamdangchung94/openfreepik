import { describe, it, expect } from "vitest";
import {
  isUnsafeWebhookHost,
  validateCustomerWebhookUrl,
} from "./url-security";

/**
 * SSRF guard tests — these are the canary for customer-webhook safety.
 * A regression that re-allows 127.0.0.1 or 169.254.169.254 would let
 * malicious customers probe internal services or cloud metadata.
 */

describe("isUnsafeWebhookHost", () => {
  describe("blocks loopback names", () => {
    it.each([
      "localhost",
      "LOCALHOST",
      "localhost.localdomain",
      "ip6-localhost",
      "ip6-loopback",
    ])("blocks %s", (host) => {
      expect(isUnsafeWebhookHost(host)).toBe(true);
    });
  });

  describe("blocks internal/mDNS suffixes", () => {
    it.each([
      "printer.local",
      "vault.internal",
      "host.lan",
      "router.home",
      "app.test",
      "anything.intranet",
      "demo.example",
      "fake.invalid",
    ])("blocks %s", (host) => {
      expect(isUnsafeWebhookHost(host)).toBe(true);
    });
  });

  describe("blocks IPv4 private/reserved ranges", () => {
    it.each([
      // Loopback 127.0.0.0/8
      "127.0.0.1",
      "127.1.2.3",
      // RFC 1918 10.0.0.0/8
      "10.0.0.1",
      "10.255.255.254",
      // RFC 1918 172.16.0.0/12
      "172.16.0.1",
      "172.31.255.254",
      // RFC 1918 192.168.0.0/16
      "192.168.1.1",
      "192.168.0.0",
      // Link-local 169.254.0.0/16 + cloud metadata
      "169.254.0.1",
      "169.254.169.254",
      // 0.0.0.0/8 "this network"
      "0.0.0.0",
      // Multicast 224.0.0.0/4
      "224.0.0.1",
      "239.255.255.255",
      // Reserved 240+
      "240.0.0.0",
      "255.255.255.255",
      // CGNAT 100.64.0.0/10
      "100.64.0.1",
      "100.127.255.254",
      // TEST-NET
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
    ])("blocks IPv4 %s", (ip) => {
      expect(isUnsafeWebhookHost(ip)).toBe(true);
    });
  });

  describe("allows public IPv4", () => {
    it.each([
      "8.8.8.8",
      "1.1.1.1",
      "172.15.255.255", // just outside 172.16/12
      "172.32.0.0", // just outside 172.16/12
      "192.167.255.255", // just outside 192.168/16
      "192.169.0.0", // just outside 192.168/16
      "100.63.255.255", // just outside CGNAT
      "100.128.0.0", // just outside CGNAT
    ])("allows IPv4 %s", (ip) => {
      expect(isUnsafeWebhookHost(ip)).toBe(false);
    });
  });

  describe("blocks IPv6 private/reserved", () => {
    it.each([
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.1",
      "fe80::1",
      "fe81::1",
      "fc00::1",
      "fd00::1",
      "ff00::1",
      "ff02::1",
    ])("blocks IPv6 %s", (ip) => {
      expect(isUnsafeWebhookHost(ip)).toBe(true);
    });
  });

  describe("allows public DNS hostnames", () => {
    it.each([
      "example.com",
      "api.stripe.com",
      "webhooks.customer.io",
      "n8n.cloud",
      "subdomain.deep.nested.example.org",
    ])("allows %s", (host) => {
      expect(isUnsafeWebhookHost(host)).toBe(false);
    });
  });

  it("blocks empty / whitespace", () => {
    expect(isUnsafeWebhookHost("")).toBe(true);
    expect(isUnsafeWebhookHost("   ")).toBe(true);
  });
});

describe("validateCustomerWebhookUrl", () => {
  it("returns the trimmed URL when valid", () => {
    expect(validateCustomerWebhookUrl("  https://api.example.com/hook  ")).toBe(
      "https://api.example.com/hook",
    );
  });

  it("accepts plain http for public hosts", () => {
    expect(validateCustomerWebhookUrl("http://api.example.com/hook")).toBe(
      "http://api.example.com/hook",
    );
  });

  it("rejects loopback hostname", () => {
    expect(validateCustomerWebhookUrl("http://localhost:3000/hook")).toBeNull();
  });

  it("rejects 127.0.0.1", () => {
    expect(validateCustomerWebhookUrl("http://127.0.0.1/hook")).toBeNull();
  });

  it("rejects AWS metadata IP", () => {
    expect(
      validateCustomerWebhookUrl(
        "http://169.254.169.254/latest/meta-data/",
      ),
    ).toBeNull();
  });

  it("rejects file:// scheme", () => {
    expect(validateCustomerWebhookUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects javascript: scheme", () => {
    expect(validateCustomerWebhookUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects malformed URL", () => {
    expect(validateCustomerWebhookUrl("not a url")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(validateCustomerWebhookUrl(undefined)).toBeNull();
    expect(validateCustomerWebhookUrl(null)).toBeNull();
    expect(validateCustomerWebhookUrl(123)).toBeNull();
    expect(validateCustomerWebhookUrl({ url: "x" })).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateCustomerWebhookUrl("")).toBeNull();
  });
});
