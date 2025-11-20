import { GoogleGenAI, Type } from "@google/genai";
import { Position } from "../types";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API_KEY is missing");
    throw new Error("API Key missing");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateFormationCoordinates = async (
  description: string,
  performerCount: number
): Promise<Position[]> => {
  try {
    const ai = getAiClient();
    const prompt = `
      Generate a list of 2D coordinates (x, y) for a stage formation.
      The stage coordinates are percentages: x from 0 to 100 (left to right), y from 0 to 100 (top to bottom).
      Front of stage is y=100, Back is y=0.
      
      Formation description: "${description}"
      Number of performers: ${performerCount}
      
      Return exactly ${performerCount} coordinate pairs.
      Ideally keep performers within x: 10-90 and y: 10-90 to avoid edges.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            positions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER, description: "X coordinate (0-100)" },
                  y: { type: Type.NUMBER, description: "Y coordinate (0-100)" },
                },
                required: ["x", "y"],
              },
            },
          },
        },
      },
    });

    const json = JSON.parse(response.text || "{}");
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
