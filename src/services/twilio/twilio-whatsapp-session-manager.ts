import { CrisisContext } from "../crisis/crisis-types";

export interface ActiveWhatsAppSession {
  userId: string;
  sessionId: string;
  contactName: string;
  contactWhatsApp: string;
  crisisContext: CrisisContext;
  conversationHistory: { role: "system" | "user" | "assistant"; content: string }[];
  startedAt: Date;
}

import { TwilioSession } from "../../models/TwilioSession";

export const twilioWhatsAppSessionManager = {
  async set(contactWhatsApp: string, session: ActiveWhatsAppSession): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await TwilioSession.findOneAndUpdate(
      { identifier: contactWhatsApp, type: "whatsapp" },
      {
        identifier: contactWhatsApp,
        type: "whatsapp",
        userId: session.userId,
        sessionId: session.sessionId,
        contactName: session.contactName,
        contactWhatsApp: session.contactWhatsApp,
        crisisContext: session.crisisContext,
        conversationHistory: session.conversationHistory,
        startedAt: session.startedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );
  },

  async get(contactWhatsApp: string): Promise<ActiveWhatsAppSession | undefined> {
    const session = await TwilioSession.findOne({ identifier: contactWhatsApp, type: "whatsapp" }).lean();
    if (!session) return undefined;
    return session as unknown as ActiveWhatsAppSession;
  },

  async updateHistory(contactWhatsApp: string, message: { role: "system" | "user" | "assistant"; content: string }): Promise<void> {
    await TwilioSession.updateOne(
      { identifier: contactWhatsApp, type: "whatsapp" },
      { $push: { conversationHistory: message } }
    );
  },

  async delete(contactWhatsApp: string): Promise<void> {
    await TwilioSession.deleteOne({ identifier: contactWhatsApp, type: "whatsapp" });
  },
};
