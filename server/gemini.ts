import { GoogleGenAI, Type } from '@google/genai';
import type { BuilderFile } from '../src/types';

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

export function resolveSafeModel(requestedModel?: string): string {
  if (requestedModel && ALLOWED_MODELS.has(requestedModel)) {
    return requestedModel;
  }
  return 'gemini-4-hydrogen';
}

export interface GeneratedProjectPayload {
  summary: string;
  projectName: string;
  framework: string;
  files: BuilderFile[];
  tokensUsed: number;
  usedLiveAi: boolean;
}

export async function generateOrUpdateProjectWithAi(params: {
  prompt: string;
  existingFiles?: BuilderFile[];
  model?: string;
  mode: 'create' | 'update';
}): Promise<GeneratedProjectPayload> {
  const model = resolveSafeModel(params.model);
  const ai = getAiClient();

  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to run live AI generation.',
    );
  }

  const existingContext =
    params.mode === 'update' && params.existingFiles?.length
      ? `\nExisting workspace files:\n${params.existingFiles
          .map((f) => `--- ${f.path} ---\n${f.content}`)
          .join('\n\n')}`
      : '';

  const systemInstruction = `You are Kodex Cloud AI App & Code Builder, a senior full-stack architect.
Generate a clean, complete, responsive web application that runs directly inside a browser preview iframe AND includes realistic backend/database schema files.
Requirements:
- Always include 'index.html', 'styles.css', and 'app.js' so the live preview renders cleanly without external build steps.
- Also include 'server/api.ts' and 'db/schema.sql' with production-structured TypeScript API routes and SQL tables tailored to the user's app.
- Use clean typography, balanced layout, real interactive JavaScript behavior (forms, filters, state updates), and zero placeholder text.
- Return valid JSON matching the exact schema.`;

  const userContent =
    params.mode === 'create'
      ? `Build a complete web application for: "${params.prompt}"`
      : `Update the application according to this request: "${params.prompt}"\n${existingContext}`;

  const response = await ai.models.generateContent({
    model,
    contents: userContent,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          projectName: { type: Type.STRING, description: 'Concise 2-4 word application name' },
          framework: { type: Type.STRING, description: 'Stack label e.g. HTML/CSS/JS + Express + SQL' },
          summary: { type: Type.STRING, description: '1-2 sentence summary of what was generated or changed' },
          files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                language: { type: Type.STRING },
                content: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    projectName?: string;
    framework?: string;
    summary?: string;
    files?: BuilderFile[];
  };

  const tokensUsed =
    response.usageMetadata?.totalTokenCount ??
    Math.max(450, Math.round((rawText.length + userContent.length) / 4));

  return {
    projectName: parsed.projectName || 'Generated Cloud App',
    framework: parsed.framework || 'Web + Express + SQL',
    summary: parsed.summary || 'Generated application files and updated preview.',
    files: Array.isArray(parsed.files) && parsed.files.length > 0 ? parsed.files : params.existingFiles ?? [],
    tokensUsed,
    usedLiveAi: true,
  };
}

export async function analyzeCodeWithAi(params: {
  task: 'explain' | 'debug' | 'refactor';
  filePath: string;
  code: string;
  errorContext?: string;
  model?: string;
}): Promise<{ analysis: string; tokensUsed: number }> {
  const model = resolveSafeModel(params.model);
  const ai = getAiClient();

  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to run AI code analysis.',
    );
  }

  const promptByTask = {
    explain: `Explain the architecture, state flow, and security considerations of ${params.filePath} concisely in plain markdown.`,
    debug: `Diagnose potential bugs, runtime edge cases, or error causes in ${params.filePath}. Context: ${params.errorContext || 'General audit'}. Provide concrete fixes.`,
    refactor: `Suggest focused refactoring improvements for readability, performance, and type safety in ${params.filePath}.`,
  };

  const response = await ai.models.generateContent({
    model,
    contents: `${promptByTask[params.task]}\n\n\`\`\`\n${params.code}\n\`\`\``,
  });

  const analysis = response.text ?? 'No analysis returned.';
  const tokensUsed =
    response.usageMetadata?.totalTokenCount ?? Math.max(200, Math.round(analysis.length / 4));

  return { analysis, tokensUsed };
}
