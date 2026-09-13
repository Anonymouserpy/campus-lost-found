import sql from "./_db.js";
import { uid } from "./_auth.js";

function rowToItem(r) {
  return {
    id: r.id, type: r.type, title: r.title, description: r.description,
    location: r.location, category: r.category, contact: r.contact, image: r.image,
    status: r.status, postedAt: r.posted_at,
    resolvedAt: r.resolved_at, resolvedFor: r.resolved_for,
    postedBy: { id: r.posted_by_id, name: r.posted_by_name, studentId: r.posted_by_student_id },
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await sql`select * from items order by posted_at desc`;
      return res.json(rows.map(rowToItem));
    }

    if (req.method === "POST") {
      const e = req.body;
      const id = uid();
      const rows = await sql`
        insert into items (id, type, title, description, location, category, contact, image,
                           posted_by_id, posted_by_name, posted_by_student_id)
        values (${id}, ${e.type}, ${e.title}, ${e.description || ""}, ${e.location},
                ${e.category}, ${e.contact}, ${e.image || null},
                ${e.postedBy.id}, ${e.postedBy.name}, ${e.postedBy.studentId || null})
        returning *
      `;
      return res.json(rowToItem(rows[0]));
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await sql`delete from items where id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}