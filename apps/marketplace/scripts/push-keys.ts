/**
 * Prints a fresh VAPID key pair for Web Push. Run once per deployment and keep
 * the private key secret; rotating it invalidates every existing subscription.
 */
import { generatePushKeys } from "../src/server/push.ts";

const subject = process.env.VAPID_SUBJECT ?? "mailto:security@codeitlab.com";
const keys = await generatePushKeys(subject);
console.log("# Add these to the marketplace environment (never commit the private key).");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=${keys.subject}`);
