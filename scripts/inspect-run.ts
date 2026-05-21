/**
 * Ad-hoc inspector: dump every pipelineEvents row for a runId.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/inspect-run.ts <runId>
 */

import { pbAdminClient } from './_lib/pb';

async function main() {
  const [, , runId] = process.argv;
  if (!runId) {
    console.error('Usage: tsx scripts/inspect-run.ts <runId>');
    process.exit(1);
  }
  const pb = await pbAdminClient();
  const events = await pb.collection('pipelineEvents').getFullList({
    filter: `runId = "${runId}"`,
    sort: 'createdAt',
  });
  console.log(`\n--- ${events.length} events for run ${runId} ---\n`);
  for (const raw of events) {
    const e = raw as unknown as {
      createdAt: number;
      stage: string;
      level: string;
      message: string;
      metrics: unknown;
    };
    const ts = new Date(e.createdAt).toISOString();
    console.log(`[${ts}] [${e.level}] [${e.stage}] ${e.message}`);
    if (e.metrics && Object.keys(e.metrics as object).length > 0) {
      console.log('  metrics:', JSON.stringify(e.metrics, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
