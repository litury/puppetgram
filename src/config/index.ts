import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  telegram: {
    apiId: Number(process.env.API_ID),
    apiHash: process.env.API_HASH || "",
    sessionString: process.env.SESSION_STRING || "",
  },
  defaults: {
    messageLimit: 100,
    costPerCharacter: 0.000002, // Примерная стоимость анализа за символ
  },
};
