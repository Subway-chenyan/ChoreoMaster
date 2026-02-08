import { GoogleGenAI, Type } from "@google/genai";
import { Position } from "../types";


export const generateFormationCoordinates = async (
  description: string,
  performerCount: number,
  config: { apiKey: string, baseUrl?: string, model?: string }
): Promise<Position[]> => {
  try {
    const { apiKey, baseUrl, model = "gemini-3-flash-preview" } = config;

    if (!apiKey) {
      throw new Error("API Key missing");
    }

    // Default prompt
    const prompt = `
      Generate a list of 2D coordinates (x, y) for a stage formation.
      The stage coordinates are percentages: x from 0 to 100 (left to right), y from 0 to 100 (top to bottom).
      Front of stage is y=100, Back is y=0.
      
      Formation description: "${description}"
      Number of performers: ${performerCount}
      
      Return exactly ${performerCount} coordinate pairs in JSON format: {"positions": [{"x": number, "y": number}, ...]}.
      Ideally keep performers within x: 10-90 and y: 10-90 to avoid edges.
    `;

    // If a custom baseUrl is provided, it might be an OpenAI-compatible proxy or a direct Google proxy
    // We'll use fetch to be most flexible
    const url = baseUrl
      ? (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + `v1beta/models/${model}:generateContent?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              positions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    x: { type: "NUMBER" },
                    y: { type: "NUMBER" }
                  },
                  required: ["x", "y"]
                }
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Request failed: ${response.status} ${errText}`);
    }

    const result = await response.json();

    // Extract text from the first candidate
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const json = JSON.parse(text);
    if (json.positions && Array.isArray(json.positions)) {
      return json.positions;
    }
    throw new Error("Invalid response format");
  } catch (error) {
    console.error("Gemini generation failed:", error);
    // Fallback to a random scatter if API fails
    return Array.from({ length: performerCount }).map(() => ({
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
    }));
  }
};
