import sql from "./_db.js";
import { sign } from "./_auth.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await sql`select * from students order by created_at desc`;
      return res.json(rows);
    }

    if (req.method === "POST") {
      const { action, name, studentId, contact } = req.body;

      if (action === "login") {
        if (!studentId) return res.status(400).json({ error: "Missing student ID" });
        const rows = await sql`select * from students where student_id = ${studentId}`;
        if (rows.length === 0) return res.status(404).json({ error: "No account found for that student ID." });
        const s = rows[0];
        return res.json({
          token: sign({ id: s.id, role: "student" }),
          profile: { id: s.id, role: "student", name: s.name, studentId: s.student_id, contact: s.contact },
        });
      }

      if (!name || !studentId || !contact) return res.status(400).json({ error: "Missing fields" });
      const existing = await sql`select id from students where student_id = ${studentId}`;
      if (existing.length > 0) return res.status(409).json({ error: "That student ID is already registered — log in instead." });

      await sql`insert into students (id, name, student_id, contact) values (${studentId}, ${name}, ${studentId}, ${contact})`;
      return res.json({
        token: sign({ id: studentId, role: "student" }),
        profile: { id: studentId, role: "student", name, studentId, contact },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}