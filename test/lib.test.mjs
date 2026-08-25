import test from "node:test";
import assert from "node:assert/strict";

import { SERVICES, classifySamples, minecraftStatusUrl } from "../lib.mjs";

const service = SERVICES[0];
const online = (latency) => ({
  verdict: "online",
  evidenceCode: "status_response",
  latency,
});

test("builds the Bedrock endpoint with its explicit port", () => {
  assert.equal(
    minecraftStatusUrl(service),
    "https://minecraftstatus.com/api/status/bedrock/playbe.unmcserver.com%3A26666",
  );
});

test("two healthy samples resolve the component", () => {
  assert.equal(classifySamples(service, [online(150), online(170)]).status, "resolved");
});

test("two slow samples degrade the component", () => {
  assert.equal(classifySamples(service, [online(300), online(280)]).status, "degraded");
});

test("two target timeouts mark downtime", () => {
  const timeout = { verdict: "unknown", evidenceCode: "timeout", latency: null };
  assert.equal(classifySamples(service, [timeout, timeout]).status, "downtime");
});

test("probe-provider failures do not change public status", () => {
  const providerFailure = {
    verdict: "unknown",
    evidenceCode: "rate_limited",
    latency: null,
  };
  assert.equal(
    classifySamples(service, [providerFailure, providerFailure]).status,
    "unchanged",
  );
});

test("mixed samples do not cause status flapping", () => {
  assert.equal(classifySamples(service, [online(150), online(300)]).status, "unchanged");
});

