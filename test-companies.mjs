// ---------------------------------------------------------------------------
// Run 4 company tests against the live dev server and save SSE output
// Usage: node test-companies.mjs
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "fs";

const BASE_URL = "http://localhost:3000/api/research";
const OUTPUT_DIR = "./test-output";

const companies = [
  { name: "Microsoft",     category: "major-public-1" },
  { name: "NVIDIA",        category: "major-public-2" },
  { name: "Stripe",        category: "private" },
  { name: "Duolingo",      category: "small-public" },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

async function runResearch(company) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${company.name} (${company.category})`);
  console.log("=".repeat(60));

  const startTime = Date.now();
  const events = [];

  try {
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName: company.name }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(line.slice(6));
          events.push(json);

          if (json.type === "progress") {
            console.log(`  [${json.step}] ${json.message}`);
            if (json.data) console.log(`         data:`, JSON.stringify(json.data));
          } else if (json.type === "complete") {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n  ✅ COMPLETE in ${elapsed}s`);
            console.log(`  Company:    ${json.result.companyName}`);
            console.log(`  Verdict:    ${json.result.decision?.verdict?.toUpperCase() ?? "N/A"}`);
            console.log(`  Confidence: ${json.result.decision?.confidence ?? "N/A"}%`);
            console.log(`  Iterations: ${json.result.iterationCount}`);
            console.log(`  Notes:      ${json.result.researchNotes.length}`);
            console.log(`  News items: ${json.result.newsFindings.length}`);
            console.log(`  Has financials: ${json.result.financialData?.isPubliclyTraded}`);
          } else if (json.type === "error") {
            console.log(`\n  ❌ ERROR: ${json.message}`);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Save full output
    const outFile = `${OUTPUT_DIR}/${company.category}-${company.name.toLowerCase()}.json`;
    writeFileSync(outFile, JSON.stringify({ company: company.name, category: company.category, events }, null, 2));
    console.log(`  Saved → ${outFile}`);

    return { company: company.name, events, success: true };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ FAILED: ${msg}`);
    return { company: company.name, events, success: false, error: msg };
  }
}

// Run sequentially to avoid rate limits
for (const company of companies) {
  await runResearch(company);
  // Brief pause between companies to avoid hammering free-tier APIs
  console.log("\n  Waiting 5s before next company...");
  await new Promise(r => setTimeout(r, 5000));
}

console.log("\n\n✅ All tests complete. Results in ./test-output/");
