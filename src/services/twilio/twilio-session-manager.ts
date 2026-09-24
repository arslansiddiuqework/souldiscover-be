/**
 * Twilio Session Manager
 * ─────────────────────────
 * In-memory store for active emergency call sessions.
 * Keyed by Twilio CallSid. Auto-clears after 30 minutes.
 */

import { ActiveCallSession } from "../crisis/crisis-types";
import { TwilioSession } from "../../models/TwilioSession";

class TwilioSessionManager {
  async set(callSid: string, session: ActiveCallSession): Promise<void> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins
    
    await TwilioSession.findOneAndUpdate(
      { identifier: callSid, type: "voice" },
      {
        identifier: callSid,
        type: "voice",
        userId: session.userId,
        sessionId: session.sessionId,
        contactName: session.contactName,
        contactPhone: session.contactPhone,
        crisisContext: session.crisisContext,
        conversationHistory: session.conversationHistory,
        startedAt: session.startedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );
  }

  async get(callSid: string): Promise<ActiveCallSession | undefined> {
    const session = await TwilioSession.findOne({ identifier: callSid, type: "voice" }).lean();
    if (!session) return undefined;
    return session as unknown as ActiveCallSession;
  }

  async update(callSid: string, patch: Partial<ActiveCallSession>): Promise<void> {
    const session = await this.get(callSid);
    if (!session) return;
    
    const updated = { ...session, ...patch };
    await this.set(callSid, updated);
  }

  async delete(callSid: string): Promise<void> {
    await TwilioSession.deleteOne({ identifier: callSid, type: "voice" });
  }

  async has(callSid: string): Promise<boolean> {
    const count = await TwilioSession.countDocuments({ identifier: callSid, type: "voice" });
    return count > 0;
  }
}

export const twilioSessionManager = new TwilioSessionManager();
