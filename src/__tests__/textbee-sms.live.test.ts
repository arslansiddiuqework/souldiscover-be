/**
 * Opt-in live TextBee integration test.
 * NEVER runs in default `npm test`.
 *
 * To run intentionally (sends a real SMS if configured):
 *   TEXTBEE_LIVE_TEST=1 TEXTBEE_LIVE_TO=+E164NUMBER npm run test:sms:live
 *
 * Without TEXTBEE_LIVE_TEST=1 this file exits successfully without sending.
 */

import assert from "assert";
import { textBeeSmsProvider } from "../services/sms/textbee.provider";
import { redactPhone } from "../utils/phone";

async function main() {
  if (process.env.TEXTBEE_LIVE_TEST !== "1") {
    console.log(
      "SKIP  live TextBee test (set TEXTBEE_LIVE_TEST=1 and TEXTBEE_LIVE_TO to run)"
    );
    return;
  }

  const to = (process.env.TEXTBEE_LIVE_TO || "").trim();
  assert.ok(to.startsWith("+"), "TEXTBEE_LIVE_TO must be E.164");
  assert.ok(
    process.env.TEXTBEE_API_KEY,
    "TEXTBEE_API_KEY required for live test"
  );

  console.log(`LIVE  sending test SMS to ${redactPhone(to)}`);
  const result = await textBeeSmsProvider.sendSms({
    to,
    message:
      "Soul Discovery live integration test. Ignore if unexpected. Not a crisis alert.",
  });

  if (!result.ok) {
    console.error("FAIL  live send", result);
    process.exit(1);
  }

  console.log("PASS  accepted by TextBee (queued)", {
    smsBatchId: result.smsBatchId,
    status: result.status,
  });
  console.log(
    "NOTE  queued ≠ delivered. Confirm on the registered Android device."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
