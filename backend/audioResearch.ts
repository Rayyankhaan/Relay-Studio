import { GoogleGenAI } from '@google/genai';
import type { TrendingAudioItem } from '../src/types.js';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface RawAudioResearchEntry {
  soundName?: string;
  relevanceToMemes?: string;
  trendStatus?: string;
  recommendedForType?: string;
  sourceUrl?: string;
}

export async function researchTrendingMemeAudio(focusTopic?: string): Promise<TrendingAudioItem[]> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to run live trending meme audio research.'
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const focusClause = focusTopic?.trim()
    ? `Focus especially on meme sounds fitting: "${focusTopic.trim()}".`
    : 'Focus on comedy reaction memes, text-meme punchlines, and viral short-form edits.';

  const prompt = [
    `Research 5 currently popular or evergreen viral meme audio tracks/sounds suitable for YouTube Meme Shorts as of ${today}.`,
    focusClause,
    'Only cite real, legitimate sound trends or royalty-free/YouTube Audio Library style references.',
    'Do NOT suggest downloading copyrighted commercial tracks from unauthorized sites.',
    'Return ONLY a JSON array (wrapped in ```json ... ```) where each item has:',
    '- soundName: string',
    '- relevanceToMemes: string (why it works for comedy/Xavier-style punchline memes)',
    '- trendStatus: string (e.g., "Rising on Shorts", "Evergreen Meme Audio", "Viral Reaction")',
    '- recommendedForType: string (e.g., "Deadpan punchline", "Plot twist reveal", "Fail reaction")',
    '- sourceUrl: string (official/reference URL if found in search results, otherwise empty string)',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const groundingChunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const webSources = groundingChunks
    .map((chunk) => chunk.web)
    .filter((w): w is { uri?: string; title?: string } => Boolean(w?.uri));

  const text = (response.text ?? '').trim();
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\[\s*\{[\s\S]*\}\s*\])/);

  let parsedList: RawAudioResearchEntry[] = [];
  if (jsonMatch?.[1]) {
    try {
      const candidate = JSON.parse(jsonMatch[1]) as unknown;
      if (Array.isArray(candidate)) {
        parsedList = candidate as RawAudioResearchEntry[];
      }
    } catch {
      parsedList = [];
    }
  }

  if (parsedList.length === 0) {
    throw new Error(
      'Live search completed but returned an unstructured response. Please try running Trending Audio Research again.'
    );
  }

  const nowIso = new Date().toISOString();
  return parsedList.slice(0, 6).map((item, idx) => {
    const matchedGround = webSources[idx] ?? webSources[0] ?? null;
    const candidateUrl =
      item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)
        ? item.sourceUrl
        : matchedGround?.uri ?? null;

    return {
      id: `aud_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
      soundName: (item.soundName || 'Unnamed Meme Audio').trim(),
      sourceUrl: candidateUrl,
      sourceTitle: matchedGround?.title ?? (candidateUrl ? 'Web Reference' : null),
      relevanceToMemes:
        item.relevanceToMemes || 'Suited for short punchline meme timing.',
      trendStatus: item.trendStatus || 'Trending on Shorts',
      recommendedForType: item.recommendedForType || 'Comedy Meme Short',
      researchedAt: nowIso,
    };
  });
}
