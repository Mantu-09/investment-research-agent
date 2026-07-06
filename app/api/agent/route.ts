// Legacy placeholder — actual agent endpoint is at /api/research
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    message: "Use POST /api/research instead.",
  });
}
