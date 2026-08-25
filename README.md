# UN Minecraft status monitor

This small external monitor keeps the four game entries on
`status.unmcserver.com` in one of three states using the public
MinecraftStatus.com Java/Bedrock protocol API:

- **Operational:** two consecutive protocol probes are online and below the
  configured latency threshold.
- **Degraded:** two consecutive probes are online but above the threshold.
- **Downtime:** two consecutive probes cannot obtain a valid Minecraft protocol
  response from the target.

The thresholds are intentionally calibrated to the external
MinecraftStatus.com protocol probe rather than presented as player-side ping:

| Entry | Threshold |
| --- | ---: |
| Bedrock Beijing | 250 ms |
| Bedrock Los Angeles | 500 ms |
| Java Beijing | 450 ms |
| Java Los Angeles | 900 ms |

GitHub Actions runs the monitor every five minutes and takes two samples two
minutes apart. A Better Stack team-scoped Uptime API token is stored only as the
encrypted repository secret `BETTERSTACK_API_TOKEN`.

GitHub automatically disables schedules in an inactive public repository after
60 days. A small monthly keepalive workflow records one timestamp commit so the
monitor does not silently stop.

All eight Better Stack game checks are restricted to the Asia region. The four
public monitors confirm an outage after two minutes without sending email. Four
matching hidden monitors remain responsible for sending email only after an
entry has stayed unavailable for ten minutes.
