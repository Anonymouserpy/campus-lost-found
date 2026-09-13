import crypto from "crypto";

const CLOUD_NAME = process.env.VITE_CLOUDINARY_CLOUD_NAME || "ykqpbxmb";
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { dataUrl, folder } = req.body;
    if (!dataUrl) return res.status(400).json({ error: "Missing dataUrl" });

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${folder || ""}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + API_SECRET)
      .digest("hex");

    const base64 = dataUrl.split(",")[1];
    const mime = dataUrl.match(/^data:(.*?);/)[1];
    const buffer = Buffer.from(base64, "base64");

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime }));
    form.append("api_key", API_KEY);
    form.append("timestamp", timestamp);
    form.append("signature", signature);
    if (folder) form.append("folder", folder);

    const up = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: "POST", body: form }
    );
    const data = await up.json();

    if (!up.ok) return res.status(400).json({ error: data.error?.message || "Upload failed" });
    return res.json({ url: data.secure_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
