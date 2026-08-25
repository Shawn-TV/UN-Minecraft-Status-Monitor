const API_BASE = "https://uptime.betterstack.com/api/v2";

export const SERVICES = [
  {
    key: "be-beijing",
    name: "基岩创造服 · 北京直连入口",
    edition: "bedrock",
    address: "playbe.unmcserver.com:26666",
    latencyThresholdMs: 250,
    statusPageResourceId: "8996309",
  },
  {
    key: "be-los-angeles",
    name: "基岩创造服 · 洛杉矶中转入口",
    edition: "bedrock",
    address: "la.playbe.unmcserver.com:26666",
    latencyThresholdMs: 500,
    statusPageResourceId: "8996310",
  },
  {
    key: "je-beijing",
    name: "Java/互通生存服 · 北京直连入口",
    edition: "java",
    address: "playje.unmcserver.com",
    latencyThresholdMs: 450,
    statusPageResourceId: "8996317",
  },
  {
    key: "je-los-angeles",
    name: "Java/互通生存服 · 洛杉矶中转入口",
    edition: "java",
    address: "la.playje.unmcserver.com",
    latencyThresholdMs: 900,
    statusPageResourceId: "8996318",
  },
];

const TARGET_UNAVAILABLE_CODES = new Set([
  "connection_refused",
  "timeout",
  "closed_without_status",
  "connection_reset",
  "dns_unresolved",
  "invalid_frame",
  "invalid_payload",
]);

export function minecraftStatusUrl(service) {
  return `https://minecraftstatus.com/api/status/${service.edition}/${encodeURIComponent(service.address)}`;
}

export async function probe(service, fetchImpl = fetch) {
  const response = await fetchImpl(minecraftStatusUrl(service), {
    headers: {
      accept: "application/json",
      "user-agent": "UN-Minecraft-Status-Monitor/1.0",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    return {
      verdict: "unknown",
      evidenceCode: response.status === 429 ? "rate_limited" : "probe_http_error",
      latency: null,
      httpStatus: response.status,
    };
  }

  const body = await response.json();
  return {
    verdict: body.verdict,
    evidenceCode: body.evidenceCode,
    latency: Number.isFinite(body.latency) ? body.latency : null,
    observedAt: body.observedAt,
    validUntil: body.validUntil,
  };
}

function sampleState(sample, threshold) {
  if (
    sample?.verdict === "online" &&
    sample?.evidenceCode === "status_response" &&
    Number.isFinite(sample?.latency)
  ) {
    return sample.latency > threshold ? "degraded" : "operational";
  }

  if (TARGET_UNAVAILABLE_CODES.has(sample?.evidenceCode)) {
    return "downtime";
  }

  return "unknown";
}

export function classifySamples(service, samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return { status: "unchanged", reason: "至少需要两个样本" };
  }

  const states = samples.map((sample) => sampleState(sample, service.latencyThresholdMs));
  const latencies = samples.map((sample) => sample?.latency).filter(Number.isFinite);

  if (states.every((state) => state === "downtime")) {
    return {
      status: "downtime",
      reason: "连续两次未能取得有效的 Minecraft 协议响应",
      latencies,
    };
  }

  if (states.every((state) => state === "degraded")) {
    return {
      status: "degraded",
      reason: `连续两次握手延迟超过 ${service.latencyThresholdMs} ms`,
      latencies,
    };
  }

  if (states.every((state) => state === "operational")) {
    return {
      status: "resolved",
      reason: `连续两次握手延迟不高于 ${service.latencyThresholdMs} ms`,
      latencies,
    };
  }

  return {
    status: "unchanged",
    reason: `样本不一致或探针自身状态不确定（${states.join(" / ")}）`,
    latencies,
  };
}

function reportState(report) {
  return String(report?.attributes?.aggregate_state || "").toLowerCase();
}

function reportTitle(service) {
  return `[自动监控] ${service.name}`;
}

function statusMessage(service, result) {
  const latencyText = result.latencies?.length
    ? `样本：${result.latencies.join(" ms、")} ms。`
    : "";

  if (result.status === "degraded") {
    return `Minecraft 协议仍可连接，但握手延迟持续偏高。阈值：${service.latencyThresholdMs} ms；${latencyText}`;
  }
  if (result.status === "downtime") {
    return "连续两次外部 Minecraft 协议探测均未获得有效响应，入口暂时不可用。";
  }
  return `连接状态与握手延迟已经恢复正常。${latencyText}`;
}

export class BetterStackClient {
  constructor({ token, statusPageId = "260427", fetchImpl = fetch }) {
    if (!token) throw new Error("BETTERSTACK_API_TOKEN is required");
    this.token = token;
    this.statusPageId = statusPageId;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`Better Stack API ${response.status}: ${text.slice(0, 500)}`);
    }
    return body;
  }

  async latestAutomaticReport(service) {
    const response = await this.request(
      `/status-pages/${this.statusPageId}/status-reports?per_page=100`,
    );
    const title = reportTitle(service);
    return (response.data || [])
      .filter((report) => report?.attributes?.title === title)
      .sort(
        (a, b) =>
          new Date(b.attributes.starts_at || 0).getTime() -
          new Date(a.attributes.starts_at || 0).getTime(),
      )[0];
  }

  async createReport(service, result) {
    return this.request(`/status-pages/${this.statusPageId}/status-reports`, {
      method: "POST",
      body: JSON.stringify({
        title: reportTitle(service),
        message: statusMessage(service, result),
        report_type: "manual",
        notify_subscribers: false,
        affected_resources: [
          {
            status_page_resource_id: service.statusPageResourceId,
            status: result.status,
          },
        ],
      }),
    });
  }

  async updateReport(report, service, result) {
    return this.request(
      `/status-pages/${this.statusPageId}/status-reports/${report.id}/status-updates`,
      {
        method: "POST",
        body: JSON.stringify({
          message: statusMessage(service, result),
          notify_subscribers: false,
          affected_resources: [
            {
              status_page_resource_id: service.statusPageResourceId,
              status: result.status,
            },
          ],
        }),
      },
    );
  }

  async apply(service, result) {
    if (result.status === "unchanged") return "skipped";

    const report = await this.latestAutomaticReport(service);
    const current = reportState(report);

    if (result.status === "resolved") {
      if (!report || current === "operational") return "already-operational";
      await this.updateReport(report, service, result);
      return "resolved";
    }

    if (!report || current === "operational") {
      await this.createReport(service, result);
      return `created-${result.status}`;
    }

    if (current === result.status) return `already-${result.status}`;

    await this.updateReport(report, service, result);
    return `updated-${result.status}`;
  }
}

