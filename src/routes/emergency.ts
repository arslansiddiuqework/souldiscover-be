import express from "express";
import { auth } from "../middleware/auth";
import {
  getEmergencyContacts,
  addEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
  acceptConsent,
  updateEscalationSettings,
  getEscalationStatus,
  triggerTestCall,
} from "../controllers/emergency.controller";

const router = express.Router();

// All routes require authentication
router.use(auth);

router.get("/contacts",                    getEmergencyContacts);
router.post("/contacts",                   addEmergencyContact);
router.put("/contacts/:contactId",         updateEmergencyContact);
router.delete("/contacts/:contactId",      deleteEmergencyContact);
router.post("/consent",                    acceptConsent);
router.put("/settings",                    updateEscalationSettings);
router.get("/status",                      getEscalationStatus);
router.post("/test-call",                  triggerTestCall);

export default router;
