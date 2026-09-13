import sql from "./_db.js";
import { sign } from "./_auth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { staffId, password } = req.body;
    if (!staffId || !password) return res.status(400).json({ error: "Enter your staff ID and password." });

    const rows = await sql`select * from admins where staff_id = ${staffId}`;
    if (rows.length === 0) return res.status(404).json({ error: "No admin account found for that staff ID." });

    const a = rows[0];
    if (a.password !== password) return res.status(401).json({ error: "Incorrect password." });

    return res.json({
      token: sign({ id: a.id, role: "admin" }),
      profile: { id: a.id, role: "admin", name: a.name, contact: a.contact },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}