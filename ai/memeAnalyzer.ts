import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import type { MemeAnalysisResult, VideoRecord } from '../src/types.ts';
import { getThumbnailsDir, locateVideoFile } from '../backend/folders.ts';

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

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.AI_API_KEY);
}

export async function analyzeMemeVideo(video: VideoRecord): Promise<MemeAnalysisResult> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable AI meme analysis.'
    );
  }

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  const thumbPath = path.join(getThumbnailsDir(), `${video.id}.jpg`);
  const videoPath = locateVideoFile(video.storedFileName, video.folderStage);

  if (videoPath && fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    if (stat.size <= 10 * 1024 * 1024) {
      const ext = path.extname(videoPath).toLowerCase();
      const mimeType =
        ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';
      parts.push({
        inlineData: {
          mimeType,
          data: fs.readFileSync(videoPath).toString('base64'),
        },
      });
    } else if (fs.existsSync(thumbPath)) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: fs.readFileSync(thumbPath).toString('base64'),
        },
      });
    }
  } else if (fs.existsSync(thumbPath)) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: fs.readFileSync(thumbPath).toString('base64'),
      },
    });
  }

  const promptText = [
    'You are analyzing a meme Short for the YouTube channel "Xavier Memes".',
    `Original filename: ${video.originalFileName}`,
    `Dimensions: ${video.validation.width ?? 'unknown'}x${video.validation.height ?? 'unknown'} (${video.validation.aspectRatio})`,
    `Duration: ${video.validation.durationSec ?? 'unknown'}s, Has audio: ${String(video.validation.hasAudio)}`,
    '',
    'Analyze the video/frame and provide:',
    '1. What the meme context is.',
    '2. What the joke and punchline are.',
    '3. Whether it is appropriate and safe for a general comedy meme channel.',
    '4. Potential copyright or watermark/repost risk level (low, medium, high) and why.',
    '5. Recommended trending meme audio mood and 2-4 sound style ideas.',
    '',
    'CRITICAL RULE: Do NOT generate or suggest titles, descriptions, or hashtags. Title and hashtags are permanently locked.',
  ].join('\n');

  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'You are a comedy meme analyst and brand-safety reviewer for Xavier Memes. Never suggest titles, descriptions, or hashtags.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          memeContext: {
            type: Type.STRING,
            description: 'Brief summary of what happens or appears in the meme.',
          },
          jokeAndPunchline: {
            type: Type.STRING,
            description: 'The comedic premise and punchline.',
          },
          appropriateForChannel: {
            type: Type.BOOLEAN,
            description: 'True if safe for YouTube Community Guidelines and comedy meme audience.',
          },
          safetyNotes: {
            type: Type.STRING,
            description: 'Any policy, profanity, or safety observations.',
          },
          copyrightRiskLevel: {
            type: Type.STRING,
            description: 'One of: low, medium, high.',
          },
          copyrightRiskReason: {
            type: Type.STRING,
            description: 'Explanation of visible watermarks, music, or third-party clip risks.',
          },
          recommendedAudioMood: {
            type: Type.STRING,
            description: 'Recommended meme sound pacing or vibe (e.g. abrupt record scratch, deadpan phonk, comedic rimshot).',
          },
          suggestedSounds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2 to 4 relevant meme audio styles or sound effect names.',
          },
        },
        required: [
          'memeContext',
          'jokeAndPunchline',
          'appropriateForChannel',
          'safetyNotes',
          'copyrightRiskLevel',
          'copyrightRiskReason',
          'recommendedAudioMood',
          'suggestedSounds',
        ],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as Partial<MemeAnalysisResult>;

  const risk =
    parsed.copyrightRiskLevel === 'high' || parsed.copyrightRiskLevel === 'medium'
      ? parsed.copyrightRiskLevel
      : 'low';

  return {
    analyzedAt: new Date().toISOString(),
    memeContext: parsed.memeContext || 'No visual context extracted.',
    jokeAndPunchline: parsed.jokeAndPunchline || 'Could not isolate punchline from preview.',
    appropriateForChannel: parsed.appropriateForChannel ?? true,
    safetyNotes: parsed.safetyNotes || 'No obvious safety flags reported.',
    copyrightRiskLevel: risk,
    copyrightRiskReason:
      parsed.copyrightRiskReason || 'Ensure any background music is licensed or added via YouTube Shorts Audio Picker.',
    recommendedAudioMood: parsed.recommendedAudioMood || 'Upbeat comedic meme sting',
    suggestedSounds: Array.isArray(parsed.suggestedSounds) ? parsed.suggestedSounds.slice(0, 4) : [],
  };
}
