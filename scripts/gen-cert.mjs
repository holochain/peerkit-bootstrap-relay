/**
 * @fileoverview Generate a persistent relay certificate and print it as JSON.
 *
 * Output is a RelayCertificate ({ privateKeyPem, certificatePem, certhash }).
 * Store it as the RELAY_CERT_JSON GitHub secret so the relay keeps a stable
 * certhash — and dialable multiaddr — across droplet replacements.
 *
 * Self-minted with a 5-year validity rather than via @peerkit/relay's
 * generateRelayCertificate(), which hardcodes a 14-day validity that would
 * expire the persisted certhash (and break every peer that pinned it) two
 * weeks after generation. The keypair, signing algorithm, extensions and
 * certhash derivation mirror the upstream helper exactly; only the validity
 * window differs. WebRTC Direct authenticates peers by matching the certhash
 * fingerprint, not the certificate's notAfter, so a long validity is safe.
 *
 * Usage: `npm run gen-cert > relay-cert.json`
 */

import "reflect-metadata";

import { webcrypto } from "node:crypto";

import * as x509 from "@peculiar/x509";
import { base64url } from "multiformats/bases/base64";
import { sha256 } from "multiformats/hashes/sha2";

const CERT_VALIDITY_YEARS = 5;

async function generateRelayCertificate() {
  // x509's provider is a process-global singleton; pin it to Node's WebCrypto
  // so the keypair and the signer share one CryptoKey implementation.
  x509.cryptoProvider.set(webcrypto);

  // WebRTC Direct requires ECDSA on the P-256 curve.
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const notBefore = new Date();
  notBefore.setMilliseconds(0);
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notBefore.getFullYear() + CERT_VALIDITY_YEARS);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    // Serial uniqueness is satisfied by the fresh keypair, not this value.
    serialNumber: "01",
    name: "CN=peerkit-relay",
    notBefore,
    notAfter,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    keys: keyPair,
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true)],
  });

  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const certhash = base64url.encode(
    (await sha256.digest(new Uint8Array(cert.rawData))).bytes,
  );

  return {
    privateKeyPem: x509.PemConverter.encode(pkcs8, "PRIVATE KEY"),
    certificatePem: cert.toString("pem"),
    certhash,
  };
}

const certificate = await generateRelayCertificate();
process.stdout.write(`${JSON.stringify(certificate, null, 2)}\n`);
