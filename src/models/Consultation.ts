import mongoose, { Document, Schema } from "mongoose";

export interface IConsultation extends Document {
  bookingId: string;
  userId: mongoose.Types.ObjectId;
  psychologistId: string;
  psychologistName: string;
  date: string;
  time: string;
  durationMinutes: number;
  priceUsd: number;
  status: "scheduled" | "completed" | "cancelled";
  clientName: string;
  clientEmail: string;
  reason: string;
  notes?: string;
  paymentStatus: "pending" | "placeholder" | "paid" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const consultationSchema = new Schema<IConsultation>(
  {
    bookingId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    psychologistId: { type: String, required: true },
    psychologistName: { type: String, required: true },
    date: { type: String, required: true, index: true },
    time: { type: String, required: true },
    durationMinutes: { type: Number, default: 90 },
    priceUsd: { type: Number, default: 10 },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    clientName: { type: String, required: true },
    clientEmail: { type: String, required: true },
    reason: { type: String, required: true },
    notes: { type: String },
    paymentStatus: {
      type: String,
      enum: ["pending", "placeholder", "paid", "failed"],
      default: "placeholder",
    },
  },
  { timestamps: true }
);

consultationSchema.index({ userId: 1, bookingId: 1 }, { unique: true });
consultationSchema.index({ status: 1, date: 1 });

export const Consultation = mongoose.model<IConsultation>("Consultation", consultationSchema);
