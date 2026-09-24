import { SystemSettings } from "../../models/SystemSettings";

export const SystemSettingsService = {
  async getSettings() {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({
        crisisEnabled: process.env.CRISIS_ESCALATION_ENABLED !== "false",
        cooldownHours: parseFloat(process.env.CRISIS_COOLDOWN_HOURS || "6"),
        maxPerDay: parseInt(process.env.MAX_ESCALATIONS_PER_DAY || "3"),
      });
    }
    return settings;
  },

  async updateSettings(update: { crisisEnabled?: boolean; cooldownHours?: number; maxPerDay?: number }) {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = new SystemSettings({
        crisisEnabled: process.env.CRISIS_ESCALATION_ENABLED !== "false",
        cooldownHours: parseFloat(process.env.CRISIS_COOLDOWN_HOURS || "6"),
        maxPerDay: parseInt(process.env.MAX_ESCALATIONS_PER_DAY || "3"),
      });
    }
    
    if (update.crisisEnabled !== undefined) settings.crisisEnabled = update.crisisEnabled;
    if (update.cooldownHours !== undefined) settings.cooldownHours = update.cooldownHours;
    if (update.maxPerDay !== undefined) settings.maxPerDay = update.maxPerDay;
    
    await settings.save();
    return settings;
  }
};
