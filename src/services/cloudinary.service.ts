import { v2 as cloudinary } from "cloudinary";
import { logger } from "../utils/logger";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload an image buffer to Cloudinary
 */
export const uploadImage = (fileBuffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "ai-therapy-avatars",
      },
      (error, result) => {
        if (error) {
          logger.error("Cloudinary upload error:", error);
          return reject(error);
        }
        if (result) {
          resolve(result.secure_url);
        } else {
          reject(new Error("Cloudinary upload failed with no result"));
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

const getPublicIdFromUrl = (imageUrl?: string): string | null => {
  if (!imageUrl) return null;

  try {
    const url = new URL(imageUrl);
    const uploadIndex = url.pathname.indexOf("/upload/");

    if (!url.hostname.includes("cloudinary.com") || uploadIndex === -1) {
      return null;
    }

    const afterUpload = url.pathname.slice(uploadIndex + "/upload/".length);
    const pathParts = afterUpload.split("/").filter(Boolean);

    if (pathParts[0]?.match(/^v\d+$/)) {
      pathParts.shift();
    }

    const publicIdWithExtension = pathParts.join("/");
    return decodeURIComponent(publicIdWithExtension).replace(/\.[^/.]+$/, "") || null;
  } catch {
    return null;
  }
};

/**
 * Delete a Cloudinary image using its delivered URL.
 */
export const deleteImage = async (imageUrl?: string): Promise<boolean> => {
  const publicId = getPublicIdFromUrl(imageUrl);

  if (!publicId) {
    return false;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return result.result === "ok" || result.result === "not found";
  } catch (error) {
    logger.error("Cloudinary delete error:", error);
    return false;
  }
};
