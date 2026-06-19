/**
 * One-off probe for the AMBOSS MCP `get_guidelines` tool.
 *
 * Confirms (R1 in docs/plans) that `get_guidelines` is exposed on the same
 * AMBOSS MCP server the mapping engine already uses, and dumps its input
 * schema + a sample response so we can finalise `GuidelineOutputSchema` /
 * the `GuidelineCoverage` storage shape from observed reality rather than a
 * defensive guess.
 *
 * Usage:
 *   npx tsx scripts/probe-guidelines.ts "<disease or query>"
 *
 * Requires AMBOSS_MCP_URL + AMBOSS_MCP_TOKEN in .env.local. Safe + read-only.
 */

import { createMCPClient } from '@ai-sdk/mcp';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const url = process.env.AMBOSS_MCP_URL;
  const token = process.env.AMBOSS_MCP_TOKEN;
  if (!url || !token) {
    console.error('Missing AMBOSS_MCP_URL / AMBOSS_MCP_TOKEN in .env.local');
    process.exit(1);
  }
  const query = process.argv[2] ?? 'Type 2 diabetes mellitus';

  const mcp = await createMCPClient({
    transport: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const tools = await mcp.tools();
    const names = Object.keys(tools);
    console.log('\n=== Tools exposed by AMBOSS MCP server ===');
    console.log(names.join('\n'));

    const guidelineTool = names.find((n) => n.toLowerCase().includes('guideline'));
    if (!guidelineTool) {
      console.error(
        '\n!! No tool matching /guideline/i found. Confirm the exact tool name with the AMBOSS team.',
      );
      return;
    }
    console.log(`\n=== Found guidelines tool: "${guidelineTool}" ===`);

    // The AI SDK tool object carries a description + an input schema. Shapes
    // vary across SDK versions, so dump everything defensively.
    const tool = tools[guidelineTool] as Record<string, unknown>;
    console.log('description:', tool.description);
    console.log(
      'inputSchema:',
      JSON.stringify(tool.inputSchema ?? tool.parameters, null, 2),
    );

    // Attempt a sample call so we can see the actual return shape. `execute`
    // takes (args, options) — pass an empty options bag; ignore if the SDK
    // surface differs.
    const execute = tool.execute as
      | ((args: unknown, opts: unknown) => Promise<unknown>)
      | undefined;
    if (typeof execute === 'function') {
      console.log(
        `\n=== Sample call: ${guidelineTool}({ query: ${JSON.stringify(query)} }) ===`,
      );
      try {
        const res = await execute(
          { query },
          { toolCallId: 'probe', messages: [], abortSignal: undefined },
        );
        console.log(JSON.stringify(res, null, 2).slice(0, 8000));
      } catch (e) {
        console.error('Sample call failed (try a different arg name than "query"):', e);
      }
    } else {
      console.log(
        '\n(no execute() on the tool object — inspect inputSchema above for arg names)',
      );
    }
  } finally {
    await mcp.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
