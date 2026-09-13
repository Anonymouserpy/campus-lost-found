const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function uploadImage(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("folder", "campus-lost-found");

  const uploadRes = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || "Cloudinary upload failed");
  }

  const data = await uploadRes.json();
  return data.secure_url;
}