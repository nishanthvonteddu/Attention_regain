import { PDFParse } from "pdf-parse";
import { buildStudyDeck, MAX_SOURCE_CHARS, sampleSource, type SourceKind, type SourcePage } from "@/lib/study-feed";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const title = String(formData.get("title") ?? "").trim();
    const goal = String(formData.get("goal") ?? "").trim();
    const pastedText = String(formData.get("sourceText") ?? "");
    const uploaded = formData.get("file");

    let sourceText = pastedText;
    let sourceKind: SourceKind = "paste";
    let pageRefs: SourcePage[] = [];
    let resolvedTitle = title;

    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.size > MAX_FILE_SIZE) {
        return Response.json(
          { error: "Keep uploads under 12 MB for the first POC." },
          { status: 400 },
        );
      }

      const extracted = await extractFromFile(uploaded);
      sourceText = extracted.text;
      sourceKind = extracted.sourceKind;
      pageRefs = extracted.pages;
      resolvedTitle ||= extracted.title;
    }

    if (!sourceText.trim()) {
      if (!uploaded) {
        sourceText = sampleSource.body;
        sourceKind = "demo";
        resolvedTitle ||= sampleSource.title;
      } else {
        return Response.json(
          { error: "No readable text was found in the uploaded source." },
          { status: 400 },
        );
      }
    }

    if (sourceText.length > MAX_SOURCE_CHARS) {
      sourceText = sourceText.slice(0, MAX_SOURCE_CHARS);
    }

    const deck = buildStudyDeck({
      title: resolvedTitle || "Untitled study source",
      goal,
      sourceText,
      sourceKind,
      pages: pageRefs,
    });

    return Response.json(deck);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not turn the source into a study feed.",
      },
      { status: 500 },
    );
  }
}

async function extractFromFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const title = file.name.replace(/\.[^.]+$/, "");

  if (file.type === "application/pdf" || extension === "pdf") {
    return extractPdf(file, title);
  }

  const text = await file.text();
  return {
    title,
    text,
    pages: text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block, index) => ({ num: index + 1, text: block })),
    sourceKind: "file" as const,
  };
}

async function extractPdf(file: File, title: string) {
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return {
      title,
      text: result.text,
      pages: result.pages
        .map((page) => ({
          num: page.num,
          text: page.text,
        }))
        .filter((page) => page.text.trim().length > 0),
      sourceKind: "pdf" as const,
    };
  } finally {
    await parser.destroy();
  }
}
