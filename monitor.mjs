import {
  BetterStackClient,
  SERVICES,
  classifySamples,
  probe,
} from "./lib.mjs";

const sampleIntervalMs = Number(process.env.SAMPLE_INTERVAL_MS || 120_000);
const dryRun = process.env.DRY_RUN === "1";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function collect() {
  return Promise.all(
    SERVICES.map(async (service) => {
      try {
        return await probe(service);
      } catch (error) {
        return {
          verdict: "unknown",
          evidenceCode: "probe_request_failed",
          latency: null,
          error: error.message,
        };
      }
    }),
  );
}

const first = await collect();
await sleep(sampleIntervalMs);
const second = await collect();

const results = SERVICES.map((service, index) => ({
  service,
  samples: [first[index], second[index]],
  result: classifySamples(service, [first[index], second[index]]),
}));

for (const item of results) {
  console.log(
    JSON.stringify({
      service: item.service.name,
      thresholdMs: item.service.latencyThresholdMs,
      samples: item.samples,
      decision: item.result,
    }),
  );
}

if (dryRun) process.exit(0);

const client = new BetterStackClient({
  token: process.env.BETTERSTACK_API_TOKEN,
  statusPageId: process.env.BETTERSTACK_STATUS_PAGE_ID || "260427",
});

for (const item of results) {
  const action = await client.apply(item.service, item.result);
  console.log(`${item.service.name}: ${action}`);
}

